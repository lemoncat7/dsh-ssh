import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { SFTPWrapper, Stats } from 'ssh2'
import type { SshConnector } from './connector.js'
import { MAX_MARKDOWN_EDIT_BYTES, markdownError, saveMarkdownWithAdapter, type MarkdownSaveRequest } from './markdown-file.js'

export async function saveSftpMarkdown(connector: SshConnector, profileId: string, input: MarkdownSaveRequest): Promise<{ contentHash: string }> {
  const connection = await connector.connect(profileId)
  let channel: SFTPWrapper | undefined
  try {
    const sftp = await new Promise<SFTPWrapper>((resolve, reject) => connection.client.sftp((error, value) => error ? reject(error) : resolve(value)))
    channel = sftp
    const resolvePath = () => new Promise<string>((resolve, reject) => sftp.realpath(input.path, (error, value) => error ? reject(error) : resolve(value)))
    const target = await resolvePath()
    if (!/\.md$/i.test(target)) throw markdownError(400, '目标不是 Markdown 文件')
    const temporary = path.posix.join(path.posix.dirname(target), `.${path.posix.basename(target)}.dsh-save-${randomUUID()}`)
    let staged = false
    let metadata: Stats
    let identity: string | undefined
    const result = await saveMarkdownWithAdapter(`sftp:${profileId}:${target}`, input, {
      read: async () => {
        if (await resolvePath() !== target) throw markdownError(409, '文件路径发生变化')
        const handle = await new Promise<Buffer>((resolve, reject) => sftp.open(target, 'r+', (error, value) => error ? reject(error) : resolve(value)))
        try {
          metadata = await new Promise<Stats>((resolve, reject) => sftp.fstat(handle, (error, value) => error ? reject(error) : resolve(value)))
          const nextIdentity = `${metadata.mode}:${metadata.uid}:${metadata.gid}:${metadata.size}:${metadata.mtime}`
          if (identity !== undefined && identity !== nextIdentity) throw markdownError(409, '保存期间文件或权限发生变化')
          identity = nextIdentity
          if ((metadata.mode & 0o170000) !== 0o100000) throw markdownError(400, '目标不是普通文件')
          if (metadata.size > MAX_MARKDOWN_EDIT_BYTES) throw markdownError(413, '文件超过编辑大小限制')
          const buffer = Buffer.alloc(MAX_MARKDOWN_EDIT_BYTES + 1)
          let offset = 0
          while (offset < buffer.length) {
            const count = await new Promise<number>((resolve, reject) => sftp.read(handle, buffer, offset, buffer.length - offset, offset, (error, count) => error ? reject(error) : resolve(count)))
            if (!count) break
            offset += count
          }
          if (offset > MAX_MARKDOWN_EDIT_BYTES) throw markdownError(413, '文件超过编辑大小限制')
          return buffer.subarray(0, offset)
        } finally { await new Promise<void>((resolve, reject) => sftp.close(handle, error => error ? reject(error) : resolve())) }
      },
      stage: async text => {
        const stream = sftp.createWriteStream(temporary, { flags: 'wx', mode: 0o600 })
        stream.once('open', () => { staged = true })
        await pipeline(Readable.from([Buffer.from(text)]), stream)
        await new Promise<void>((resolve, reject) => sftp.setstat(temporary, { mode: metadata.mode & 0o777, uid: metadata.uid, gid: metadata.gid }, error => error ? reject(error) : resolve()))
      },
      commit: async () => {
        // Never delete the original as a fallback: servers without atomic replace fail safely.
        await new Promise<void>((resolve, reject) => sftp.ext_openssh_rename(temporary, target, error => error ? reject(markdownError(409, `服务器未完成原子替换，原文件未主动删除：${error.message}`)) : resolve()))
        staged = false
      },
      cleanup: async () => { if (staged) await new Promise<void>((resolve, reject) => sftp.unlink(temporary, error => error ? reject(error) : resolve())) },
    })
    return result
  } finally { channel?.end(); connection.close() }
}
