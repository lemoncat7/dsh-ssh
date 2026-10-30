import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { SshStore } from '../lib/store.js'
import { registerSshTools } from '../lib/tools.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ssh-entry-'))
  const store = await SshStore.open(join(root, 'state.json'), { allowPublicBind: false, defaultCommandTimeoutMs: 30000, maxOutputChars: 32000 })
  const now = Date.now()
  await store.update(s => {
    s.profiles.push({ id: 'host', name: 'Visible', host: '127.0.0.1', port: 22, username: 'test', authType: 'agent', proxy: { type: 'none' }, keepAliveIntervalMs: 0, connectTimeoutMs: 5000, terminalType: 'xterm', tags: [], createdAt: now, updatedAt: now })
    s.injections.push({ sessionId: 'owner', profileIds: ['host'], fileEndpointIds: [], filePermission: 'browse', requireFileApproval: false, permission: 'exec', requireCommandApproval: true, workingDirectories: {}, workingProjectIds: {}, updatedAt: now })
  })
  const definitions = new Map(), hooks = new Map()
  const ctx = { provide: () => () => {}, agents: { list: () => [] },
    tools: { register(d) { definitions.set(d.name, d); return () => definitions.delete(d.name) } },
    on(name, handler) { const list = hooks.get(name) ?? []; list.push(handler); hooks.set(name, list); return () => {} },
  }
  let connects = 0
  const connector = { async connect() { connects++; throw Error('fixture transport reached') } }
  const dispose = registerSshTools(ctx, store, connector, {}, {}, { endpoint: () => ({ id: 'sftp:host', name: 'Visible' }) }, {})
  t.after(async () => { dispose(); await rm(root, { recursive: true, force: true }) })
  const exec = { agent: { session: { id: 'owner', header: { cwd: root } } }, signal: new AbortController().signal }
  return { store, definitions, hooks, exec, get connects() { return connects } }
}

test('exactly one registered entry; scoped discovery and on-demand original schemas', async t => {
  const f = await fixture(t), entry = f.definitions.get('ssh')
  assert.deepEqual([...f.definitions.keys()], ['ssh'])
  const list = JSON.parse(await entry.execute({ action: 'list' }, f.exec)).operations.map(t => t.name)
  assert.ok(list.includes('ssh_exec')); assert.ok(list.includes('file_upload_from_local'))
  assert.ok(!list.includes('ssh_terminal_open'))
  assert.ok(list.includes('ssh_request_temporary_access'))
  const schema = JSON.parse(await entry.execute({ action: 'describe', tool: 'ssh_exec' }, f.exec))
  assert.ok(schema.parameters.required.includes('command'))
  const hosts = JSON.parse(await entry.execute({ action: 'call', tool: 'ssh_list' }, f.exec))
  assert.deepEqual(hosts.profiles.map(p => p.id), ['host'])
  await assert.rejects(entry.execute({ action: 'call', tool: 'ssh_exec', arguments: { profileId: 'host' } }, f.exec), /command/)
  await assert.rejects(entry.execute({ action: 'call', tool: 'ssh_exec', arguments: { profileId: 'hidden', command: 'true' } }, f.exec), /not injected/)
  await assert.rejects(entry.execute({ action: 'call', tool: 'ssh_terminal_open', arguments: { profileId: 'host' } }, f.exec), /permission mode/)
  await assert.rejects(entry.execute({ action: 'call', tool: 'file_download_to_local', arguments: { endpointId: 'ftp:hidden', remotePath: '/secret' } }, f.exec), /not authorized/)
  await assert.rejects(entry.execute({ action: 'call', tool: 'ssh' }, f.exec), /Unknown SSH operation/)
  await f.store.update(s => { s.injections[0].profileIds = [] })
  const after = JSON.parse(await entry.execute({ action: 'list' }, f.exec)).operations.map(t => t.name)
  assert.deepEqual(after, ['ssh_request_temporary_access', 'ssh_temporary_exec'])
  assert.equal(f.connects, 0)
})

test('entry dispatch keeps SSH and inherited SFTP approvals; discovery needs no approval', async t => {
  const f = await fixture(t)
  const gate = async (tool, action = 'call') => {
    const exec = { ...f.exec, name: 'ssh', arguments: { action, tool, arguments: { endpointId: 'sftp:host', profileId: 'host', command: 'true' } } }
    const hooks = f.hooks.get('tools/pre-execute')
    const next = i => i < hooks.length ? hooks[i](exec, () => next(i + 1)) : Promise.resolve({ kind: 'allow' })
    return next(0)
  }
  assert.equal((await gate('ssh_exec')).kind, 'ask')
  assert.equal((await gate('file_download_to_local')).kind, 'ask')
  assert.equal((await gate('file_upload_from_local')).kind, 'ask')
  assert.equal((await gate('ssh_exec', 'describe')).kind, 'allow')
  assert.equal((await gate('ssh_request_temporary_access')).kind, 'allow', 'temporary consent is verified inside the operation')
  await f.store.update(s => { s.injections[0].requireCommandApproval = false })
  assert.equal((await gate('ssh_exec')).kind, 'allow')
  assert.equal((await gate('file_download_to_local')).kind, 'allow')
})

test('real host runtime denies approval-required entry before any network operation', async t => {
  const f = await fixture(t)
  const ctx = new Context()
  const prompt = ctx.plugin(SystemPrompt)
  await prompt
  const runtime = ctx.plugin(ToolRuntime)
  await runtime
  t.after(async () => { await runtime.dispose(); await prompt.dispose() })
  ctx.tools.register(f.definitions.get('ssh'))
  for (const hook of f.hooks.get('tools/pre-execute')) ctx.on('tools/pre-execute', hook)
  const result = await ctx.tools.execute({ ...f.exec, callId: 'fixture-call', name: 'ssh', arguments: { action: 'call', tool: 'ssh_exec', arguments: { profileId: 'host', command: 'true' } } })
  assert.equal(result.isError, true)
  assert.equal(f.connects, 0)
  const described = await ctx.tools.execute({ ...f.exec, callId: 'fixture-describe', name: 'ssh', arguments: { action: 'describe', tool: 'ssh_exec' } })
  assert.equal(described.isError, false)
})
