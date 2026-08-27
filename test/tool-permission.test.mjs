import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { SshStore } from '../lib/store.js'
import { registerSshTools } from '../lib/tools.js'

test('terminal-control mode rejects ssh_exec at the tool boundary', async t => {
  const fixture = await toolFixture(t, 'terminal')
  await assert.rejects(
    fixture.tools.get('ssh_exec').execute({ profileId: 'host-test', command: 'uptime' }, fixture.execution),
    /uses terminal control/,
  )
})

test('exec mode rejects interactive terminal tools at the tool boundary', async t => {
  const fixture = await toolFixture(t, 'exec')
  await assert.rejects(
    fixture.tools.get('ssh_terminal_send').execute({ terminalId: 'terminal-test', text: 'uptime' }, fixture.execution),
    /permits one-shot commands/,
  )
})

test('terminal-control mode removes ssh_exec from the model-facing tool assembly', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-ssh-tool-visibility-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = await SshStore.open(join(directory, 'state.json'), { allowPublicBind: false, defaultCommandTimeoutMs: 30_000, maxOutputChars: 32_000 })
  const now = Date.now()
  await store.update(state => {
    state.profiles.push({ id: 'host-test', name: 'Test', host: '127.0.0.1', port: 22, username: 'test', authType: 'agent', proxy: { type: 'none' }, keepAliveIntervalMs: 0, connectTimeoutMs: 5000, terminalType: 'xterm-256color', tags: [], createdAt: now, updatedAt: now })
    state.injections.push({ sessionId: 'session-test', profileIds: ['host-test'], permission: 'terminal', requireCommandApproval: false, workingDirectories: {}, workingProjectIds: {}, updatedAt: now })
  })
  let assemble
  const agent = { session: { id: 'session-test' }, ctx: { on(name, listener) { if (name === 'system-prompt/assemble') assemble = listener; return () => {} } } }
  const ctx = {
    tools: { register() { return () => {} } },
    agents: { list() { return [agent] } },
    on() { return () => {} },
  }
  const dispose = registerSshTools(ctx, store, {}, {}, {})
  t.after(dispose)
  const assembly = { sections: [], contexts: [], variables: {}, tools: [{ name: 'ssh_exec' }, { name: 'ssh_terminal_open' }, { name: 'ssh_list' }] }
  const result = await assemble(assembly, {}, async () => assembly)
  assert.deepEqual(result.tools.map(tool => tool.name), ['ssh_terminal_open', 'ssh_list'])
  assert.match(result.contexts[0].text, /terminal control/)
})

async function toolFixture(t, permission) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-ssh-tool-mode-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = await SshStore.open(join(directory, 'state.json'), { allowPublicBind: false, defaultCommandTimeoutMs: 30_000, maxOutputChars: 32_000 })
  const now = Date.now()
  await store.update(state => {
    state.profiles.push({ id: 'host-test', name: 'Test', host: '127.0.0.1', port: 22, username: 'test', authType: 'agent', proxy: { type: 'none' }, keepAliveIntervalMs: 0, connectTimeoutMs: 5000, terminalType: 'xterm-256color', tags: [], createdAt: now, updatedAt: now })
    state.injections.push({ sessionId: 'session-test', profileIds: ['host-test'], permission, requireCommandApproval: false, workingDirectories: {}, workingProjectIds: {}, updatedAt: now })
  })
  const tools = new Map()
  const ctx = {
    tools: { register(definition) { tools.set(definition.name, definition); return () => tools.delete(definition.name) } },
    agents: { list() { return [] } },
    on() { return () => {} },
  }
  const dispose = registerSshTools(ctx, store, {}, {}, {})
  t.after(dispose)
  return { tools, execution: { agent: { session: { id: 'session-test' } }, signal: new AbortController().signal } }
}
