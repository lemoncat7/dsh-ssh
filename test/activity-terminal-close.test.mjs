import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { registerSshApi } from '../lib/api.js'

test('activity terminals can be closed only by their injected DSH session', async t => {
  let route
  const closed = []
  registerSshApi({ register(value) { route = value; return () => {} } }, '/ssh-local/v1', {
    store: {
      injection(sessionId) {
        return sessionId === 'session-owner'
          ? { sessionId, profileIds: ['host-test'], permission: 'terminal', requireCommandApproval: false, workingDirectories: {}, updatedAt: 1 }
          : undefined
      },
    },
    aiTerminals: {
      async close(sessionId, terminalId) {
        if (terminalId === 'terminal-missing') return false
        closed.push({ sessionId, terminalId })
        return true
      },
    },
  })
  const server = createServer((request, response) => { void route.handler(request, response) })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  t.after(() => new Promise(resolve => server.close(resolve)))
  const address = server.address()
  assert(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}/ssh-local/v1/activity/terminals`
  const headers = { 'X-DSH-SSH-Request': '1' }

  const closedResponse = await fetch(`${base}/terminal-active?sessionId=session-owner`, { method: 'DELETE', headers })
  assert.equal(closedResponse.status, 204)
  assert.deepEqual(closed, [{ sessionId: 'session-owner', terminalId: 'terminal-active' }])

  const foreignResponse = await fetch(`${base}/terminal-foreign?sessionId=session-other`, { method: 'DELETE', headers })
  assert.equal(foreignResponse.status, 403)
  assert.equal(closed.length, 1)

  const missingResponse = await fetch(`${base}/terminal-missing?sessionId=session-owner`, { method: 'DELETE', headers })
  assert.equal(missingResponse.status, 404)
})

test('activity terminals support the proxy-safe close action route', async t => {
  let route
  const closed = []
  registerSshApi({ register(value) { route = value; return () => {} } }, '/ssh-local/v1', {
    store: {
      injection(sessionId) {
        return sessionId === 'session-owner'
          ? { sessionId, profileIds: ['host-test'], permission: 'terminal', requireCommandApproval: false, workingDirectories: {}, updatedAt: 1 }
          : undefined
      },
    },
    aiTerminals: {
      async close(sessionId, terminalId) { closed.push({ sessionId, terminalId }); return true },
    },
  })
  const server = createServer((request, response) => { void route.handler(request, response) })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  t.after(() => new Promise(resolve => server.close(resolve)))
  const address = server.address()
  assert(address && typeof address !== 'string')

  const response = await fetch(`http://127.0.0.1:${address.port}/ssh-local/v1/activity/terminals/terminal-active/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-DSH-SSH-Request': '1' },
    body: JSON.stringify({ sessionId: 'session-owner' }),
  })
  assert.equal(response.status, 204)
  assert.deepEqual(closed, [{ sessionId: 'session-owner', terminalId: 'terminal-active' }])
})
