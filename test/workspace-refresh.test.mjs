import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkspaceRefresh } from '../lib/workspace-refresh.js'

test('workspace refresh shares requests, refreshes all consumers and retries failed updates', async () => {
  let revision = 'one', reads = 0, first = 0, second = 0, fail = false
  const monitor = new WorkspaceRefresh(async () => { reads++; return revision })
  const stopA = monitor.subscribe(async () => { first++; return !fail })
  const stopB = monitor.subscribe(async () => { second++ })
  await Promise.all([monitor.check(), monitor.check()])
  assert.equal(reads, 1); assert.equal(first, 1); assert.equal(second, 1)
  await monitor.check(); assert.equal(first, 1)
  revision = 'two'; fail = true
  await monitor.check(); assert.equal(first, 2)
  fail = false; await monitor.check(); assert.equal(first, 3)
  await monitor.check(); assert.equal(first, 3)
  stopA(); stopB(); const previousReads = reads
  await monitor.check(); assert.equal(reads, previousReads)
})
