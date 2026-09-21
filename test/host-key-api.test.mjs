import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { registerSshApi } from '../lib/api.js'
import { HostKeyRequiredError } from '../lib/connector.js'

test('host-key confirmation verifies before persisting and never overwrites concurrent edits', async t => {
  const state = { profiles: [{ id: 'jump', name: 'Jump', authType: 'password', hostFingerprint: 'SHA256:old', updatedAt: 1 }] }
  let mode = 'success', calls = 0, route
  registerSshApi({ register(value) { route = value; return () => {} } }, '/ssh-local/v1', {
    store: { profile: id => state.profiles.find(p => p.id === id), update: async change => change(state) },
    credentials: { read: async () => ({ password: 'fixture' }), describe: async () => ({ fields: ['password'] }) },
    connector: {
      connect: async () => { throw new HostKeyRequiredError('jump', 'SHA256:new', 'SHA256:old', 'Jump') },
      connectDraft: async profile => {
        calls++
        assert.equal(state.profiles[0].hostFingerprint, 'SHA256:old', 'not trusted globally during verification')
        assert.equal(profile.hostFingerprint, 'SHA256:new')
        if (mode === 'failure') throw Error('Authentication failed')
        if (mode === 'race') state.profiles[0] = { ...state.profiles[0], name: 'Concurrent edit' }
        return { close() {} }
      },
    },
  })
  const server = createServer((req, res) => { void route.handler(req, res) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const post = (path, body = {}) => fetch(`http://127.0.0.1:${server.address().port}/ssh-local/v1/profiles/jump/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DSH-SSH-Request': '1' }, body: JSON.stringify(body),
  })
  const error = await post('test')
  assert.equal(error.status, 409)
  assert.deepEqual(await error.json(), { ok: false, code: 'HOST_KEY_REQUIRED', profileId: 'jump', fingerprint: 'SHA256:new', previousFingerprint: 'SHA256:old', profileName: 'Jump' })
  assert.equal((await post('confirm-host', { fingerprint: 'SHA256:new' })).status, 409)
  assert.equal(calls, 0, 'stale or missing previous fingerprint is rejected')
  const body = { fingerprint: 'SHA256:new', previousFingerprint: 'SHA256:old' }
  mode = 'failure'
  assert.equal((await post('confirm-host', body)).status, 500)
  assert.equal(state.profiles[0].hostFingerprint, 'SHA256:old')
  mode = 'race'
  assert.equal((await post('confirm-host', body)).status, 409)
  assert.equal(state.profiles[0].name, 'Concurrent edit')
  assert.equal(state.profiles[0].hostFingerprint, 'SHA256:old')
  mode = 'success'
  assert.equal((await post('confirm-host', body)).status, 200)
  assert.equal(state.profiles[0].hostFingerprint, 'SHA256:new')
})
