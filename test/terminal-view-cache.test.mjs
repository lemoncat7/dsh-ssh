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
