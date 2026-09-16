import type { ServerResponse } from 'node:http'

export interface DownloadProgress {
  state: 'preparing' | 'transferring' | 'completed' | 'failed'
  transferredBytes: number
  totalBytes?: number
  error?: string
}

/** Measures streamed HTTP bodies without buffering files or consuming the input. */
export class DownloadProgressStore {
  private readonly entries = new Map<string, { value: DownloadProgress; touched: number }>()

  get(id: string): DownloadProgress | undefined { return this.entries.get(id)?.value }

  track(id: string, res: ServerResponse) {
    if (!/^[a-zA-Z0-9_-]{20,100}$/.test(id)) throw Object.assign(new Error('invalid transfer id'), { status: 400 })
    for (const [key, entry] of this.entries) {
      if ((entry.value.state === 'completed' || entry.value.state === 'failed') && Date.now() - entry.touched > 600_000) this.entries.delete(key)
    }
    if (this.entries.has(id)) throw Object.assign(new Error('transfer id already exists'), { status: 409 })
    if (this.entries.size >= 500) {
      const oldest = [...this.entries].find(([, e]) => e.value.state === 'completed' || e.value.state === 'failed')
      if (oldest) this.entries.delete(oldest[0])
      else throw Object.assign(new Error('too many active downloads'), { status: 429 })
    }
    const record = { value: { state: 'preparing', transferredBytes: 0 } as DownloadProgress, touched: Date.now() }
    this.entries.set(id, record)
    const count = (chunk: unknown, encoding: unknown): void => {
      if (record.value.state === 'failed') return
      const length = res.getHeader('Content-Length')
      if (length !== undefined && Number.isSafeInteger(Number(length)) && Number(length) >= 0) record.value.totalBytes = Number(length)
      if (typeof chunk === 'string') record.value.transferredBytes += Buffer.byteLength(chunk, typeof encoding === 'string' ? encoding as BufferEncoding : 'utf8')
      else if (chunk instanceof Uint8Array) record.value.transferredBytes += chunk.byteLength
      record.value.state = 'transferring'
      record.touched = Date.now()
    }
    const originalWrite = res.write
    const originalEnd = res.end
    res.write = function (this: ServerResponse, ...args: Parameters<ServerResponse['write']>) { count(args[0], args[1]); return Reflect.apply(originalWrite, this, args) } as ServerResponse['write']
    res.end = function (this: ServerResponse, ...args: Parameters<ServerResponse['end']>) { count(args[0], args[1]); return Reflect.apply(originalEnd, this, args) } as ServerResponse['end']
    const fail = (error: unknown): void => {
      record.value.state = 'failed'
      record.value.error = error instanceof Error ? error.message : String(error)
      record.touched = Date.now()
    }
    res.once('close', () => { if (!res.writableFinished) fail(new Error('download connection interrupted')) })
    return {
      fail,
      complete: (): void => {
        const finish = (): void => {
          if (record.value.state === 'failed') return
          if (res.statusCode >= 400) { fail(new Error(`HTTP ${res.statusCode}`)); return }
          record.value.state = 'completed'
          record.touched = Date.now()
        }
        if (res.writableFinished) finish()
        else res.once('finish', finish)
      },
    }
  }
}
