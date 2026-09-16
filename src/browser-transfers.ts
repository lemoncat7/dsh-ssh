import type { MouseEvent } from 'react'
import { saveClientDownload, type ClientDownloadUpdate, type SaveFilePicker } from './client-download.js'

export interface BrowserTransfer {
  id: string
  name: string
  direction: 'upload' | 'download'
  state: ClientDownloadUpdate['state'] | 'waiting' | 'unavailable'
  transferredBytes: number
  totalBytes?: number
  error?: string
  createdAt: number
  completedAt?: number
}
let snapshot: BrowserTransfer[] = []
const listeners = new Set<() => void>()
const downloadControllers = new Map<string, AbortController>()
export const browserTransfers = {
  getSnapshot: () => snapshot,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
}
export function updateBrowserTransfer(id: string, patch: Partial<BrowserTransfer>): void {
  snapshot = snapshot.map(item => item.id === id ? { ...item, ...patch, ...((patch.state === 'completed' || patch.state === 'failed' || patch.state === 'cancelled') && item.completedAt === undefined ? { completedAt: Date.now() } : {}) } : item)
  for (const listener of listeners) listener()
}
export function createBrowserTransfer(name: string, direction: BrowserTransfer['direction'], totalBytes?: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const id = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  const job: BrowserTransfer = { id, name, direction, state: 'preparing', transferredBytes: 0, createdAt: Date.now(), ...(totalBytes === undefined ? {} : { totalBytes }) }
  const active = snapshot.filter(isBrowserTransferActive)
  const history = snapshot.filter(item => !isBrowserTransferActive(item))
  snapshot = [job, ...active, ...history.slice(0, Math.max(0, 49 - active.length))]
  for (const listener of listeners) listener()
  return id
}
export function dismissBrowserTransfer(id: string): void {
  if (snapshot.some(item => item.id === id && isBrowserTransferActive(item))) return
  snapshot = snapshot.filter(item => item.id !== id)
  for (const listener of listeners) listener()
}

export function isBrowserTransferActive(job: BrowserTransfer): boolean {
  return job.state === 'preparing' || job.state === 'transferring' || job.state === 'waiting' || job.state === 'saving'
}

export function canCancelBrowserTransfer(job: BrowserTransfer): boolean {
  return downloadControllers.has(job.id) && isBrowserTransferActive(job) && job.state !== 'saving'
}

export function cancelBrowserTransfer(id: string): void { downloadControllers.get(id)?.abort() }

/** Prefer client streaming to a user-selected file; never buffer a full Blob. */
export function trackDownloadClick(event: MouseEvent<HTMLAnchorElement>): void {
  event.stopPropagation()
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return
  const anchor = event.currentTarget
  const url = new URL(anchor.href, location.href)
  if (url.origin !== location.origin || !/\/(?:download|local-download)$/.test(url.pathname)) return
  const name = anchor.download || (url.searchParams.get('path') ?? '').replaceAll('\\', '/').split('/').filter(Boolean).at(-1) || 'download'
  const id = createBrowserTransfer(name, 'download')
  const picker = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker
  if (!window.isSecureContext || typeof picker !== 'function') {
    // Native anchor downloads expose no client progress or save acknowledgement,
    // including Desktop hosts without a download bridge. Do not poll server bytes.
    updateBrowserTransfer(id, { state: 'unavailable' })
    return
  }
  event.preventDefault()
  const controller = new AbortController()
  downloadControllers.set(id, controller)
  let destination: ReturnType<SaveFilePicker>
  // Invoke in the click's activation scope. Never auto-fallback after cancellation
  // or denial: that would start a second, unexpected download.
  try { destination = picker.call(window, { suggestedName: name }) }
  catch (error) { destination = Promise.reject(error) }
  void saveClientDownload(url.href, destination, controller.signal, value => updateBrowserTransfer(id, value))
    .finally(() => { downloadControllers.delete(id) })
}
