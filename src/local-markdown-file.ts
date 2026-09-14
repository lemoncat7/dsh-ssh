import { randomUUID } from 'node:crypto'
import { open, realpath, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { resolveInside } from './local-workspace.js'
import { MAX_MARKDOWN_EDIT_BYTES, markdownError, saveMarkdownWithAdapter, type MarkdownSaveRequest } from './markdown-file.js'

export async function saveLocalMarkdown(root: string, input: MarkdownSaveRequest): Promise<{ contentHash: string }> {
  const boundary = await realpath(root)
  const target = await resolveInside(boundary, input.path)
  if (!/\.md$/i.test(target)) throw markdownError(400, '目标不是 Markdown 文件')
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.dsh-save-${randomUUID()}`)
  let staged = false
  let mode = 0, uid = 0, gid = 0
  let identity: string | undefined
  return saveMarkdownWithAdapter(`local:${target}`, input, {
    read: async () => {
      if (await resolveInside(boundary, input.path) !== target) throw markdownError(409, '文件路径发生变化')
      const file = await open(target, 'r+') // Require file write permission, not only parent-directory permission.
      try {
        const info = await file.stat()
        const nextIdentity = `${info.dev}:${info.ino}:${info.mode}:${info.uid}:${info.gid}:${info.size}:${info.mtimeMs}`
        if (identity !== undefined && identity !== nextIdentity) throw markdownError(409, '保存期间文件或权限发生变化')
        identity = nextIdentity
        if (!info.isFile() || info.nlink > 1) throw markdownError(400, '不支持编辑非普通文件或硬链接文件')
        if (info.size > MAX_MARKDOWN_EDIT_BYTES) throw markdownError(413, '文件超过编辑大小限制')
        mode = info.mode & 0o777; uid = info.uid; gid = info.gid
        const buffer = Buffer.alloc(MAX_MARKDOWN_EDIT_BYTES + 1)
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
        if (bytesRead > MAX_MARKDOWN_EDIT_BYTES) throw markdownError(413, '文件超过编辑大小限制')
        return buffer.subarray(0, bytesRead)
      } finally { await file.close() }
    },
    stage: async text => {
      const file = await open(temporary, 'wx', 0o600); staged = true
      try {
        await file.writeFile(text, 'utf8')
        if (process.platform !== 'win32') { await file.chown(uid, gid); await file.chmod(mode) }
        await file.sync()
      } finally { await file.close() }
    },
    commit: async () => { await rename(temporary, target); staged = false },
    cleanup: async () => { if (staged) await unlink(temporary) },
  })
}
