import { randomUUID } from 'node:crypto'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { RemoteFileSystems } from './remote-file-systems.js'
import { remoteJoin } from './remote-files.js'

export const MAX_LOCAL_TRANSFER_BYTES = 512 * 1024 * 1024

/** Stage first: partial uploads never appear under the requested filename. */
export async function uploadEndpointFile(files: RemoteFileSystems, endpointId: string, directory: string, name: string, source: Readable, signal: AbortSignal, expectedSize?: number, assertAllowed: () => void = () => {}) {
  if (!name || name === '.' || name === '..' || /[\\/\0\r\n]/.test(name)) throw new Error('无效的上传文件名')
  if (expectedSize !== undefined && (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > MAX_LOCAL_TRANSFER_BYTES)) throw new Error('单文件上传上限为 512 MiB')
  signal.throwIfAborted(); assertAllowed()
  const session = await files.connect(endpointId, signal)
  let staging: string | undefined
  try {
    const parent = await session.stat(directory, signal)
    if (parent.kind !== 'directory') throw new Error('上传目标不是目录')
    const target = remoteJoin(parent.path, name)
    staging = remoteJoin(parent.path, `.dsh-upload-${randomUUID()}.part`)
    let size = 0
    const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      try {
        signal.throwIfAborted(); assertAllowed(); size += chunk.length
        if (size > MAX_LOCAL_TRANSFER_BYTES) throw new Error('上传内容超过 512 MiB')
        callback(null, chunk)
      } catch (error) { callback(error as Error) }
    } })
    const controller = new AbortController()
    const transferSignal = AbortSignal.any([signal, controller.signal])
    const stop = (error: unknown): never => { controller.abort(error); meter.destroy(error as Error); throw error }
    const outcomes = await Promise.allSettled([
      pipeline(source, meter, { signal: transferSignal }).catch(stop),
      session.upload(staging, meter, false, transferSignal).catch(stop),
    ])
    for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason
    signal.throwIfAborted(); assertAllowed()
    if (expectedSize !== undefined && size !== expectedSize) throw new Error('上传大小不一致，请重试')
    const saved = await session.stat(staging, signal)
    if (saved.kind !== 'file' || saved.size !== size) throw new Error('远端保存大小不一致，请重试')
    await session.move(staging, target, signal)
    staging = undefined
    return { path: target, name, size }
  } finally {
    if (staging) await session.remove(staging, false, AbortSignal.timeout(5_000)).catch(() => {})
    session.close()
  }
}
