type Listener = () => Promise<boolean | void>

/** One cheap version check shared by all mounted workspace consumers. */
export class WorkspaceRefresh {
  private readonly listeners = new Set<Listener>()
  private revision: string | undefined
  private running: Promise<void> | undefined
  constructor(private readonly readRevision: () => Promise<string>) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener); if (!this.listeners.size) this.revision = undefined }
  }

  check(): Promise<void> {
    if (this.running) return this.running
    if (!this.listeners.size) return Promise.resolve()
    this.running = this.poll().finally(() => { this.running = undefined })
    return this.running
  }

  private async poll(): Promise<void> {
    try {
      const next = await this.readRevision()
      if (!this.listeners.size || next === this.revision) return
      const results = await Promise.allSettled([...this.listeners].map(listener => listener()))
      // Failed refreshes are retried on the next check, even if the version is unchanged.
      if (this.listeners.size && results.every(result => result.status === 'fulfilled' && result.value !== false)) this.revision = next
    } catch { /* Background checks must not replace editors with network errors. */ }
  }
}
