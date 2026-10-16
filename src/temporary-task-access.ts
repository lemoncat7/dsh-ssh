import type { SshProfile } from './domain.js'

export interface TaskTarget {
  taskId: string; companionId: string; companionName: string; title: string; scope: string
  valid(): boolean
}
export interface PartnerTaskResolver {
  resolve(taskId: string, requesterSessionId: string): TaskTarget
}
interface Ticket { target: TaskTarget; profile: SshProfile; fingerprint: string; owner: string; expiresAt: number; sessionId?: string; controller: AbortController; timer: ReturnType<typeof setTimeout> }

/** In-memory, one-execution leases. Never changes mounts or exposes credentials. */
export class TemporaryTaskAccess {
  private tickets = new Map<string, Ticket>()
  constructor(private readonly profile: (id: string) => SshProfile | undefined, private readonly now = Date.now) {}
  grant(target: TaskTarget, profile: SshProfile, owner: string): void {
    this.prune()
    const key = `${target.taskId}:${profile.id}`
    if (this.tickets.get(key)?.sessionId) throw new Error('任务已经使用临时授权，请先结束当前执行')
    if (this.tickets.size >= 256) throw new Error('临时授权数量已达上限，请先结束已有任务')
    this.remove(key)
    const controller = new AbortController()
    const timer = setTimeout(() => this.remove(key), 60 * 60_000); timer.unref?.()
    this.tickets.set(key, { target, profile, fingerprint: JSON.stringify(profile), owner, expiresAt: this.now() + 60 * 60_000, controller, timer })
  }
  bind(input: { taskId: string; companionId: string; sessionId: string; signal?: AbortSignal }): { prompt: string; dispose(): void } {
    this.prune()
    const selected = [...this.tickets.entries()].filter(([, t]) => t.target.taskId === input.taskId && t.target.companionId === input.companionId && !t.sessionId)
    if (input.signal?.aborted) return { prompt: '', dispose() {} }
    for (const [, t] of selected) t.sessionId = input.sessionId
    const dispose = () => { for (const [key, ticket] of selected) if (this.tickets.get(key) === ticket) this.remove(key); input.signal?.removeEventListener('abort', dispose) }
    input.signal?.addEventListener('abort', dispose, { once: true })
    return { prompt: selected.length ? '\n本次看板任务已取得用户临时 SSH 授权，仅本次执行有效；不要重新申请或永久挂载。使用 ssh_temporary_exec，主机：' + selected.map(([, t]) => `${t.profile.name}（profileId=${t.profile.id}）`).join('、') : '', dispose }
  }
  has(sessionId: string, profile: SshProfile): boolean {
    return !!this.signal(sessionId, profile)
  }
  signal(sessionId: string, profile: SshProfile): AbortSignal | undefined {
    this.prune()
    return [...this.tickets.values()].find(t => t.sessionId === sessionId && t.profile.id === profile.id && t.fingerprint === JSON.stringify(profile))?.controller.signal
  }
  revokeSession(sessionId: string, owner = false): void {
    for (const [key, t] of this.tickets) if (t.sessionId === sessionId || (owner && t.owner === sessionId)) this.remove(key)
  }
  clear(): void { for (const key of this.tickets.keys()) this.remove(key) }
  private remove(key: string): void { const t = this.tickets.get(key); if (t) { clearTimeout(t.timer); t.controller.abort(); this.tickets.delete(key) } }
  private prune(): void {
    for (const [key, t] of this.tickets) if (t.expiresAt <= this.now() || !t.target.valid() || JSON.stringify(this.profile(t.profile.id)) !== t.fingerprint) this.remove(key)
  }
}
