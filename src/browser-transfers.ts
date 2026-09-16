import type { MouseEvent } from 'react'
import type { DownloadProgress } from './download-progress.js'

export interface BrowserTransfer {
  id: string
  name: string
  direction: 'upload' | 'download'
  state: DownloadProgress['state'] | 'waiting' | 'unavailable'
  transferredBytes: number
  totalBytes?: number
  error?: string
}
let snapshot: BrowserTransfer[] = []
const listeners = new Set<() => void>()
export const browserTransfers = {
  getSnapshot: () => snapshot,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
}
export function updateBrowserTransfer(id: string, patch: Partial<BrowserTransfer>): void {
  snapshot = snapshot.map(item => item.id === id ? { ...item, ...patch } : item)
  for (const listener of listeners) listener()
}
export function createBrowserTransfer(name: string, direction: BrowserTransfer['direction'], totalBytes?: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const id = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  const job: BrowserTransfer = { id, name, direction, state: 'preparing', transferredBytes: 0, ...(totalBytes === undefined ? {} : { totalBytes }) }
  const active = snapshot.filter(item => item.state === 'preparing' || item.state === 'transferring' || item.state === 'waiting')
  const history = snapshot.filter(item => item.state === 'completed' || item.state === 'failed' || item.state === 'unavailable')
  snapshot = [job, ...active, ...history.slice(0, Math.max(0, 49 - active.length))]
  for (const listener of listeners) listener()
  return id
}
export function dismissBrowserTransfer(id: string): void {
  snapshot = snapshot.filter(item => item.id !== id)
  for (const listener of listeners) listener()
}

/** Keep browser-native streaming downloads: never materialize a Blob in memory. */
export function trackDownloadClick(event: MouseEvent<HTMLAnchorElement>): void {
  event.stopPropagation()
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return
  const anchor = event.currentTarget
  const originalHref = anchor.href
  const url = new URL(anchor.href, location.href)
  if (url.origin !== location.origin || !/\/(?:download|local-download)$/.test(url.pathname)) return
  const name = (url.searchParams.get('path') ?? '').replaceAll('\\', '/').split('/').filter(Boolean).at(-1) || anchor.download || 'download'
  const id = createBrowserTransfer(name, 'download')
  url.searchParams.set('transferId', id)
  anchor.href = url.href
  // Restore the reusable link after native navigation captures this request;
  // context-menu downloads must not reuse an already consumed tracking ID.
  setTimeout(() => { if (anchor.href === url.href) anchor.href = originalHref }, 0)
  void pollDownload(id)
}

async function pollDownload(id: string): Promise<void> {
  let misses = 0
  let seen = false
  while (snapshot.some(item => item.id === id)) {
    await new Promise(resolve => setTimeout(resolve, 800))
    try {
      const response = await fetch(`/ssh-local/v1/download-progress?id=${id}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const status = await response.json() as DownloadProgress
      if (!['preparing', 'transferring', 'completed', 'failed'].includes(status.state) || !Number.isFinite(status.transferredBytes)) throw new Error('Invalid download progress response')
      seen = true; misses = 0
      updateBrowserTransfer(id, status)
      if (status.state === 'completed' || status.state === 'failed') return
    } catch {
      misses++
      if (misses >= (seen ? 5 : 20)) {
        // The browser may still be downloading. A lost status connection is not
        // proof that the file failed, and must not be reported as success either.
        updateBrowserTransfer(id, { state: 'unavailable' })
        return
      }
    }
  }
}
