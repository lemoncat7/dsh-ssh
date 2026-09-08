import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { registerFileTransferTools } from '../lib/file-transfer-tools.js'
import { SshStore } from '../lib/store.js'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

test('file tools expose and transfer only endpoints authorized to the owning session', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-ssh-file-tools-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = await SshStore.open(join(directory, 'state.json'), { allowPublicBind: false, defaultCommandTimeoutMs: 30_000, maxOutputChars: 32_000 })
  const now = Date.now()
  await store.update(state => {
    state.profiles.push({ id: 'host-allowed', name: 'Allowed', host: '127.0.0.1', port: 22, username: 'test', authType: 'agent', proxy: { type: 'none' }, keepAliveIntervalMs: 0, connectTimeoutMs: 5000, terminalType: 'xterm-256color', tags: [], createdAt: now, updatedAt: now })
    state.profiles.push({ id: 'host-hidden', name: 'Hidden', host: '127.0.0.2', port: 22, username: 'test', authType: 'agent', proxy: { type: 'none' }, keepAliveIntervalMs: 0, connectTimeoutMs: 5000, terminalType: 'xterm-256color', tags: [], createdAt: now, updatedAt: now })
    state.injections.push({ sessionId: 'session-test', profileIds: [], fileEndpointIds: ['sftp:host-allowed'], filePermission: 'transfer', requireFileApproval: false, permission: 'exec', requireCommandApproval: false, workingDirectories: {}, workingProjectIds: {}, updatedAt: now })
  })
  const tools = new Map()
  let promptHandler
  const starts = []
  const files = {
    endpoint(id) { return id === 'sftp:host-allowed' ? { id, kind: 'sftp', protocol: 'sftp', name: 'Allowed', address: 'test@allowed', initialPath: '~' } : id === 'sftp:host-hidden' ? { id, kind: 'sftp', protocol: 'sftp', name: 'Hidden', address: 'test@hidden', initialPath: '~' } : undefined },
    async connect() { throw new Error('not used') },
  }
  const transfers = {
    start(ownerId, request) { starts.push({ ownerId, request }); return { id: 'job-test', ownerId, request, state: 'queued' } },
    get() { throw new Error('not used') }, cancel() { throw new Error('not used') },
  }
  const agent = { session: { id: 'session-test' }, ctx: { on(event, handler) { if (event === 'system-prompt/assemble') promptHandler = handler; return () => {} } } }
  const ctx = { tools: { register(definition) { tools.set(definition.name, definition); return () => tools.delete(definition.name) } }, agents: { list() { return [agent] } }, on() { return () => {} } }
  const dispose = registerFileTransferTools(ctx, store, files, transfers)
  t.after(dispose)
  const execution = { agent, signal: new AbortController().signal }
  const listed = JSON.parse(await tools.get('file_endpoint_list').execute({}, execution))
  assert.deepEqual(listed.endpoints.map(endpoint => endpoint.id), ['sftp:host-allowed'])
  await assert.rejects(tools.get('file_transfer_start').execute({ sourceEndpointId: 'sftp:host-hidden', sourcePaths: ['/a'], destinationEndpointId: 'sftp:host-allowed', destinationDirectory: '/b' }, execution), /not authorized/)
  const started = JSON.parse(await tools.get('file_transfer_start').execute({ sourceEndpointId: 'sftp:host-allowed', sourcePaths: ['/a'], destinationEndpointId: 'sftp:host-allowed', destinationDirectory: '/b' }, execution))
  assert.equal(started.id, 'job-test')
  assert.equal(starts[0].ownerId, 'session-test')
  assert.equal(starts[0].request.conflictPolicy, 'fail')
  assert.match(tools.get('file_transfer_start').description, /Never replace it with an SSH command, temporary HTTP server/)
  const assembly = { tools: [...tools.values()].map(tool => ({ name: tool.name })), contexts: [] }
  await promptHandler(assembly, {}, async () => assembly)
  const fileContext = assembly.contexts.find(context => context.name === 'dsh-ssh:file-access')
  assert.match(fileContext.text, /Never start an HTTP or other file server/)
  assert.match(fileContext.text, /下载到本地/)
})

test('local download tool defaults to owning session cwd and follows approval, visibility and execution permissions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ssh-download-tool-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let permission = 'transfer', enabled = true, approval = true, connected = 0
  const store = { injection(id) { return id === 'owner' && enabled ? {
    sessionId: id, filePermission: permission, fileEndpointIds: ['sftp:allowed'], requireFileApproval: approval,
  } : undefined } }
  const tools = new Map(), hooks = new Map()
  let assemble
  const agent = { session: { id: 'owner', header: { cwd: root } }, ctx: { on(event, handler) { assemble = handler; return () => {} } } }
  const files = { async connect(id) {
    connected++; assert.equal(id, 'sftp:allowed')
    return { close() {},
      async stat() { return { kind: 'file', path: '/report.txt', name: 'report.txt', size: 2 } },
      async download(_path, target, signal) { await pipeline(Readable.from(['ok']), target, { signal }) },
    }
  } }
  const ctx = { tools: { register(tool) { tools.set(tool.name, tool); return () => {} } }, agents: { list: () => [agent] }, on(event, handler) { hooks.set(event, handler); return () => {} } }
  const dispose = registerFileTransferTools(ctx, store, files, {})
  t.after(dispose)
  const exec = { agent, signal: new AbortController().signal }
  const download = tools.get('file_download_to_local')
  const args = { endpointId: 'sftp:allowed', remotePath: '/report.txt' }
  assert.equal((await hooks.get('tools/pre-execute')({ name: download.name, agent }, async () => 'continue')).kind, 'ask')
  approval = false
  assert.equal(await hooks.get('tools/pre-execute')({ name: download.name, agent }, async () => 'continue'), 'continue')
  await assert.rejects(download.execute({ ...args, endpointId: 'sftp:other' }, exec), /not authorized/)
  const result = JSON.parse(await download.execute(args, exec))
  assert.equal(result.state, 'completed'); assert.equal(result.localPath, join(root, 'report.txt'))
  assert.equal(await readFile(result.localPath, 'utf8'), 'ok'); assert.equal(connected, 1)
  permission = 'browse'
  await assert.rejects(download.execute(args, exec), /only permits/)
  const assembly = { tools: [...tools.values()].map(t => ({ name: t.name })), contexts: [] }
  await assemble(assembly, {}, async () => assembly)
  assert.ok(!assembly.tools.some(t => t.name === download.name))
  permission = 'transfer'; enabled = false
  await assert.rejects(download.execute(args, exec), /No remote file endpoint/)
  assert.equal(connected, 1)
  enabled = true; delete agent.session.header.cwd
  await assert.rejects(download.execute(args, exec), /没有本地工作目录/)
  assert.equal(connected, 1)
})
