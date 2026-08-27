import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { registerSshApi } from '../lib/api.js'

test('remote projects are stored per host without exposing session history', async t => {
  const now = Date.now()
  const profile = { id: 'host-one', name: 'Host one', host: '127.0.0.1', port: 22, username: 'test', authType: 'agent', proxy: { type: 'none' }, keepAliveIntervalMs: 0, connectTimeoutMs: 5000, terminalType: 'xterm-256color', tags: [], createdAt: now, updatedAt: now }
  const state = {
    profiles: [profile], remoteProjects: [], credentialEntries: [], proxyEntries: [], forwardRules: [],
    injections: [{ sessionId: 'session-related', profileIds: ['host-one'], permission: 'exec', requireCommandApproval: true, workingDirectories: { 'host-one': '/srv/app' }, workingProjectIds: {}, updatedAt: now }],
  }
  const store = {
    profile(id) { return state.profiles.find(item => item.id === id) },
    remoteProjects(profileId) { return state.remoteProjects.filter(item => item.profileId === profileId) },
    remoteProject(id) { return state.remoteProjects.find(item => item.id === id) },
    snapshot() { return structuredClone(state) },
    async update(mutator) { mutator(state) },
  }
  let route
  registerSshApi({ register(value) { route = value; return () => {} } }, '/ssh-local/v1', { store })
  const server = createServer((request, response) => { void route.handler(request, response) })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  t.after(() => new Promise(resolve => server.close(resolve)))
  const address = server.address()
  assert(address && typeof address !== 'string')
  const root = `http://127.0.0.1:${address.port}/ssh-local/v1/profiles/host-one/projects`
  const headers = { 'Content-Type': 'application/json', 'X-DSH-SSH-Request': '1' }

  const createdResponse = await fetch(root, { method: 'POST', headers, body: JSON.stringify({ project: { name: 'App', path: '/srv/app' } }) })
  assert.equal(createdResponse.status, 201)
  const created = await createdResponse.json()
  assert.equal(created.name, 'App')
  assert.equal(created.path, '/srv/app')
  assert.equal('sessionIds' in created, false)

  state.injections[0].workingProjectIds['host-one'] = created.id
  const relatedResponse = await fetch(root)
  assert.equal(relatedResponse.status, 200)
  const related = await relatedResponse.json()
  assert.equal('sessionIds' in related[0], false)

  const updatedResponse = await fetch(`${root}/${created.id}`, { method: 'PUT', headers, body: JSON.stringify({ project: { name: 'Application', path: '/srv/application' } }) })
  assert.equal(updatedResponse.status, 200)
  const updated = await updatedResponse.json()
  assert.equal(updated.name, 'Application')
  assert.equal('sessionIds' in updated, false)
  assert.equal(state.injections[0].workingDirectories['host-one'], '/srv/application')

  const listedResponse = await fetch(root)
  assert.equal(listedResponse.status, 200)
  const listed = await listedResponse.json()
  assert.equal(listed.length, 1)
  assert.equal(listed[0].id, created.id)

  const deletedResponse = await fetch(`${root}/${created.id}`, { method: 'DELETE', headers })
  assert.equal(deletedResponse.status, 204)
  assert.deepEqual(state.remoteProjects, [])
  assert.deepEqual(state.injections[0].workingProjectIds, {})
})
