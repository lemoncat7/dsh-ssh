import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { SshStore } from '../lib/store.js'
import { registerSshTools } from '../lib/tools.js'

test('a regular fork inherits SSH and file-transfer access before prompt assembly', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-ssh-session-inheritance-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = await SshStore.open(join(directory, 'state.json'), { allowPublicBind: false, defaultCommandTimeoutMs: 30_000, maxOutputChars: 32_000 })
  const now = Date.now()
  await store.update(state => {
    state.profiles.push({ id: 'host-test', name: 'Test', host: '127.0.0.1', port: 22, username: 'test', authType: 'agent', proxy: { type: 'none' }, keepAliveIntervalMs: 0, connectTimeoutMs: 5000, terminalType: 'xterm-256color', tags: [], createdAt: now, updatedAt: now })
    state.ftpProfiles.push({ id: 'ftp-test', name: 'Files', protocol: 'ftps-explicit', host: '127.0.0.1', port: 21, username: 'test', proxy: { type: 'none' }, initialPath: '/', connectTimeoutMs: 5000, createdAt: now, updatedAt: now })
    state.remoteProjects.push({ id: 'project-test', profileId: 'host-test', name: 'Project', path: '/srv/project', createdAt: now, updatedAt: now })
    state.injections.push({
      sessionId: 'session-parent',
      profileIds: ['host-test'],
      fileEndpointIds: ['sftp:host-test', 'ftp:ftp-test'],
      filePermission: 'transfer',
      requireFileApproval: false,
      permission: 'terminal',
      requireCommandApproval: false,
      workingDirectories: { 'host-test': '/srv/project' },
      workingProjectIds: { 'host-test': 'project-test' },
      updatedAt: now,
    })
  })

  let assemble
  const agent = {
    session: { id: 'session-child', header: { parentSession: 'session-parent' } },
    ctx: { on(name, listener) { if (name === 'system-prompt/assemble') assemble = listener; return () => {} } },
  }
  const ctx = {
    logger: { info() {}, warn() {} },
    tools: { register() { return () => {} } },
    agents: { list() { return [agent] } },
    on() { return () => {} },
  }
  const dispose = registerSshTools(ctx, store, {}, {}, {})
  t.after(dispose)
  const assembly = { sections: [], contexts: [], variables: {}, tools: [{ name: 'ssh_exec' }, { name: 'ssh_terminal_open' }, { name: 'ssh_list' }] }
  await assemble(assembly, {}, async () => assembly)

  const inherited = store.injection('session-child')
  assert.deepEqual(inherited.profileIds, ['host-test'])
  assert.deepEqual(inherited.fileEndpointIds, ['sftp:host-test', 'ftp:ftp-test'])
  assert.equal(inherited.filePermission, 'transfer')
  assert.equal(inherited.requireFileApproval, false)
  assert.equal(inherited.permission, 'terminal')
  assert.equal(inherited.requireCommandApproval, false)
  assert.deepEqual(inherited.workingDirectories, { 'host-test': '/srv/project' })
  assert.deepEqual(inherited.workingProjectIds, { 'host-test': 'project-test' })
  assert.deepEqual(assembly.tools.map(tool => tool.name), ['ssh_terminal_open', 'ssh_list'])
})

test('subagent lineage does not inherit user-granted session access', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-ssh-subagent-inheritance-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = await SshStore.open(join(directory, 'state.json'), { allowPublicBind: false, defaultCommandTimeoutMs: 30_000, maxOutputChars: 32_000 })
  await store.update(state => {
    state.injections.push({ sessionId: 'session-parent', profileIds: [], fileEndpointIds: [], filePermission: 'browse', requireFileApproval: true, permission: 'exec', requireCommandApproval: true, workingDirectories: {}, workingProjectIds: {}, updatedAt: Date.now() })
  })
  let assemble
  const agent = {
    session: { id: 'session-subagent', header: { parentSession: 'session-parent', origin: 'subagent' } },
    ctx: { on(name, listener) { if (name === 'system-prompt/assemble') assemble = listener; return () => {} } },
  }
  const ctx = {
    logger: { info() {}, warn() {} },
    tools: { register() { return () => {} } },
    agents: { list() { return [agent] } },
    on() { return () => {} },
  }
  const dispose = registerSshTools(ctx, store, {}, {}, {})
  t.after(dispose)
  const assembly = { sections: [], contexts: [], variables: {}, tools: [] }
  await assemble(assembly, {}, async () => assembly)
  assert.equal(store.injection('session-subagent'), undefined)
})
