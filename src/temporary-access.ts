import type { Context } from '@deepseek-ai/cordis'
import type { ApprovalService } from '@deepseek-ai/dsh-user-approval'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { SshProfile } from './domain.js'
import type { SshStore } from './store.js'
import type { SshConnector } from './connector.js'
import { executeSshCommand } from './exec.js'
import { normalizeRemoteDirectory } from './directory.js'

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

export function registerTemporaryAccess(ctx: Context, store: SshStore, connector: SshConnector): () => void {
  // No durable injection is changed, and grants are never copied to child agents.
  const turns = new Map<string, { turn: number; signal: AbortSignal; grants: Map<string, string> }>()
  const fingerprint = (profile: SshProfile): string => JSON.stringify(profile)
  const disposers: Array<() => void> = [
    ctx.on('agent/pre-step', async ({ agent, turn, signal }, next) => {
      const id = agent.session.id
      if (turns.get(id)?.turn !== turn) turns.set(id, { turn, signal, grants: new Map() })
      return next()
    }),
    ctx.on('session/event', (session, event) => {
      if (event.type === 'turn/end') turns.delete(session.id)
    }),
    ctx.on('agent/status', ({ agent, status }) => { if (status === 'idle') turns.delete(agent.session.id) }),
    ctx.on('agent/error', ({ agent }) => { turns.delete(agent.session.id) }),
    ctx.on('agent/disposed', ({ agent }) => { turns.delete(agent.session.id) }),
  ]
  const output = { schema: { type: 'string' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }] }
  disposers.push(ctx.tools.register(defineTool({
    name: 'ssh_request_temporary_access',
    description: 'When the user asks you to work on a saved SSH host by name, full IP, or unique IPv4 last octet (e.g. 78), request temporary command access here. Always state the actual task. A user confirmation dialog is mandatory. On approval use ssh_temporary_exec with the returned profileId. Access expires automatically at the end of this agent turn, cancellation, or error; it is not a permanent host mount. Never request access speculatively or retry a rejection without user direction.',
    parameters: { target: { type: 'string', required: true }, task: { type: 'string', required: true, description: 'The concrete task requested by the user.' } },
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
      const approval = ctx.get('approval') as ApprovalService | undefined
      if (!approval) throw new Error('当前环境无法显示授权确认，未授予权限。')
      const reason = `临时授权 SSH：${profile.name}（${profile.username}@${profile.host}:${profile.port}）\n任务：${args.task.trim()}\n允许 Agent 在本轮任务中执行远程命令（可修改远端文件）；任务结束、停止或出错后自动撤销，不会永久挂载。`
      const result = await approval.request({ agent: exec.agent, toolName: exec.name, callId: exec.callId, reason, signal: AbortSignal.any([exec.signal, current.signal]) })
      if (result !== 'allowed-once') throw new Error('用户未确认临时授权，不能访问该主机。')
      if (turns.get(id) !== current || current.signal.aborted || exec.signal.aborted) throw new Error('任务已结束，授权未生效。')
      const latest = store.profile(profile.id)
      if (!latest || fingerprint(latest) !== identity) throw new Error('主机配置已改变，请重新确认授权。')
      current.grants.set(profile.id, identity)
      return JSON.stringify({ profileId: profile.id, name: profile.name, host: profile.host, expires: 'current-agent-turn-end', tool: 'ssh_temporary_exec' })
    },
  })))
  disposers.push(ctx.tools.register(defineTool({
    name: 'ssh_temporary_exec',
    description: 'Execute a command on a host explicitly approved through ssh_request_temporary_access during this agent turn. Does not use or change permanent session mounts. Use cwd for a working directory. Approval is required again in later turns.',
    parameters: { profileId: { type: 'string', required: true }, command: { type: 'string', required: true }, cwd: { type: 'string' }, timeoutMs: { type: 'integer' } },
    output,
    isConcurrencySafe: () => false,
    presentCall: args => ({ card: 'terminal', title: `SSH 临时执行 · ${args.command}` }),
    execute: async (args, exec) => {
      const current = exec.agent ? turns.get(exec.agent.session.id) : undefined
      const profile = typeof args.profileId === 'string' ? store.profile(args.profileId) : undefined
      if (!current || current.signal.aborted || exec.signal.aborted || !profile || current.grants.get(profile.id) !== fingerprint(profile)) throw new Error('没有有效的本轮临时授权，请先请求用户确认。')
      if (typeof args.command !== 'string' || !args.command.trim() || args.command.length > 100000) throw new Error('无效命令。')
      const settings = store.settings(), timeout = args.timeoutMs ?? settings.defaultCommandTimeoutMs
      if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1000 || timeout > 300000) throw new Error('timeoutMs 必须为 1000–300000。')
      return JSON.stringify(await executeSshCommand(connector, profile.id, args.command, timeout, settings.maxOutputChars, AbortSignal.any([exec.signal, current.signal]), normalizeRemoteDirectory(args.cwd ?? '~')))
    },
  })))
  return () => { turns.clear(); for (const dispose of disposers.reverse()) dispose() }
}
