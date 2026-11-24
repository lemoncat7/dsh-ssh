import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import test from 'node:test'
import { ForwardManager } from '../lib/forwards.js'
import { registerSshApi } from '../lib/api.js'

const rule = { id: 'forward', profileId: 'host', name: 'Existing forward', kind: 'remote', bindHost: '127.0.0.1', bindPort: 12345, targetHost: '127.0.0.1', targetPort: 80 }
const store = { forwards: () => [structuredClone(rule)], forward: id => id === rule.id ? structuredClone(rule) : undefined, settings: () => ({ allowPublicBind: false }) }
function connection() {
  return { client: Object.assign(new EventEmitter(), {
    forwardIn(_host, port, callback) { callback(null, port) },
    unforwardIn(_host, _port, callback) { callback() },
  }), close() {} }
}

test('repeated forward status reads and starts reuse one running connection', async t => {
  let connects = 0
  const manager = new ForwardManager({ async connect() { connects++; return connection() } }, store)
  t.after(() => manager.closeAll())
  await Promise.all(Array.from({ length: 12 }, () => manager.start(rule.id)))
  let route
  registerSshApi({ register(value) { route = value; return () => {} } }, '/ssh-local/v1', { store, forwards: manager })
  const server = createServer((req, res) => { void route.handler(req, res) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  for (let i = 0; i < 6; i++) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/ssh-local/v1/forwards`)
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.statuses[0].state, 'running')
    assert.equal(result.statuses[0].bindPort, 12345)
  }
  await manager.start(rule.id)
  assert.equal(connects, 1, 'Opening or polling the forwarding page cannot reconnect the host')
})

test('pending forward status is nonblocking and authentication failure becomes an error', async () => {
  let reject, connects = 0
  const manager = new ForwardManager({ connect() { connects++; return new Promise((_resolve, fail) => { reject = fail }) } }, store)
  const starting = manager.start(rule.id)
  const joined = manager.start(rule.id)
  assert.equal(starting, joined)
  assert.equal(manager.status(rule.id).state, 'starting')
  assert.equal(manager.list()[0].state, 'starting')
  assert.equal(connects, 1)
  reject(new Error('authentication failed'))
  await assert.rejects(starting, /authentication failed/)
  assert.equal(manager.status(rule.id).state, 'error')
  assert.equal(manager.status(rule.id).error, 'authentication failed')
  assert.equal((await manager.stop(rule.id)).state, 'stopped')
})
