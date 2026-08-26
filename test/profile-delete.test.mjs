import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { registerSshApi } from '../lib/api.js'

test('profile deletion blocks jump-host references and cascades owned resources', async t => {
  const now = Date.now()
  const host = id => ({ id, name: id, host: '127.0.0.1', port: 22, username: 'test', authType: 'agent', proxy: { type: 'none' }, keepAliveIntervalMs: 0, connectTimeoutMs: 5000, terminalType: 'xterm-256color', tags: [], createdAt: now, updatedAt: now })
  const state = {
    profiles: [host('host-delete'), { ...host('host-dependent'), proxy: { type: 'jump', profileIds: ['host-delete'] } }],
    forwardRules: [{ id: 'forward-delete', profileId: 'host-delete' }],
    injections: [{ sessionId: 'session-test', profileIds: ['host-delete'], permission: 'terminal', requireCommandApproval: false, workingDirectories: { 'host-delete': '/srv' }, updatedAt: now }],
  }
  const stopped = []
  const deletedCredentials = []
  let route
  const store = {
    profile(id) { return state.profiles.find(profile => profile.id === id) },
    profiles() { return state.profiles },
    forwards() { return state.forwardRules },
    async update(mutator) { mutator(state) },
  }
  registerSshApi({ register(value) { route = value; return () => {} } }, '/ssh-local/v1', {
    store,
    forwards: { async stop(id) { stopped.push(id) } },
    credentials: { async delete(id) { deletedCredentials.push(id) } },
  })
  const server = createServer((request, response) => { void route.handler(request, response) })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  t.after(() => new Promise(resolve => server.close(resolve)))
  const address = server.address()
  assert(address && typeof address !== 'string')
  const url = `http://127.0.0.1:${address.port}/ssh-local/v1/profiles/host-delete`
  const headers = { 'X-DSH-SSH-Request': '1' }

  const blocked = await fetch(url, { method: 'DELETE', headers })
  assert.equal(blocked.status, 409)
  assert.equal(state.profiles.length, 2)

  state.profiles = state.profiles.filter(profile => profile.id !== 'host-dependent')
  const removed = await fetch(url, { method: 'DELETE', headers })
  assert.equal(removed.status, 204)
  assert.deepEqual(state.profiles, [])
  assert.deepEqual(state.forwardRules, [])
  assert.deepEqual(state.injections[0].profileIds, [])
  assert.deepEqual(state.injections[0].workingDirectories, {})
  assert.deepEqual(stopped, ['forward-delete'])
  assert.deepEqual(deletedCredentials, ['host-delete'])
})
