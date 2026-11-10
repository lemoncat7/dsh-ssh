import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { PassThrough } from 'node:stream'
import { BrowserTerminalManager } from '../lib/terminal.js'

function connection() {
  const channel = new PassThrough()
  channel.stderr = new PassThrough()
  channel.setWindow = () => {}
  let closes = 0
  return { channel, get closes() { return closes }, profile: { terminalType: 'xterm-256color', connectTimeoutMs: 5000 }, client: Object.assign(new EventEmitter(), { shell(_size, callback) { callback(null, channel) } }), close() { closes++; channel.destroy() } }
}

test('browser tabs open independent terminals, start in selected directory and close independently', async t => {
  const connections = []
  const manager = new BrowserTerminalManager({ async connectTerminal() { const value = connection(); connections.push(value); return value } })
  t.after(() => manager.closeAll())
  const a = await manager.create('a', 120, 32, undefined, '/srv/my app')
  const b = await manager.create('a', 120, 32, undefined, '/logs')
  assert.notEqual(a.id, b.id)
  assert.match(manager.get(a.id).read(0).data, /my app/)
  manager.get(a.id).writeOrdered(0, 'echo first\r')
  assert.match(manager.get(a.id).read(0).data, /echo first/)
  assert.doesNotMatch(manager.get(b.id).read(0).data, /echo first/)
  await manager.get(a.id).close()
  assert.throws(() => manager.get(a.id), /not found/)
  assert.equal(manager.get(b.id).profileId, 'a')
})

test('shutdown cancels a browser terminal that is still opening', async () => {
  let release
  const conn = connection()
  const manager = new BrowserTerminalManager({ connectTerminal: () => new Promise(resolve => { release = resolve }) })
  const opening = manager.create('a', 80, 24)
  await manager.closeAll()
  release(conn)
  await assert.rejects(opening, /cancelled/)
  assert.equal(conn.closes, 1)
  await assert.rejects(manager.create('a', 80, 24), /shutting down/)
})

test('connection capacity includes pending opens and releases failed reservations', async t => {
  const pending = []
  const manager = new BrowserTerminalManager({ connectTerminal: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) })
  t.after(() => manager.closeAll())
  const opens = Array.from({ length: 32 }, () => manager.create('a', 80, 24))
  const results = Promise.allSettled(opens)
  await assert.rejects(manager.create('a', 80, 24), error => error.status === 429)
  for (const request of pending) request.reject(new Error('network unavailable'))
  assert.equal((await results).filter(result => result.status === 'rejected').length, 32)
  const retry = manager.create('a', 80, 24)
  pending.at(-1).resolve(connection())
  assert.ok((await retry).id)
})

test('reattachment resets input order and refuses delayed input from the old page', async t => {
  const manager = new BrowserTerminalManager({ async connectTerminal() { return connection() } })
  t.after(() => manager.closeAll())
  const { id } = await manager.create('a', 80, 24)
  const terminal = manager.get(id)
  const first = terminal.attach('a')
  terminal.writeOrdered(0, 'first-page\r', first.inputEpoch)
  terminal.writeOrdered(2, 'abandoned-gap\r', first.inputEpoch)
  const second = terminal.attach('a')
  assert.notEqual(first.inputEpoch, second.inputEpoch)
  assert.throws(() => terminal.writeOrdered(1, 'stale-page\r', first.inputEpoch), error => error.status === 409)
  assert.throws(() => terminal.writeOrdered(0, 'legacy-page\r'), error => error.status === 409)
  terminal.writeOrdered(0, 'new-page\r', second.inputEpoch)
  terminal.writeOrdered(0, 'duplicate\r', second.inputEpoch)
  const output = terminal.read(0).data
  assert.match(output, /first-page/); assert.match(output, /new-page/)
  assert.doesNotMatch(output, /abandoned-gap|stale-page|legacy-page|duplicate/)
  assert.throws(() => terminal.attach('another-host'), error => error.status === 404)
})

test('output and attached readers retain terminals; detached idle channels expire', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const conn = connection()
  const manager = new BrowserTerminalManager({ async connectTerminal() { return conn } })
  t.after(() => manager.closeAll())
  const { id } = await manager.create('a', 80, 24)
  const terminal = manager.get(id)
  t.mock.timers.tick(29 * 60_000)
  conn.channel.write('long-running-output')
  t.mock.timers.tick(29 * 60_000)
  assert.equal(manager.get(id), terminal)
  const stop = terminal.subscribeOutput(() => {})
  t.mock.timers.tick(31 * 60_000)
  assert.equal(manager.get(id), terminal)
  stop(); stop()
  t.mock.timers.tick(29 * 60_000)
  assert.equal(manager.get(id), terminal)
  t.mock.timers.tick(60_001)
  await new Promise(resolve => setImmediate(resolve))
  assert.throws(() => manager.get(id), /not found/)
})

test('browser attach API requires mutation header, verifies host and fences stale input', async t => {
  const { registerSshApi } = await import('../lib/api.js')
  const { createServer } = await import('node:http')
  const manager = new BrowserTerminalManager({ async connectTerminal() { return connection() } })
  t.after(() => manager.closeAll())
  const { id } = await manager.create('a', 80, 24)
  let route
  registerSshApi({ register(value) { route = value; return () => {} } }, '/ssh-local/v1', { terminals: manager })
  const server = createServer((req, res) => { void route.handler(req, res) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}/ssh-local/v1/terminals/${id}`
  const headers = { 'Content-Type': 'application/json', 'X-DSH-SSH-Request': '1' }
  const post = (path, body) => fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) })
  assert.equal((await fetch(base + '/attach', { method: 'POST', body: JSON.stringify({ profileId: 'a' }) })).status, 403)
  assert.equal((await post('/attach', { profileId: 'b' })).status, 404)
  const attached = await post('/attach', { profileId: 'a' }); assert.equal(attached.status, 200)
  const { inputEpoch } = await attached.json()
  assert.equal((await post('/input', { text: 'valid', sequence: 0, inputEpoch })).status, 204)
  assert.equal((await post('/input', { text: 'stale', sequence: 1, inputEpoch: 'old' })).status, 409)
  assert.equal((await post('/input', { text: 'legacy', sequence: 1 })).status, 409)
})
