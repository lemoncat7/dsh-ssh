import assert from 'node:assert/strict'
import test from 'node:test'
import { PassThrough } from 'node:stream'
import { BrowserTerminalManager } from '../lib/terminal.js'

function connection() {
  const channel = new PassThrough()
  channel.stderr = new PassThrough()
  channel.setWindow = () => {}
  let closes = 0
  return { channel, get closes() { return closes }, profile: { terminalType: 'xterm-256color' }, client: { shell(_size, callback) { callback(null, channel) } }, close() { closes++; channel.destroy() } }
}

test('browser tabs open independent terminals, start in selected directory and close independently', async t => {
  const connections = []
  const manager = new BrowserTerminalManager({ async connect() { const value = connection(); connections.push(value); return value } })
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
  const manager = new BrowserTerminalManager({ connect: () => new Promise(resolve => { release = resolve }) })
  const opening = manager.create('a', 80, 24)
  await manager.closeAll()
  release(conn)
  await assert.rejects(opening, /cancelled/)
  assert.equal(conn.closes, 1)
  await assert.rejects(manager.create('a', 80, 24), /shutting down/)
})

test('connection capacity includes pending opens and releases failed reservations', async t => {
  const pending = []
  const manager = new BrowserTerminalManager({ connect: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) })
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
