import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { ManagedSshConnection } from '../lib/connector.js'
import { TerminalConnectionPool } from '../lib/terminal-connection-pool.js'

function transport() {
  const client = new EventEmitter()
  client.ends = 0
  client.end = () => { client.ends++; client.emit('close') }
  return new ManagedSshConnection(client, { id: 'host' })
}

test('concurrent leases share authentication, close independently and expire idle', async () => {
  const pool = new TerminalConnectionPool(15)
  const raw = transport(); let opens = 0
  const open = async () => { opens++; await delay(5); return raw }
  const [a, b] = await Promise.all([pool.acquire('owner/host', open), pool.acquire('owner/host', open)])
  assert.equal(opens, 1); assert.equal(a.client, b.client); assert.notEqual(a, b)
  a.close(); a.close(); assert.equal(raw.client.ends, 0)
  await delay(25); assert.equal(raw.client.ends, 0, 'a live second lease keeps the transport')
  b.close(); await delay(25); assert.equal(raw.client.ends, 1)
  pool.close()
})

test('cancellation of one waiter does not abort another and all cancellation releases opening', async () => {
  const pool = new TerminalConnectionPool()
  try {
    const raw = transport(), a = new AbortController(); let shared
    const open = async signal => { shared = signal; await delay(10); return raw }
    const first = pool.acquire('one', open, a.signal)
    const second = pool.acquire('one', open)
    a.abort(new Error('cancelled waiter'))
    await assert.rejects(first, /cancelled waiter/)
    const lease = await second
    assert.equal(shared.aborted, false); lease.close()
    const b = new AbortController(); let abandoned
    const pending = pool.acquire('two', async signal => { abandoned = signal; await delay(15); return transport() }, b.signal)
    await delay(1); b.abort()
    await assert.rejects(pending)
    assert.equal(abandoned.aborted, true)
    await delay(20)
  } finally { pool.close() }
})

test('configuration drain keeps existing channels, new scopes never reuse, stale transport is evicted', async () => {
  const pool = new TerminalConnectionPool()
  try {
    const a = await pool.acquire('owner-a/host', async () => transport())
    const b = await pool.acquire('owner-b/host', async () => transport())
    assert.notEqual(a.client, b.client)
    pool.drain(); assert.equal(a.client.ends, 0)
    const fresh = await pool.acquire('owner-a/host', async () => transport())
    assert.notEqual(fresh.client, a.client)
    a.close(); assert.equal(a.client.ends, 1)
    fresh.client.emit('close')
    const replacement = await pool.acquire('owner-a/host', async () => transport())
    assert.notEqual(fresh.client, replacement.client)
    b.close(); fresh.close(); replacement.close()
  } finally { pool.close() }
})

test('failed shared authentication is not cached, limits include pending connections, close aborts pending', async () => {
  const pool = new TerminalConnectionPool(10, 1)
  await assert.rejects(pool.acquire('bad', async () => { throw Error('authentication failed') }), /authentication failed/)
  let signal
  const a = pool.acquire('good', async s => { signal = s; await delay(10); return transport() })
  await assert.rejects(pool.acquire('other', async () => transport()), /pool is full/)
  await delay(1); pool.close(); assert.equal(signal.aborted, true)
  await assert.rejects(a, /cancelled/)
  await assert.rejects(pool.acquire('after-close', async () => transport()), /pool is closed/)
})
