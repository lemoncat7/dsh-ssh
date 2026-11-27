type Owner = { readonly id: string | undefined } | string
interface View { dispose(): void }

/** Retain detached views, never remote connections. Attached views cannot be evicted. */
export class TerminalViewCache<T extends View> {
  private readonly entries = new Map<Owner, { view: T; attached: number; keep: boolean }>()
  constructor(private readonly limit = 32) {}

  acquire(owner: Owner, create: () => T): { view: T; release(): void } {
    let entry = this.entries.get(owner)
    if (!entry) { entry = { view: create(), attached: 0, keep: true }; this.entries.set(owner, entry) }
    else { this.entries.delete(owner); this.entries.set(owner, entry) }
    entry.attached++
    this.trim()
    let released = false
    return { view: entry.view, release: () => {
      if (released) return
      released = true
      entry.attached--
      if (this.entries.get(owner) !== entry) return
      if (!entry.attached && (!entry.keep || typeof owner !== 'string' && !owner.id)) { this.entries.delete(owner); entry.view.dispose() }
      this.trim()
    } }
  }

  /** Explicit terminal removal drops idle views and releases mounted ones on detach. */
  drop(owner: Owner): void {
    const entry = this.entries.get(owner)
    if (!entry) return
    entry.keep = false
    if (!entry.attached) { this.entries.delete(owner); entry.view.dispose() }
  }

  clear(): void {
    for (const entry of this.entries.values()) entry.view.dispose()
    this.entries.clear()
  }

  private trim(): void {
    for (const [owner, entry] of this.entries) {
      if (this.entries.size <= this.limit) break
      if (entry.attached) continue
      this.entries.delete(owner)
      entry.view.dispose()
    }
  }
}
