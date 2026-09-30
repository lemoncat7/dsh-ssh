import test from 'node:test'
import assert from 'node:assert/strict'
import { registerTemporaryAccess, resolveTemporaryHost } from '../lib/temporary-access.js'

const host = { id: 'host-78', name: 'nas', host: '192.168.28.78', username: 'user', port: 22 }
function fixture(outcome = 'allowed-once') {
  const handlers = new Map(), tools = new Map(), questions = []
  const controller = new AbortController()
  const agent = { session: { id: 'session-a' } }
  let profile = { ...host }, connections = 0
  const ctx = {
    on(name, handler) { handlers.set(name, handler); return () => handlers.delete(name) },
    tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) } },
    get() { return { async request(request) { questions.push(request); return typeof outcome === 'function' ? outcome() : outcome } } },
  }
  const dispose = registerTemporaryAccess(ctx, { profiles: () => [profile], profile: () => profile, settings: () => ({ defaultCommandTimeoutMs: 1000, maxOutputChars: 1000 }) }, { async connect() { connections++; throw new Error('connection reached') } })
  const exec = { agent, signal: controller.signal, name: 'ssh_request_temporary_access', callId: 'call' }
  const start = (turn = 1) => handlers.get('agent/pre-step')({ agent, turn, signal: controller.signal }, async () => ({}))
  const request = () => tools.get('ssh_request_temporary_access').execute({ target: '78', task: '检查磁盘' }, exec)
  const command = (owner = agent) => tools.get('ssh_temporary_exec').execute({ profileId: host.id, command: 'pwd' }, { ...exec, agent: owner })
  return { handlers, agent, controller, start, request, command, questions, dispose, setProfile: value => { profile = value }, connections: () => connections }
}

test('host lookup accepts explicit name/IP/suffix and rejects ambiguities', () => {
  for (const target of ['nas', '192.168.28.78', '78']) assert.equal(resolveTemporaryHost([host], target), host)
  assert.throws(() => resolveTemporaryHost([host, { ...host, id: 'other', host: '10.0.0.78' }], '78'), /不唯一/)
  assert.throws(() => resolveTemporaryHost([host], '7'), /未找到/)
})

test('confirmation gates access, and access is bound to the current session and turn', async () => {
  const f = fixture(); await f.start()
  await assert.rejects(f.command(), /没有有效/)
  await f.request()
  assert.match(f.questions[0].reason, /user@192.168.28.78:22/)
  await assert.rejects(f.command(), /connection reached/)
  await assert.rejects(f.command({ session: { id: 'child' } }), /没有有效/)
  await f.start(2)
  await assert.rejects(f.command(), /没有有效/)
  assert.equal(f.connections(), 1)
  f.dispose()
})

test('denied or unavailable confirmation never grants access', async () => {
  for (const result of ['rejected', 'cancelled', 'unavailable']) {
    const f = fixture(result); await f.start()
    await assert.rejects(f.request(), /未确认/)
    await assert.rejects(f.command(), /没有有效/)
    assert.equal(f.connections(), 0); f.dispose()
  }
})

test('completion, cancellation, error, disposal and host changes revoke access', async () => {
  for (const revoke of [
    f => f.handlers.get('session/event')(f.agent.session, { type: 'turn/end', turn: 1 }),
    f => f.controller.abort(),
    f => f.handlers.get('agent/error')({ agent: f.agent }),
    f => f.handlers.get('agent/disposed')({ agent: f.agent }),
    f => f.setProfile({ ...host, host: '10.0.0.1' }),
  ]) {
    const f = fixture(); await f.start(); await f.request(); revoke(f)
    await assert.rejects(f.command(), /没有有效/)
    assert.equal(f.connections(), 0); f.dispose()
  }
})

test('late approval after task completion cannot restore access', async () => {
  let resolve
  const f = fixture(() => new Promise(done => { resolve = done }))
  await f.start()
  const pending = f.request()
  f.handlers.get('session/event')(f.agent.session, { type: 'turn/end', turn: 1 })
  resolve('allowed-once')
  await assert.rejects(pending, /任务已结束/)
  await assert.rejects(f.command(), /没有有效/)
  f.dispose()
})
