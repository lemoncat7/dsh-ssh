import type { SFTPWrapper } from 'ssh2'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export interface UploadOptions {
  concurrency: number
  onProgress?: (bytes: number) => void
}

/** One handle, disjoint byte ranges, at most concurrency requests awaiting a reply. */
export async function writeSftpUpload(sftp: SFTPWrapper, path: string, source: Readable, exclusive: boolean, options: UploadOptions, signal?: AbortSignal): Promise<void> {
  const { concurrency, onProgress } = options
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new RangeError('Invalid SFTP concurrency')
  signal?.throwIfAborted()
  const handle = await new Promise<Buffer>((resolve, reject) => sftp.open(path, exclusive ? 'wx' : 'w', 0o600,
    (error, value) => error ? reject(error) : resolve(value)))
  const pending = new Set<Promise<void>>()
  let offset = 0
  let acknowledged = 0
  let failure: Error | undefined
  try {
    await pipeline(source, async chunks => {
      for await (const chunk of chunks) {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        for (let start = 0; start < data.length; start += 32768) {
          if (pending.size >= concurrency) await Promise.race(pending)
          if (failure) throw failure
          signal?.throwIfAborted()
          const length = Math.min(32768, data.length - start)
          const position = offset
          offset += length
          const write: Promise<void> = new Promise<void>((resolve, reject) => {
            sftp.write(handle, data, start, length, position, error => error ? reject(error) : resolve())
          }).then(() => { acknowledged += length; onProgress?.(acknowledged) })
            .catch((error: Error) => { failure ??= error; source.destroy(error) })
            .finally(() => pending.delete(write))
          pending.add(write)
        }
      }
      await Promise.all(pending)
      if (failure) throw failure
    }, { signal })
  } catch (error) {
    failure ??= error instanceof Error ? error : new Error(String(error))
    throw failure
  } finally {
    await Promise.all(pending)
    await new Promise<void>((resolve, reject) => sftp.close(handle, error => error && !failure ? reject(error) : resolve()))
  }
}
