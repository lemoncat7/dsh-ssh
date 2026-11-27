import assert from 'node:assert/strict'
import test from 'node:test'
import { TerminalViewCache } from '../lib/terminal-view-cache.js'

test('panel reopen retains the same view and cursor; closed terminals release it', () => {
  const cache = new TerminalViewCache(), owner = { id: 'running' }
  let created = 0, disposed = 0
  const create = () => ({ cursor: ++created, dispose() { disposed++ } })
  const first = cache.acquire(owner, create)
  first.view.cursor = 123456
  first.release(); first.release()
  const next = cache.acquire(owner, create)
  assert.equal(next.view, first.view)
  assert.equal(next.view.cursor, 123456)
  assert.equal(created, 1)
  owner.id = undefined
  next.release()
  assert.equal(disposed, 1)
  cache.clear()
  assert.equal(disposed, 1)
})

test('cache evicts detached least-recently-used views and plugin unload disposes survivors once', () => {
  const cache = new TerminalViewCache(2), disposed = []
  const owners = ['a', 'b', 'c', 'd'].map(id => ({ id }))
  const acquire = owner => cache.acquire(owner, () => ({ dispose: () => disposed.push(owner.id) }))
  const a = acquire(owners[0]), b = acquire(owners[1])
  b.release()
  const c = acquire(owners[2]); c.release()
  assert.deepEqual(disposed, ['b'], 'Attached a cannot be evicted')
  a.release()
  const reused = acquire(owners[0]); reused.release()
  const d = acquire(owners[3]); d.release()
  assert.deepEqual(disposed, ['b', 'c'], 'Recently reopened a stays cached')
  cache.clear(); cache.clear()
  assert.deepEqual(disposed, ['b', 'c', 'a', 'd'])
})

test('activity keys retain independent cursors and explicit removal waits for mounted consumers', () => {
  const cache = new TerminalViewCache(2), disposed = []
  const create = key => () => ({ cursor: 0, dispose: () => disposed.push(key) })
  const a = cache.acquire('session-a/terminal', create('a'))
  a.view.cursor = 256000
  a.release()
  const b = cache.acquire('session-b/terminal', create('b'))
  const again = cache.acquire('session-a/terminal', create('unexpected'))
  assert.equal(again.view, a.view)
  assert.equal(again.view.cursor, 256000)
  assert.notEqual(again.view, b.view)
  cache.drop('session-a/terminal')
  assert.deepEqual(disposed, [], 'A mounted consumer must not be disposed mid-render')
  again.release(); again.release()
  assert.deepEqual(disposed, ['a'])
  b.release(); cache.drop('session-b/terminal'); cache.drop('session-b/terminal')
  assert.deepEqual(disposed, ['a', 'b'])
  cache.clear()
  assert.deepEqual(disposed, ['a', 'b'])
})

test('bounded activity cache evicts old output and plugin unload clears active and idle views once', () => {
  const cache = new TerminalViewCache(2), disposed = []
  const acquire = key => cache.acquire(key, () => ({ dispose: () => disposed.push(key) }))
  acquire('a').release(); acquire('b').release(); acquire('c').release()
  assert.deepEqual(disposed, ['a'])
  const c = acquire('c')
  cache.clear(); cache.clear(); c.release()
  assert.deepEqual(disposed, ['a', 'b', 'c'])
})
