import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { TransferConflictPolicy } from './file-transfer-manager.js'
import { FileTransferManager } from './file-transfer-manager.js'
import { RemoteFileSystems } from './remote-file-systems.js'
import { SshStore } from './store.js'

const FILE_TOOL_NAMES = new Set(['file_endpoint_list', 'file_directory_list', 'file_transfer_start', 'file_transfer_status', 'file_transfer_cancel'])
const TRANSFER_TOOL_NAMES = new Set(['file_transfer_start', 'file_transfer_cancel'])
const output = { schema: { type: 'string' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }] }

export function registerFileTransferTools(ctx: Context, store: SshStore, files: RemoteFileSystems, transfers: FileTransferManager): () => void {
  const definitions = [endpointListTool(store, files), directoryListTool(store, files), transferStartTool(store, transfers), transferStatusTool(store, transfers), transferCancelTool(store, transfers)]
  const disposers = definitions.map(definition => ctx.tools.register(definition))
  const disposeApproval = ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name !== 'file_transfer_start') return next()
    const injection = exec.agent === undefined ? undefined : store.injection(exec.agent.session.id)
    if (injection?.requireFileApproval !== true) return next()
    return { kind: 'ask', reason: 'The conversation requested a remote file transfer between authorized endpoints.' }
  })
  const disposeVisibility = installVisibility(ctx, store)
  return () => { disposeVisibility(); disposeApproval(); for (const dispose of disposers.reverse()) dispose() }
}

function endpointListTool(store: SshStore, files: RemoteFileSystems): ToolDefinition {
  return tool('file_endpoint_list', 'List remote file endpoints explicitly authorized for this DSH conversation. Credentials and unauthorized endpoints are never returned.', {}, async (_raw, exec) => {
    const injection = requireFileInjection(store, exec)
    return json({ permission: injection.filePermission, endpoints: injection.fileEndpointIds.map(id => files.endpoint(id)).filter(Boolean) })
  }, true)
}

function directoryListTool(store: SshStore, files: RemoteFileSystems): ToolDefinition {
  return tool('file_directory_list', 'List one directory on an authorized FTP, FTPS, or SFTP endpoint.', {
    endpointId: { type: 'string', required: true, description: 'Exact endpoint id returned by file_endpoint_list.' },
    path: { type: 'string', required: true, description: 'Remote directory path.' },
  }, async (raw, exec) => {
    const args = object(raw)
    const endpointId = text(args.endpointId, 'endpointId', 110)
    requireEndpoint(store, exec, endpointId, false)
    const session = await files.connect(endpointId, exec.signal)
    try { return json(await session.list(rawText(args.path, 'path', 4096), exec.signal)) } finally { session.close() }
  }, true)
}

function transferStartTool(store: SshStore, transfers: FileTransferManager): ToolDefinition {
  return tool('file_transfer_start', 'Start an asynchronous server-side transfer between two authorized FTP, FTPS, or SFTP endpoints. Use fail as the default conflict policy unless the user explicitly chose another policy.', {
    sourceEndpointId: { type: 'string', required: true },
    sourcePaths: { type: 'array', required: true, items: { type: 'string' }, minItems: 1, maxItems: 100 },
    destinationEndpointId: { type: 'string', required: true },
    destinationDirectory: { type: 'string', required: true },
    conflictPolicy: { type: 'string', enum: ['fail', 'skip', 'overwrite', 'rename'], description: 'Defaults to fail.' },
  }, async (raw, exec) => {
    const args = object(raw)
    const sourceEndpointId = text(args.sourceEndpointId, 'sourceEndpointId', 110)
    const destinationEndpointId = text(args.destinationEndpointId, 'destinationEndpointId', 110)
    const owner = requireEndpoint(store, exec, sourceEndpointId, true)
    requireEndpoint(store, exec, destinationEndpointId, true)
    if (!Array.isArray(args.sourcePaths) || args.sourcePaths.length < 1 || args.sourcePaths.length > 100) throw new Error('sourcePaths must contain 1-100 paths')
    const conflict = args.conflictPolicy === undefined ? 'fail' : text(args.conflictPolicy, 'conflictPolicy', 16)
    if (conflict !== 'fail' && conflict !== 'skip' && conflict !== 'overwrite' && conflict !== 'rename') throw new Error('invalid conflictPolicy')
    return json(transfers.start(owner.session.id, {
      sourceEndpointId, sourcePaths: args.sourcePaths.map((value, index) => rawText(value, `sourcePaths[${index}]`, 4096)),
      destinationEndpointId, destinationDirectory: rawText(args.destinationDirectory, 'destinationDirectory', 4096), conflictPolicy: conflict as TransferConflictPolicy,
    }))
  })
}

function transferStatusTool(store: SshStore, transfers: FileTransferManager): ToolDefinition {
  return tool('file_transfer_status', 'Read the current state and progress of a file transfer owned by this conversation.', {
    jobId: { type: 'string', required: true },
  }, async (raw, exec) => json(transfers.get(text(object(raw).jobId, 'jobId', 200), requireFileInjection(store, exec).sessionId)), true)
}

function transferCancelTool(store: SshStore, transfers: FileTransferManager): ToolDefinition {
  return tool('file_transfer_cancel', 'Cancel a queued or running file transfer owned by this conversation.', {
    jobId: { type: 'string', required: true },
  }, async (raw, exec) => {
    const injection = requireFileInjection(store, exec)
    if (injection.filePermission !== 'transfer') throw new Error('This session only permits remote file browsing')
    return json({ cancelled: transfers.cancel(text(object(raw).jobId, 'jobId', 200), injection.sessionId) })
  })
}

function tool(name: string, description: string, properties: Record<string, Record<string, unknown>>, execute: (args: unknown, exec: ToolRunContext) => Promise<string>, concurrencySafe = false): ToolDefinition {
  const required = Object.entries(properties).filter(([, schema]) => schema.required === true).map(([key]) => key)
  const schemaProperties = Object.fromEntries(Object.entries(properties).map(([key, schema]) => { const { required: _required, ...rest } = schema; return [key, rest] }))
  return {
    name, description, parameters: { type: 'object', additionalProperties: false, properties: schemaProperties, required }, output, execute,
    isConcurrencySafe: () => concurrencySafe, presentCall: args => ({ card: 'terminal', title: presentTitle(name, args) }),
  }
}

function requireFileInjection(store: SshStore, exec: ToolRunContext) {
  const sessionId = exec.agent?.session.id
  if (sessionId === undefined) throw new Error('Remote file tools require an owning DSH session')
  const injection = store.injection(sessionId)
  if (injection === undefined || injection.fileEndpointIds.length === 0) throw new Error('No remote file endpoint is authorized for this DSH session')
  return injection
}

function requireEndpoint(store: SshStore, exec: ToolRunContext, endpointId: string, transfer: boolean) {
  const injection = requireFileInjection(store, exec)
  if (!injection.fileEndpointIds.includes(endpointId)) throw new Error('The requested file endpoint is not authorized for this DSH session')
  if (transfer && injection.filePermission !== 'transfer') throw new Error('This session only permits remote file browsing')
  if (exec.agent === undefined) throw new Error('Remote file tools require an owning agent')
  return exec.agent
}

function installVisibility(ctx: Context, store: SshStore): () => void {
  const attached = new Map<Agent, () => void>()
  const attach = (agent: Agent): void => {
    if (attached.has(agent)) return
    attached.set(agent, agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const result = await next(); applyVisibility(result, store.injection(agent.session.id)); return result
    }))
  }
  for (const agent of ctx.agents.list()) attach(agent)
  const created = ctx.on('agent/created', ({ agent }) => attach(agent))
  const disposed = ctx.on('agent/disposed', ({ agent }) => { attached.get(agent)?.(); attached.delete(agent) })
  return () => { disposed(); created(); for (const dispose of attached.values()) dispose(); attached.clear() }
}

function applyVisibility(assembly: PromptAssembly, injection: ReturnType<SshStore['injection']>): void {
  if (injection === undefined || (injection.fileEndpointIds ?? []).length === 0) { assembly.tools = assembly.tools.filter(schema => !FILE_TOOL_NAMES.has(schema.name)); return }
  if (injection.filePermission === 'browse') assembly.tools = assembly.tools.filter(schema => !TRANSFER_TOOL_NAMES.has(schema.name))
  assembly.contexts.push({ name: 'dsh-ssh:file-access', text: `Remote file access is limited to explicitly authorized endpoints. Permission: ${injection.filePermission}. Use file_endpoint_list before selecting FTP/SFTP endpoints. Never guess endpoint ids or paths.` })
}

function presentTitle(name: string, value: unknown): string { const args = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}; return typeof args.sourceEndpointId === 'string' ? `${name} · ${args.sourceEndpointId}` : name }
function object(value: unknown): Record<string, unknown> { if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('arguments must be an object'); return value as Record<string, unknown> }
function text(value: unknown, name: string, max: number): string { if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) throw new Error(`${name} is invalid`); return value.trim() }
function rawText(value: unknown, name: string, max: number): string { if (typeof value !== 'string' || value.length < 1 || value.length > max || /[\0\r\n]/.test(value)) throw new Error(`${name} is invalid`); return value }
function json(value: unknown): string { return JSON.stringify(value, null, 2) }
