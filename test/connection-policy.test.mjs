import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { connectionProfile, usesDefaultConnectTimeout } from '../lib/connection-policy.js'
import { normalizeProfileDraft } from '../lib/domain.js'
import { registerSshApi } from '../lib/api.js'

test('global connection timeout, explicit per-host override and legacy values remain distinct', () => {
  const profile = { connectTimeoutMs: 15000 }
  assert.equal(connectionProfile(profile, { defaultConnectTimeoutMs: 60000 }).connectTimeoutMs, 60000)
  assert.equal(connectionProfile({ ...profile, useDefaultConnectTimeout: false }, { defaultConnectTimeoutMs: 60000 }).connectTimeoutMs, 15000)
  assert.equal(connectionProfile({ connectTimeoutMs: 30000 }, { defaultConnectTimeoutMs: 60000 }).connectTimeoutMs, 30000)
  assert.equal(connectionProfile({ connectTimeoutMs: 30000, useDefaultConnectTimeout: true }, { defaultConnectTimeoutMs: 60000 }).connectTimeoutMs, 60000)
  assert.equal(usesDefaultConnectTimeout(profile), true)
  assert.equal(profile.connectTimeoutMs, 15000)
  const draft = { name: 'test', host: 'localhost', username: 'test', authType: 'agent', useDefaultConnectTimeout: false, connectTimeoutMs: 60000 }
  assert.equal(normalizeProfileDraft(draft).useDefaultConnectTimeout, false)
  for (const connectTimeoutMs of [0, 120001, 1500.5, '60000']) assert.throws(() => normalizeProfileDraft({ ...draft, connectTimeoutMs }))
  assert.throws(() => normalizeProfileDraft({ ...draft, useDefaultConnectTimeout: 'false' }))
})

test('settings API validates new fields and old clients cannot erase them', async t => {
  let route
  const state = { settings: { allowPublicBind: false, defaultCommandTimeoutMs: 30000, maxOutputChars: 32000, defaultConnectTimeoutMs: 60000, reuseTerminalConnections: true } }
  registerSshApi({ register(r) { route = r; return () => {} } }, '/ssh-local/v1', {
    store: { settings: () => ({ ...state.settings }), update: async f => f(state) },
  })
  const server = createServer((req, res) => { void route.handler(req, res) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const put = value => fetch(`http://127.0.0.1:${server.address().port}/ssh-local/v1/settings`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-DSH-SSH-Request': '1' }, body: JSON.stringify(value),
  })
  const old = { allowPublicBind: false, defaultCommandTimeoutMs: 40000, maxOutputChars: 32000 }
  assert.equal((await put(old)).status, 200)
  assert.equal(state.settings.defaultConnectTimeoutMs, 60000); assert.equal(state.settings.reuseTerminalConnections, true)
  assert.equal((await put({ ...old, defaultConnectTimeoutMs: 120001 })).status, 400)
  assert.equal((await put({ ...old, reuseTerminalConnections: 'yes' })).status, 400)
  assert.equal((await put({ ...old, defaultConnectTimeoutMs: 20000, reuseTerminalConnections: false })).status, 200)
  assert.equal(state.settings.defaultConnectTimeoutMs, 20000); assert.equal(state.settings.reuseTerminalConnections, false)
})
