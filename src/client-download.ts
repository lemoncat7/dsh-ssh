/** Browser File System Access boundary; no DSH server path is a client path. */
export interface DownloadDestination {
  name: string
  createWritable(): Promise<{
    write(chunk: Uint8Array): Promise<void>
    close(): Promise<void>
    abort(reason?: unknown): Promise<void>
  }>
}
export type SaveFilePicker = (options: { suggestedName: string }) => Promise<DownloadDestination>
export interface ClientDownloadUpdate {
  state: 'preparing' | 'transferring' | 'saving' | 'completed' | 'cancelled' | 'failed'
  transferredBytes: number
  totalBytes?: number
  name?: string
  error?: string
}

/** Count acknowledged client writes, not bytes queued on the server socket. */
export async function saveClientDownload(url: string, destination: Promise<DownloadDestination>, signal: AbortSignal, update: (value: ClientDownloadUpdate) => void): Promise<void> {
  let writer: Awaited<ReturnType<DownloadDestination['createWritable']>> | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let response: Response | undefined
  let transferredBytes = 0
  const metadata: { totalBytes?: number } = {}
  try {
    const handle = await abortable(destination, signal)
    signal.throwIfAborted()
    update({ state: 'preparing', transferredBytes, name: handle.name })
    response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    if (!response.body || !/^attachment\b/i.test(response.headers.get('Content-Disposition') ?? '')) throw new Error('Invalid download response')
    const length = response.headers.get('Content-Length')
    // Fetch exposes decoded bytes, so a compressed wire length is not usable.
    const encoding = response.headers.get('Content-Encoding')
    if ((!encoding || encoding === 'identity') && length !== null && /^\d+$/.test(length) && Number.isSafeInteger(Number(length))) metadata.totalBytes = Number(length)
    signal.throwIfAborted()
    writer = await abortable(handle.createWritable(), signal, late => { void late.abort(signal.reason).catch(() => {}) })
    reader = response.body.getReader()
    let reportedAt = 0
    update({ state: 'transferring', transferredBytes, ...metadata })
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await abortable(reader.read(), signal)
      if (done) break
      signal.throwIfAborted()
      await abortable(writer.write(value), signal)
      transferredBytes += value.byteLength
      if (metadata.totalBytes !== undefined && transferredBytes > metadata.totalBytes) throw new Error('Download length mismatch')
      if (Date.now() - reportedAt >= 100) {
        update({ state: 'transferring', transferredBytes, ...metadata })
        reportedAt = Date.now()
      }
    }
    if (metadata.totalBytes !== undefined && transferredBytes !== metadata.totalBytes) throw new Error('Download interrupted: incomplete file')
    signal.throwIfAborted()
    update({ state: 'saving', transferredBytes, ...metadata })
    await writer.close()
    writer = undefined
    update({ state: 'completed', transferredBytes, ...metadata })
  } catch (error) {
    if (writer) await writer.abort(error).catch(() => {})
    const cancelled = signal.aborted || (error instanceof Error && error.name === 'AbortError')
    update({ state: cancelled ? 'cancelled' : 'failed', transferredBytes, ...metadata, ...(cancelled ? {} : { error: error instanceof Error ? error.message : String(error) }) })
  } finally {
    if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock() }
    else await response?.body?.cancel().catch(() => {})
  }
}

/** Abort waiting work immediately; late file handles must never be committed. */
function abortable<T>(pending: Promise<T>, signal: AbortSignal, late?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let aborted = false
    const abort = (): void => { aborted = true; signal.removeEventListener('abort', abort); reject(signal.reason ?? new DOMException('Cancelled', 'AbortError')) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    pending.then(value => {
      signal.removeEventListener('abort', abort)
      if (aborted) late?.(value)
      else resolve(value)
    }, error => { signal.removeEventListener('abort', abort); reject(error) })
  })
}
