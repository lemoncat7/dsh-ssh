import test from 'node:test'
import assert from 'node:assert/strict'
import { createSharedRead } from '../lib/shared-read.js'
test('concurrent reads share work; settled reads are fresh', async () => {
  let calls=0
  const resource=createSharedRead(async()=>++calls)
  const a=resource.read(),b=resource.read();assert.equal(a,b)
  assert.deepEqual(await Promise.all([a,b]),[1,1]);assert.equal(await resource.read(),2)
})
test('invalidation separates mutations from an older request; failures can retry', async () => {
  const resolve=[]
  const resource=createSharedRead(()=>new Promise((yes,no)=>resolve.push({yes,no})))
  const a=resource.read();await Promise.resolve();resource.invalidate()
  const b=resource.read();await Promise.resolve();resolve[0].yes('old');await a
  assert.equal(resource.read(),b)
  const rejected=assert.rejects(b,/failed/);resolve[1].no(Error('failed'));await rejected
  const c=resource.read();await Promise.resolve();resolve[2].yes('new');assert.equal(await c,'new')
})
