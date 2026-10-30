import type { ManagedSshConnection } from './connector.js'

type Entry = {
  key: string
  controller: AbortController
  opening: Promise<ManagedSshConnection>
  connection?: ManagedSshConnection
  users: number
  retired: boolean
  timer?: ReturnType<typeof setTimeout>
}

/** Shares authentication only. Every lease still opens its own SSH channel. */
export class TerminalConnectionPool {
  private readonly entries = new Map<string, Entry>()
  private readonly all = new Set<Entry>()
  private closed = false
  constructor(private readonly idleMs = 30_000, private readonly limit = 32) {}

  async acquire(key: string, open: (signal: AbortSignal) => Promise<ManagedSshConnection>, signal?: AbortSignal): Promise<ManagedSshConnection> {
    signal?.throwIfAborted()
    if (this.closed) throw new Error('SSH connection pool is closed')
    let entry = this.entries.get(key)
    if (!entry) {
      // Bound idle and in-flight resources, including retired active transports.
      if (this.all.size >= this.limit) {
        for (const idle of this.all) if (idle.users === 0) { this.retire(idle); break }
        if (this.all.size >= this.limit) throw new Error('SSH connection pool is full; close unused terminals first')
      }
      const controller = new AbortController()
      entry = { key, controller, opening: undefined!, users: 0, retired: false }
      const created = entry
      this.entries.set(key, entry)
      this.all.add(entry)
      entry.opening = Promise.resolve().then(() => open(controller.signal)).then(connection => {
        created.connection = connection
        if (created.retired || this.closed || controller.signal.aborted) {
          connection.close()
          throw new Error('SSH connection opening was cancelled or its configuration changed')
        }
        connection.client.once('close', () => this.retire(created))
        connection.client.once('end', () => this.retire(created))
        connection.client.once('error', () => this.retire(created))
        return connection
      }).catch(error => { this.retire(created); throw error })
    }
    const held = entry
    if (held.users >= 8) throw new Error('This shared SSH connection already has 8 terminals; close one or disable connection reuse')
    clearTimeout(held.timer)
    held.users++
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      held.users--
      if (held.users === 0) {
        if (held.retired || !held.connection) this.retire(held)
        else {
          held.timer = setTimeout(() => this.retire(held), this.idleMs)
          held.timer.unref()
        }
      }
    }
    let abort: (() => void) | undefined
    try {
      const connection = await (signal ? Promise.race([held.opening, new Promise<never>((_resolve, reject) => {
        abort = () => reject(signal.reason ?? new Error('SSH connection was aborted'))
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
      })]) : held.opening)
      signal?.throwIfAborted()
      if (held.retired) throw new Error('SSH connection changed; reopen the terminal')
      return connection.lease(release)
    } catch (error) { release(); throw error }
    finally { if (abort) signal?.removeEventListener('abort', abort) }
  }

  /** Stop new reuse without interrupting shells that already own a lease. */
  drain(): void { for (const entry of this.all) this.retire(entry) }
  close(): void {
    this.closed = true
    for (const entry of this.all) {
      entry.controller.abort()
      entry.connection?.close()
      this.retire(entry)
    }
    this.all.clear()
  }
  private retire(entry: Entry): void {
    entry.retired = true
    clearTimeout(entry.timer)
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key)
    if (!entry.connection || entry.users === 0 || this.closed) {
      entry.controller.abort()
      entry.connection?.close()
      this.all.delete(entry)
    }
  }
}
