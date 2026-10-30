import { defineTool, type ToolDefinition, type ToolExecution } from '@deepseek-ai/dsh-tools'
import type { SshStore } from './store.js'
import { canTransferFiles } from './file-access-policy.js'

export type RegisterOperation = (definition: ToolDefinition) => () => void
export const SSH_ENTRY = 'ssh'

/** Decode only this plugin's fixed dispatcher; discovery never asks for approval. */
export function sshOperation(exec: Pick<ToolExecution, 'name' | 'arguments'>): { name: string; arguments: unknown } {
  if (exec.name !== SSH_ENTRY) return exec
  const args = exec.arguments as Record<string, unknown> | undefined
  return args?.action === 'call' && typeof args.tool === 'string'
    ? { name: args.tool, arguments: args.arguments ?? {} } : { name: '', arguments: {} }
}

function allowed(name: string, store: SshStore, sessionId: string): boolean {
  if (name === 'ssh_request_temporary_access' || name === 'ssh_temporary_exec') return true
  const access = store.injection(sessionId)
  if (name.startsWith('file_')) {
    if (!access?.fileEndpointIds?.length) return false
    return !['file_transfer_start', 'file_transfer_cancel', 'file_download_to_local', 'file_upload_from_local'].includes(name)
      || access.fileEndpointIds.some(id => canTransferFiles(access, id))
  }
  if (!access?.profileIds.length) return false
  if (name === 'ssh_exec') return access.permission === 'exec'
  if (name.startsWith('ssh_terminal_') || ['ssh_forward_start', 'ssh_forward_stop'].includes(name)) return access.permission === 'terminal'
  return true
}

export function sshEntry(store: SshStore, operations: ReadonlyMap<string, ToolDefinition>): ToolDefinition {
  return defineTool({
    name: SSH_ENTRY,
    description: 'SSH and FTP/SFTP single entry: list available operations, describe one operation to get its exact parameters, then call it. Covers saved-host discovery, authorized commands/terminals, temporary SSH access, port forwarding and file transfers. Never guess IDs or replace file transfer with shell servers/base64. Only download when a saved local copy is actually needed. All session permissions and approval rules still apply.',
    parameters: {
      action: { type: 'string', enum: ['list', 'describe', 'call'], required: true },
      tool: { type: 'string', description: 'Exact operation name from list; required for describe/call.' },
      arguments: { type: 'object', additionalProperties: true, description: 'For call: parameters from describe, as a JSON object.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    isConcurrencySafe: args => args.action === 'list' || args.action === 'describe',
    presentCall: args => ({ card: 'terminal', title: `SSH · ${args.action === 'list' ? '操作目录' : args.action === 'describe' ? `操作说明 · ${args.tool ?? ''}` : args.tool ?? ''}` }),
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      if (!exec.agent) throw new Error('SSH requires an owning DSH session')
      const visible = [...operations.values()].filter(tool => allowed(tool.name, store, exec.agent!.session.id))
      if (args.action === 'list') return JSON.stringify({ operations: visible.map(tool => ({ name: tool.name, summary: tool.description.split(/\.\s/)[0] })), next: 'Use action=describe with a tool name, then action=call with its arguments. Unlisted operations require the relevant session access.' })
      if (!args.tool || !operations.has(args.tool)) throw new Error('Unknown SSH operation; use action=list first')
      const tool = operations.get(args.tool)!
      if (!visible.includes(tool)) throw new Error('Operation is not allowed by this session permission mode; use action=list or configure session access')
      if (args.action === 'describe') return JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters })
      // Each operation was created with defineTool: its original schema is
      // validated again here, followed by live host/endpoint/owner checks.
      // The host gates the visible entry call; plugin approval hooks decode
      // this exact operation without replacing its registry-owned identity.
      return String(await tool.execute(args.arguments ?? {}, exec))
    },
  })
}
