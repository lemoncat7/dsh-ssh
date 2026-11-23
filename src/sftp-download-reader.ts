import { Readable } from 'node:stream'
import type { SFTPWrapper } from 'ssh2'
import { transferConcurrencyChoices } from './transfer-concurrency.js'

const chunkSize = 32 * 1024

/** Read one SFTP handle ahead in bounded batches and stream the ranges in order. */
export function readSftpDownload(sftp: SFTPWrapper, path: string, size: number, concurrency: number, signal?: AbortSignal): Readable {
  if (!transferConcurrencyChoices.includes(concurrency)) throw new RangeError('Invalid SFTP concurrency')
  if (!Number.isSafeInteger(size) || size < 0) throw new RangeError('Invalid SFTP file size')
  return Readable.from(chunks(), { objectMode: false })

  async function* chunks(): AsyncGenerator<Buffer> {
    signal?.throwIfAborted()
    const handle = await new Promise<Buffer>((resolve, reject) => sftp.open(path, 'r', (error, value) => error ? reject(error) : resolve(value)))
    try {
      for (let start = 0; start < size;) {
        signal?.throwIfAborted()
        const pending: Promise<Buffer>[] = []
        while (start < size && pending.length < concurrency) {
          const length = Math.min(chunkSize, size - start)
          pending.push(readRange(handle, start, length))
          start += length
        }
        for (const data of await Promise.all(pending)) {
          signal?.throwIfAborted()
          yield data
        }
      }
    } finally {
      await new Promise<void>(resolve => sftp.close(handle, () => resolve()))
    }
  }

  async function readRange(handle: Buffer, position: number, length: number): Promise<Buffer> {
    const data = Buffer.allocUnsafe(length)
    let offset = 0
    while (offset < length) {
      signal?.throwIfAborted()
      const remaining = length - offset
      const bytes = await new Promise<number>((resolve, reject) =>
        sftp.read(handle, data, offset, remaining, position + offset, (error, bytesRead) =>
          error ? reject(error) : resolve(bytesRead)))
      if (!Number.isInteger(bytes) || bytes <= 0 || bytes > remaining) throw new Error('SFTP download interrupted: incomplete file')
      offset += bytes
    }
    return data
  }
}
