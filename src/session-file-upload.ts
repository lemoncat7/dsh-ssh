import { constants } from 'node:fs'
import { open, realpath, stat as fileStat } from 'node:fs/promises'
import path from 'node:path'
import type { RemoteFileSystems } from './remote-file-systems.js'
import { MAX_LOCAL_TRANSFER_BYTES, uploadEndpointFile } from './endpoint-upload.js'

export class SessionFileUploads {
  private readonly active = new Set<AbortController>()
  private closed = false
  constructor(private readonly files: RemoteFileSystems) {}
  async upload(request: { endpointId: string; localPath: string; sessionDirectory: string; remoteDirectory: string; remoteName?: string }, callerSignal: AbortSignal, assertAllowed: () => void) {
    if (this.closed || this.active.size >= 2) throw new Error('上传服务不可用或已有两个上传，请稍后重试')
    const relative = request.localPath
    if (!relative || /[\\\0\r\n]/.test(relative) || path.isAbsolute(relative) || path.win32.isAbsolute(relative) || relative.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('localPath 必须是会话目录内的相对文件路径')
    if (!path.isAbsolute(request.sessionDirectory)) throw new Error('会话没有有效工作目录')
    const controller = new AbortController()
    const signal = AbortSignal.any([callerSignal, controller.signal, AbortSignal.timeout(300_000)])
    this.active.add(controller)
    try {
      signal.throwIfAborted(); assertAllowed()
      const root = await realpath(request.sessionDirectory)
      const filename = await realpath(path.resolve(root, relative))
      const contained = path.relative(root, filename)
      if (!contained || contained === '..' || contained.startsWith(`..${path.sep}`) || path.isAbsolute(contained)) throw new Error('上传文件必须位于当前会话目录内')
      const original = await fileStat(filename)
      const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK)
      try {
        const stat = await handle.stat()
        if (stat.dev !== original.dev || stat.ino !== original.ino) throw new Error('上传文件在打开期间发生变化，请重试')
        if (!stat.isFile() || stat.size > MAX_LOCAL_TRANSFER_BYTES) throw new Error('只允许上传不超过 512 MiB 的普通文件')
        if (await realpath(filename) !== filename || await realpath(request.sessionDirectory) !== root) throw new Error('会话文件路径已变化')
        const check = (): void => { signal.throwIfAborted(); assertAllowed() }
        const result = await uploadEndpointFile(this.files, request.endpointId, request.remoteDirectory, request.remoteName ?? path.basename(filename), handle.createReadStream({ autoClose: false }), signal, stat.size, check)
        return { state: 'completed', endpointId: request.endpointId, localPath: filename, remotePath: result.path, bytes: result.size }
      } finally { await handle.close() }
    } finally { this.active.delete(controller) }
  }
  close(): void { this.closed = true; for (const controller of this.active) controller.abort(new Error('上传服务已停止')) }
}
