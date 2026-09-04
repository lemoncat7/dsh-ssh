import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { registerSshApi } from '../lib/api.js'
import { findDuplicateProfileEndpoint, profileEndpointKey } from '../lib/profile-endpoint.js'

const now = Date.now()
const existing = {
  id: 'host-existing', name: '生产主机', host: 'Server.Example.com.', port: 22,
  username: 'root', authType: 'agent', proxy: { type: 'none' },
  keepAliveIntervalMs: 15_000, connectTimeoutMs: 15_000,
  terminalType: 'xterm-256color', tags: [], createdAt: now, updatedAt: now,
}

test('SSH endpoint identity normalizes host spelling but keeps ports distinct', () => {
  assert.equal(profileEndpointKey({ host: '[2001:DB8::1]', port: 22 }), profileEndpointKey({ host: '2001:db8::1', port: 22 }))
  assert.equal(findDuplicateProfileEndpoint([existing], { host: 'server.example.com', port: 22 })?.id, existing.id)
  assert.equal(findDuplicateProfileEndpoint([existing], { host: 'server.example.com', port: 2202 }), undefined)
  assert.equal(findDuplicateProfileEndpoint([existing], { host: 'server.example.com', port: 22 }, existing.id), undefined)
})

test('profile creation rejects an existing host and port before persisting it', async t => {
  const state = { profiles: [existing] }
  let route
  const deletedCredentials = []
  const store = {
    profiles() { return structuredClone(state.profiles) },
    async update(mutator) { mutator(state) },
  }
  registerSshApi({ register(value) { route = value; return () => {} } }, '/ssh-local/v1', {
    store,
    credentials: {
      async replace() {},
      async delete(id) { deletedCredentials.push(id) },
    },
  })
  const server = createServer((request, response) => { void route.handler(request, response) })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  t.after(() => new Promise(resolve => server.close(resolve)))
  const address = server.address()
  assert(address && typeof address !== 'string')

  const response = await fetch(`http://127.0.0.1:${address.port}/ssh-local/v1/profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-DSH-SSH-Request': '1' },
    body: JSON.stringify({
      profile: { name: '重复主机', host: 'server.example.com', port: 22, username: 'root', authType: 'agent', proxy: { type: 'none' }, tags: [] },
      secrets: {},
    }),
  })
  const body = await response.json()

  assert.equal(response.status, 409)
  assert.equal(body.code, 'DUPLICATE_PROFILE_ENDPOINT')
  assert.match(body.error, /生产主机/)
  assert.equal(state.profiles.length, 1)
  assert.equal(deletedCredentials.length, 1)
})
