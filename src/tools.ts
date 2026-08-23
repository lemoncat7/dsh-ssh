import type { TerminalSignal } from '@deepseek-ai/dsh-terminal'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { executeSshCommand } from './exec.js'
import { sessionDirectory, setSessionDirectory } from './directory.js'
import { ForwardManager } from './forwards.js'
import { SshConnector } from './connector.js'
import { SshStore } from './store.js'
import { AiTerminalManager } from './terminal.js'

const textOutput = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }],
}

const APPROVAL_TOOLS = new Set(['ssh_exec', 'ssh_terminal_open', 'ssh_terminal_send', 'ssh_terminal_signal', 'ssh_forward_start', 'ssh_forward_stop'])

export function registerSshTools(ctx: Context, store: SshStore, connector: SshConnector, forwards: ForwardManager, terminals: AiTerminalManager): void {
  const tools: ToolDefinition[] = [
    listTool(store),
    cwdTool(store, connector),
    execTool(store, connector),
    terminalOpenTool(store, terminals),
    terminalSendTool(store, terminals),
    terminalReadTool(store, terminals),
    terminalSignalTool(store, terminals),
    terminalCloseTool(store, terminals),
    forwardListTool(store, forwards),
    forwardStartTool(store, forwards),
    forwardStopTool(store, forwards),
  ]
  for (const tool of tools) ctx.tools.register(tool)

  ctx.on('tools/pre-execute', async (exec, next) => {
    if (!APPROVAL_TOOLS.has(exec.name)) return next()
    const sessionId = exec.agent?.session.id
    if (sessionId === undefined) return next()
    const injection = store.injection(sessionId)
    if (injection?.requireCommandApproval !== true) return next()
    return { kind: 'ask', reason: `SSH access to an injected remote host was requested by ${exec.name}.` }
  })
}

function listTool(store: SshStore): ToolDefinition {
  return tool('ssh_list', 'List SSH connections explicitly injected into this DSH conversation. It never reveals credentials or non-injected hosts.', {}, async (_args, exec) => {
    const injection = requireInjection(store, exec)
    const profiles = injection.profileIds.map(id => store.profile(id)).filter(item => item !== undefined).map(profile => ({
      id: profile.id, name: profile.name, host: profile.host, port: profile.port, username: profile.username,
      ...(profile.group === undefined ? {} : { group: profile.group }),
      tags: profile.tags, permission: injection.permission, cwd: sessionDirectory(injection, profile.id),
    }))
    return json({ sessionId: injection.sessionId, profiles })
  }, true)
}

function cwdTool(store: SshStore, connector: SshConnector): ToolDefinition {
  return tool('ssh_set_cwd', 'Set and verify the working directory used by subsequent ssh_exec and ssh_terminal_open calls for one injected connection in this conversation.', {
    profileId: { type: 'string', required: true, description: 'Exact injected profile id returned by ssh_list.' },
    cwd: { type: 'string', required: true, description: 'Remote directory path. Supports absolute paths and paths under ~.' },
  }, async (raw, exec) => {
    const args = object(raw)
    const profileId = string(args.profileId, 'profileId', 100)
    requireProfile(store, exec, profileId, 'exec')
    const sessionId = exec.agent!.session.id
    const cwd = await setSessionDirectory(store, connector, sessionId, profileId, rawString(args.cwd, 'cwd', 4096), exec.signal)
    return json({ profileId, cwd })
  })
}

function execTool(store: SshStore, connector: SshConnector): ToolDefinition {
  return tool('ssh_exec', 'Run one non-interactive command on an SSH connection injected into this conversation. Use ssh_list first and pass an exact profile id. Output is bounded.', {
    profileId: { type: 'string', required: true, description: 'Exact injected profile id returned by ssh_list.' },
    command: { type: 'string', required: true, description: 'Command to execute on the remote host.' },
    timeoutMs: { type: 'integer', description: 'Optional timeout between 1000 and 300000 milliseconds.' },
  }, async (raw, exec) => {
    const args = object(raw)
    const profileId = string(args.profileId, 'profileId', 100)
    const injection = requireInjection(store, exec)
    requireProfile(store, exec, profileId, 'exec')
    const settings = store.settings()
    const timeout = optionalInteger(args.timeoutMs, 'timeoutMs', 1000, 300_000) ?? settings.defaultCommandTimeoutMs
    return json(await executeSshCommand(connector, profileId, string(args.command, 'command', 100_000), timeout, settings.maxOutputChars, exec.signal, sessionDirectory(injection, profileId)))
  })
}

function terminalOpenTool(store: SshStore, terminals: AiTerminalManager): ToolDefinition {
  return tool('ssh_terminal_open', 'Open an interactive terminal on an SSH connection injected with terminal permission. Returns an owner-scoped terminal id.', {
    profileId: { type: 'string', required: true, description: 'Exact injected profile id returned by ssh_list.' },
    name: { type: 'string', description: 'Optional terminal display name.' },
  }, async (raw, exec) => {
    const args = object(raw)
    const profileId = string(args.profileId, 'profileId', 100)
    const injection = requireInjection(store, exec)
    const owner = requireProfile(store, exec, profileId, 'terminal')
    const name = args.name === undefined ? undefined : string(args.name, 'name', 80)
    return json(await terminals.create(owner.session.id, profileId, sessionDirectory(injection, profileId), name, exec.signal))
  })
}

function terminalSendTool(store: SshStore, terminals: AiTerminalManager): ToolDefinition {
  return tool('ssh_terminal_send', 'Send text to an owned SSH terminal and wait until output becomes idle, the command exits, or timeout is reached.', {
    terminalId: { type: 'string', required: true },
    text: { type: 'string', required: true },
    submit: { type: 'boolean', description: 'Append Enter after text. Defaults to true.' },
  }, async (raw, exec) => {
    const args = object(raw)
    const owner = requireAnyInjection(store, exec)
    return json(await terminals.send(owner.session.id, string(args.terminalId, 'terminalId', 200), {
      text: rawString(args.text, 'text', 100_000), submit: args.submit !== false, signal: exec.signal,
    }))
  })
}

function terminalReadTool(store: SshStore, terminals: AiTerminalManager): ToolDefinition {
  return tool('ssh_terminal_read', 'Read bounded scrollback from an owned SSH terminal.', {
    terminalId: { type: 'string', required: true },
    offset: { type: 'integer' },
    count: { type: 'integer' },
  }, async (raw, exec) => {
    const args = object(raw)
    const owner = requireAnyInjection(store, exec)
    return json(terminals.get(owner.session.id, string(args.terminalId, 'terminalId', 200)).read({
      ...args.offset === undefined ? {} : { offset: integer(args.offset, 'offset', 0, 1_000_000) },
      ...args.count === undefined ? {} : { count: integer(args.count, 'count', 1, 2000) },
    }))
  }, true)
}

function terminalSignalTool(store: SshStore, terminals: AiTerminalManager): ToolDefinition {
  return tool('ssh_terminal_signal', 'Send an allowed POSIX signal to an owned SSH terminal.', {
    terminalId: { type: 'string', required: true },
    signal: { type: 'string', required: true, enum: ['SIGINT', 'SIGTERM', 'SIGKILL', 'SIGTSTP', 'SIGHUP'] },
  }, async (raw, exec) => {
    const args = object(raw)
    const owner = requireAnyInjection(store, exec)
    const signal = string(args.signal, 'signal', 16) as TerminalSignal
    return json(await terminals.get(owner.session.id, string(args.terminalId, 'terminalId', 200)).signal(signal))
  })
}

function terminalCloseTool(store: SshStore, terminals: AiTerminalManager): ToolDefinition {
  return tool('ssh_terminal_close', 'Close an owned SSH terminal.', { terminalId: { type: 'string', required: true } }, async (raw, exec) => {
    const owner = requireAnyInjection(store, exec)
    const args = object(raw)
    return json({ closed: await terminals.close(owner.session.id, string(args.terminalId, 'terminalId', 200)) })
  })
}

function forwardListTool(store: SshStore, forwards: ForwardManager): ToolDefinition {
  return tool('ssh_forward_list', 'List port-forward rules belonging to SSH connections injected into this conversation.', {}, async (_raw, exec) => {
    const injection = requireInjection(store, exec)
    const statuses = new Map(forwards.list().map(item => [item.ruleId, item]))
    const rules = store.forwards().filter(rule => injection.profileIds.includes(rule.profileId)).map(rule => ({ ...rule, status: statuses.get(rule.id) }))
    return json({ rules })
  }, true)
}

function forwardStartTool(store: SshStore, forwards: ForwardManager): ToolDefinition {
  return tool('ssh_forward_start', 'Start an existing port-forward rule whose SSH profile is injected into this conversation. Public binds remain subject to plugin policy.', {
    ruleId: { type: 'string', required: true },
  }, async (raw, exec) => {
    const ruleId = string(object(raw).ruleId, 'ruleId', 100)
    requireForward(store, exec, ruleId)
    return json(await forwards.start(ruleId))
  })
}

function forwardStopTool(store: SshStore, forwards: ForwardManager): ToolDefinition {
  return tool('ssh_forward_stop', 'Stop a running port-forward rule whose SSH profile is injected into this conversation.', {
    ruleId: { type: 'string', required: true },
  }, async (raw, exec) => {
    const ruleId = string(object(raw).ruleId, 'ruleId', 100)
    requireForward(store, exec, ruleId)
    return json(await forwards.stop(ruleId))
  })
}

function tool(
  name: string,
  description: string,
  properties: Record<string, Record<string, unknown>>,
  execute: (args: unknown, exec: ToolRunContext) => Promise<string>,
  concurrencySafe = false,
): ToolDefinition {
  const required = Object.entries(properties).filter(([, value]) => value.required === true).map(([key]) => key)
  const schemaProperties = Object.fromEntries(Object.entries(properties).map(([key, value]) => {
    const { required: _required, ...schema } = value
    return [key, schema]
  }))
  return {
    name, description,
    parameters: { type: 'object', additionalProperties: false, properties: schemaProperties, required },
    output: textOutput,
    execute,
    isConcurrencySafe: () => concurrencySafe,
    presentCall: args => ({ card: 'terminal', title: presentTitle(name, args) }),
  }
}

function presentTitle(name: string, value: unknown): string {
  const args = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  if (name === 'ssh_exec' && typeof args.command === 'string') return args.command
  if (typeof args.profileId === 'string') return `${name} · ${args.profileId}`
  return name
}

function requireInjection(store: SshStore, exec: ToolRunContext) {
  const sessionId = exec.agent?.session.id
  if (sessionId === undefined) throw new Error('SSH tools require an owning DSH session')
  const injection = store.injection(sessionId)
  if (injection === undefined || injection.profileIds.length === 0) throw new Error('No SSH connection is injected into this DSH session. Ask the user to open 远端 and inject one.')
  return injection
}

function requireAnyInjection(store: SshStore, exec: ToolRunContext) {
  requireInjection(store, exec)
  if (exec.agent === undefined) throw new Error('SSH tools require an owning agent')
  return exec.agent
}

function requireProfile(store: SshStore, exec: ToolRunContext, profileId: string, permission: 'exec' | 'terminal') {
  const injection = requireInjection(store, exec)
  if (!injection.profileIds.includes(profileId)) throw new Error('The requested SSH profile is not injected into this DSH session')
  if (permission === 'terminal' && injection.permission !== 'terminal') throw new Error('This session injection permits one-shot commands but not interactive terminals')
  if (exec.agent === undefined) throw new Error('SSH tools require an owning agent')
  return exec.agent
}

function requireForward(store: SshStore, exec: ToolRunContext, ruleId: string): void {
  const rule = store.forward(ruleId)
  if (rule === undefined) throw new Error('Port-forward rule was not found')
  requireProfile(store, exec, rule.profileId, 'terminal')
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('arguments must be an object')
  return value as Record<string, unknown>
}

function string(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) throw new Error(`${name} must be a non-empty string with at most ${max} characters`)
  return value.trim()
}

function rawString(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${name} must be a string with at most ${max} characters`)
  return value
}

function integer(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`)
  return value
}

function optionalInteger(value: unknown, name: string, min: number, max: number): number | undefined {
  return value === undefined ? undefined : integer(value, name, min, max)
}

function json(value: unknown): string { return JSON.stringify(value, null, 2) }
