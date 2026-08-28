import type { RemoteFileSystemSession } from './remote-files.js'
import { RemoteFileSystems } from './remote-file-systems.js'

interface SessionEntry {
  endpointId: string
  session: RemoteFileSystemSession | undefined
  queue: Promise<unknown>
  lastUsedAt: number
  active: boolean
}

/** Keeps one sequential control session per browser pane without sharing it with transfer jobs. */
export class EndpointSessionManager {
  private readonly entries = new Map<string, SessionEntry>()
  private readonly timer: ReturnType<typeof setInterval>
  private closed = false

  constructor(private readonly files: RemoteFileSystems, private readonly idleMs = 60_000) {
    this.timer = setInterval(() => this.collect(), Math.min(idleMs, 30_000))
    this.timer.unref?.()
  }

  run<T>(paneId: string, endpointId: string, operation: (session: RemoteFileSystemSession) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.closed) throw Object.assign(new Error('file browsing service is closed'), { status: 503 })
    validatePaneId(paneId)
    let entry = this.entries.get(paneId)
    if (entry === undefined || entry.endpointId !== endpointId) {
      if (entry !== undefined) {
        const stale = entry
        void stale.queue.catch(() => undefined).finally(() => stale.session?.close())
      }
      entry = { endpointId, session: undefined, queue: Promise.resolve(), lastUsedAt: Date.now(), active: false }
      this.entries.set(paneId, entry)
    }
    const target = entry
    const task = target.queue.catch(() => undefined).then(async () => {
      if (this.closed) throw Object.assign(new Error('file browsing service is closed'), { status: 503 })
      signal?.throwIfAborted()
      target.active = true
      if (target.session === undefined) target.session = await this.files.connect(endpointId, signal)
      try { return await operation(target.session) }
      catch (error) { target.session.close(); target.session = undefined; throw error }
      finally { target.active = false; target.lastUsedAt = Date.now() }
    })
    target.queue = task
    return task
  }

  close(paneId: string): void { const entry = this.entries.get(paneId); entry?.session?.close(); this.entries.delete(paneId) }
  closeAll(): void {
    this.closed = true
    clearInterval(this.timer)
    for (const entry of this.entries.values()) entry.session?.close()
    this.entries.clear()
  }

  private collect(): void {
    const cutoff = Date.now() - this.idleMs
    for (const [id, entry] of this.entries) if (!entry.active && entry.lastUsedAt < cutoff) this.close(id)
  }
}

function validatePaneId(value: string): void {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw Object.assign(new Error('invalid file pane id'), { status: 400 })
}
