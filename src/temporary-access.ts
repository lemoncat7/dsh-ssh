import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { SshProfile } from './domain.js'
import type { SshStore } from './store.js'
import type { SshConnector } from './connector.js'
import { executeSshCommand } from './exec.js'
import { normalizeRemoteDirectory } from './directory.js'
import { currentHumanText, consentMatches, confirmsPending } from './temporary-consent.js'
import { TemporaryTaskAccess, type PartnerTaskResolver, type TaskTarget } from './temporary-task-access.js'
import type { RegisterOperation } from './tool-entry.js'

/** Resolve only explicit identifiers; ambiguous numeric shortcuts never pick a host. */
export function resolveTemporaryHost(profiles: SshProfile[], target: string): SshProfile {
  const key = target.trim().toLowerCase()
  if (!key) throw new Error('请指定主机名、IP 或 IP 最后一段。')
  const matches = profiles.filter(profile => profile.id.toLowerCase() === key || profile.name.toLowerCase() === key || profile.host.toLowerCase() === key
    || (/^\d{1,3}$/.test(key) && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(profile.host) && profile.host.split('.').at(-1) === key))
  if (matches.length === 0) throw new Error('未找到已保存的 SSH 主机，请检查名称或完整 IP。')
  if (matches.length !== 1) throw new Error('主机标识不唯一，请指定完整 IP 或唯一主机名。')
  return matches[0]!
}

export function registerTemporaryAccess(ctx: Context, store: SshStore, connector: SshConnector, register: RegisterOperation = tool => ctx.tools.register(tool)): () => void {
  // No durable injection is changed. Cross-session leases require an exact board task.
  const turns = new Map<string, { turn: number; signal: AbortSignal; grants: Map<string, string> }>()
  const pending = new Map<string, { identity: string; taskId?: string; scope?: string; text: string; turn: number; expiresAt: number }>()
  const tasks = new TemporaryTaskAccess(id => store.profile(id))
  const fingerprint = (profile: SshProfile): string => JSON.stringify(profile)
  const disposers: Array<() => void> = [
    ctx.on('agent/pre-step', async ({ agent, turn, signal }, next) => {
      const id = agent.session.id
      if (turns.get(id)?.turn !== turn) turns.set(id, { turn, signal, grants: new Map() })
      return next()
    }),
    ctx.on('session/event', (session, event) => {
      if (event.type === 'user/message' && event.data.source.kind === 'user' && event.data.content.some(b => b.type === 'text' && /(?:撤销|取消|停止|不要|禁止).*(?:SSH|临时|授权|访问)/iu.test(b.text))) {
        turns.get(session.id)?.grants.clear(); pending.delete(session.id); tasks.revokeSession(session.id, true)
      }
      if (event.type === 'turn/end') {
        turns.delete(session.id)
        tasks.revokeSession(session.id, event.data.reason.kind !== 'completed')
        if (event.data.reason.kind !== 'completed') pending.delete(session.id)
      }
    }),
    ctx.on('agent/status', ({ agent, status }) => { if (status === 'idle') { turns.delete(agent.session.id); tasks.revokeSession(agent.session.id) } }),
    ctx.on('agent/error', ({ agent }) => { turns.delete(agent.session.id); pending.delete(agent.session.id); tasks.revokeSession(agent.session.id, true) }),
    ctx.on('agent/disposed', ({ agent }) => { turns.delete(agent.session.id); pending.delete(agent.session.id); tasks.revokeSession(agent.session.id, true) }),
    ctx.provide('dshSshTemporaryAccess', { bind: tasks.bind.bind(tasks) }),
  ]
  const output = { schema: { type: 'string' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }] }
  disposers.push(register(defineTool({
    name: 'ssh_request_temporary_access',
    description: 'Request temporary SSH command access to a saved host explicitly authorized in the CURRENT HUMAN message. The plugin verifies the real message, not your claim of consent; no approval popup is needed. If consent is unclear, show the returned scope and ask the user in chat, then retry only after their reply. For delegation, FIRST create the board task with autoRun=false and an assignee, then pass taskId here; the user must authorize that recipient, or confirm the returned scope. Only after granted=true submit that same task. Without taskId access expires at this turn end. Task grants apply to one execution, at most 60 minutes, never to other tasks or reviewers. Use ssh_temporary_exec; do not change permanent mounts.',
    parameters: { target: { type: 'string', required: true }, task: { type: 'string', required: true, description: 'The concrete task requested by the user.' }, taskId: { type: 'string', description: 'Optional exact planned board task ID for a designated executor. Create it with autoRun=false before requesting access.' } },
    output,
    isConcurrencySafe: () => false,
    presentCall: args => ({ card: 'terminal', title: `SSH 临时授权 · ${args.target}` }),
    execute: async (args, exec) => {
      if (!exec.agent) throw new Error('临时授权需要所属会话。')
      const id = exec.agent.session.id, current = turns.get(id)
      if (!current || current.signal.aborted || exec.signal.aborted) throw new Error('当前任务已结束。')
      if (typeof args.target !== 'string' || typeof args.task !== 'string' || !args.task.trim() || args.task.length > 2000) throw new Error('请提供主机和明确的任务说明。')
      const profile = resolveTemporaryHost(store.profiles(), args.target)
      const identity = fingerprint(profile)
      let target: TaskTarget | undefined
      if (args.taskId !== undefined) {
        if (typeof args.taskId !== 'string' || !args.taskId.trim() || args.taskId.length > 200) throw new Error('无效的看板任务 ID')
        const resolver = ctx.get('dshPartnerSshTaskAccess') as PartnerTaskResolver | undefined
        if (!resolver) throw new Error('伙伴任务授权桥接尚未就绪，不能将当前会话权限传给其他伙伴')
        target = resolver.resolve(args.taskId, id)
      }
      for (const [key, item] of pending) if (item.expiresAt <= Date.now()) pending.delete(key)
      const human = currentHumanText(exec.agent.session.snapshotEvents(), current.turn)
      const previous = pending.get(id)
      const confirmation = confirmsPending(human) && previous && previous.expiresAt > Date.now() && previous.turn < current.turn
        && previous.identity === identity && previous.taskId === target?.taskId && previous.scope === target?.scope && previous.text === args.task.trim()
      if (!confirmation && !consentMatches(human, profile, target?.companionName)) {
        if (pending.size >= 256 && !pending.has(id)) throw new Error('待确认申请过多，请稍后重试')
        pending.set(id, { identity, ...(target ? { taskId: target.taskId, scope: target.scope } : {}), text: args.task.trim(), turn: current.turn, expiresAt: Date.now() + 10 * 60_000 })
        return JSON.stringify({ granted: false, code: 'SSH_USER_CONSENT_REQUIRED', profileId: profile.id,
          scope: `临时 SSH：${profile.name}（${profile.username}@${profile.host}:${profile.port}）；${target ? `执行伙伴：${target.companionName}；看板任务：${target.title}（${target.taskId}）；` : '仅当前会话；'}任务：${args.task.trim()}。允许远程命令修改文件，不永久挂载。`,
          instruction: '未授予权限。向用户完整展示上述范围；用户回复“确认临时访问”后，以完全相同的 target、task 和 taskId 重试。不需要弹窗，禁止自行伪造确认或改换目标。确认有效期 10 分钟。' })
      }
      if (turns.get(id) !== current || current.signal.aborted || exec.signal.aborted) throw new Error('任务已结束，授权未生效。')
      const latest = store.profile(profile.id)
      if (!latest || fingerprint(latest) !== identity) throw new Error('主机配置已改变，请重新确认授权。')
      pending.delete(id)
      if (target) tasks.grant(target, profile, id)
      else current.grants.set(profile.id, identity)
      return JSON.stringify({ granted: true, authorization: confirmation ? 'human-confirmed-request' : 'current-human-message', profileId: profile.id, name: profile.name, host: profile.host, ...(target ? { taskId: target.taskId, companion: target.companionName } : {}), expires: target ? 'one-task-execution-max-60-minutes' : 'current-agent-turn-end', tool: 'ssh_temporary_exec' })
    },
  })))
  disposers.push(register(defineTool({
    name: 'ssh_temporary_exec',
    description: 'Execute a command using temporary SSH access verified from a human message, or a task-bound grant injected by the partner runtime. Does not change permanent mounts. Use cwd for the working directory. Expired grants must be authorized again; never assume another session shares access.',
    parameters: { profileId: { type: 'string', required: true }, command: { type: 'string', required: true }, cwd: { type: 'string' }, timeoutMs: { type: 'integer' } },
    output,
    isConcurrencySafe: () => false,
    presentCall: args => ({ card: 'terminal', title: `SSH 临时执行 · ${args.command}` }),
    execute: async (args, exec) => {
      const current = exec.agent ? turns.get(exec.agent.session.id) : undefined
      const profile = typeof args.profileId === 'string' ? store.profile(args.profileId) : undefined
      const taskSignal = exec.agent && profile ? tasks.signal(exec.agent.session.id, profile) : undefined
      if (!current || current.signal.aborted || exec.signal.aborted || !profile || (current.grants.get(profile.id) !== fingerprint(profile) && !taskSignal)) throw new Error('没有有效的本轮或本任务临时授权，请先通过 ssh_request_temporary_access 核验用户授意。')
      if (typeof args.command !== 'string' || !args.command.trim() || args.command.length > 100000) throw new Error('无效命令。')
      const settings = store.settings(), timeout = args.timeoutMs ?? settings.defaultCommandTimeoutMs
      if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1000 || timeout > 300000) throw new Error('timeoutMs 必须为 1000–300000。')
      return JSON.stringify(await executeSshCommand(connector, profile.id, args.command, timeout, settings.maxOutputChars, AbortSignal.any([exec.signal, current.signal, ...(taskSignal ? [taskSignal] : [])]), normalizeRemoteDirectory(args.cwd ?? '~')))
    },
  })))
  return () => { turns.clear(); pending.clear(); tasks.clear(); for (const dispose of disposers.reverse()) dispose() }
}
