import { createWriteStream } from 'node:fs'
import { link, lstat, mkdtemp, open, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { RemoteFileSystems } from './remote-file-systems.js'
import type { RemoteFileSystemSession } from './remote-files.js'

const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 300_000

interface DownloadRequest { endpointId: string; remotePath: string; sessionDirectory: string; localPath?: string }

/** Bounded foreground downloads. Final names appear only after a complete, exclusive commit. */
export class SessionFileDownloads {
  private readonly active = new Set<AbortController>()
  private closed = false
  constructor(private readonly files: RemoteFileSystems) {}

  async download(request: DownloadRequest, callerSignal: AbortSignal, assertAllowed: () => void) {
    if (this.closed) throw new Error('文件下载服务已停止')
    if (this.active.size >= 2) throw new Error('已有两个文件正在下载，请稍后重试')
    const controller = new AbortController()
    const signal = AbortSignal.any([callerSignal, controller.signal])
    const timer = setTimeout(() => controller.abort(new Error('文件下载超时，请重试')), DOWNLOAD_TIMEOUT_MS)
    timer.unref?.()
    this.active.add(controller)
    let session: RemoteFileSystemSession | undefined
    let temporary: string | undefined
    try {
      signal.throwIfAborted(); assertAllowed()
      if (!request.sessionDirectory || !path.isAbsolute(request.sessionDirectory)) throw new Error('当前会话没有有效的本地工作目录，不能下载')
      if (request.localPath !== undefined) validateLocalPath(request.localPath)
      const root = await realpath(request.sessionDirectory)
      if (!(await lstat(root)).isDirectory()) throw new Error('当前会话工作目录不是目录')
      signal.throwIfAborted(); assertAllowed()
      session = await this.files.connect(request.endpointId, signal)
      const entry = await session.stat(request.remotePath, signal)
      if (entry.kind !== 'file') throw new Error('下载工具仅支持普通文件；请指定文件路径，不要指定目录或特殊文件')
      if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_DOWNLOAD_BYTES) throw new Error('单文件下载上限为 512 MiB')
      const relativePath = request.localPath ?? entry.name
      validateLocalPath(relativePath)
      const candidate = path.resolve(root, relativePath)
      assertInside(root, candidate)
      let parent: string
      try { parent = await realpath(path.dirname(candidate)) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('目标子目录不存在，请先创建目录或省略 localPath 使用会话目录')
        throw error
      }
      assertInside(root, parent, true)
      const target = path.join(parent, path.basename(candidate))
      await assertAbsent(target)
      signal.throwIfAborted(); assertAllowed()
      temporary = await mkdtemp(path.join(parent, '.dsh-download-'))
      const partial = path.join(temporary, 'content.part')
      let bytes = 0
      const meter = new Transform({
        highWaterMark: 64 * 1024,
        transform(chunk: Buffer, _encoding, callback) {
          try {
            signal.throwIfAborted(); assertAllowed()
            bytes += chunk.length
            if (bytes > MAX_DOWNLOAD_BYTES) throw new Error('下载内容超过 512 MiB，已停止')
            callback(null, chunk)
          } catch (error) { callback(error as Error) }
        },
      })
      meter.on('error', () => {})
      const output = createWriteStream(partial, { flags: 'wx', mode: 0o600 })
      const sink = pipeline(meter, output, { signal })
      // Either side failing cancels the other side; wait for both before removing staging files.
      const stop = (error: unknown): never => { controller.abort(error); throw error }
      const writes = sink.catch(stop)
      const reads = Promise.resolve().then(() => session!.download(entry.path, meter, signal)).catch(stop)
      const outcomes = await Promise.allSettled([reads, writes])
      signal.throwIfAborted()
      for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason
      if (bytes !== entry.size) throw new Error('远端文件大小在下载期间发生变化，请重试；未保存不完整文件')
      const handle = await open(partial, 'r')
      try { await handle.sync() } finally { await handle.close() }
      if (await realpath(request.sessionDirectory) !== root || await realpath(parent) !== parent) throw new Error('会话目录在下载期间发生变化，请重试')
      signal.throwIfAborted(); assertAllowed()
      // link is atomic and fails for an existing file, directory or symlink; never overwrite.
      try { await link(partial, target) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('本地同名文件已存在，未覆盖；请指定其他 localPath')
        throw error
      }
      return { state: 'completed' as const, endpointId: request.endpointId, remotePath: entry.path,
        localPath: target, bytes, location: 'DSH session directory' as const }
    } finally {
      clearTimeout(timer)
      try { session?.close() }
      finally {
        if (temporary !== undefined) await rm(temporary, { recursive: true, force: true }).catch(() => {})
        this.active.delete(controller)
      }
    }
  }

  close(): void {
    this.closed = true
    for (const controller of this.active) controller.abort(new Error('文件下载服务已停止'))
  }
}

function validateLocalPath(value: string): void {
  if (!value || value.length > 4096 || /[\0\r\n\\]/.test(value) || path.isAbsolute(value) || path.win32.isAbsolute(value) || value.split('/').some(part => part === '..' || part === '' || part === '.')) {
    throw new Error('localPath 必须是会话目录内的相对文件路径，不能包含 ..、绝对路径或换行')
  }
}
function assertInside(root: string, target: string, allowRoot = false): void {
  const relative = path.relative(root, target)
  if ((!allowRoot && !relative) || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('下载目标必须位于当前会话目录内')
}
async function assertAbsent(target: string): Promise<void> {
  try { await lstat(target) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  throw new Error('本地同名文件已存在，未覆盖；请指定其他 localPath')
}
