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

test('synchronized route changes stop live listeners and block Start until the definition is committed', async t => {
  let connections=0,closed=0
  const manager=new ForwardManager({async connect(){connections++;const c=connection();c.close=()=>{closed++};return c}},store)
  t.after(()=>manager.closeAll())
  await manager.start(rule.id)
  await manager.withRulesStopped([rule.id],async()=>{
    assert.equal(manager.status(rule.id).state,'stopped')
    await assert.rejects(manager.start(rule.id),e=>e.status===409)
    assert.equal(connections,1)
  })
  assert.equal(closed,1)
  await manager.start(rule.id);assert.equal(connections,2)
  await assert.rejects(manager.withRulesStopped([rule.id],async()=>{throw Error('apply failed')}),/apply failed/)
  await manager.start(rule.id);assert.equal(connections,3)
  await manager.withRulesStopped(['not-yet-published'],async()=>{await assert.rejects(manager.start('not-yet-published'),e=>e.status===409)})
  await assert.rejects(manager.start('not-yet-published'),e=>e.status===404)
})
test('a route synchronization cannot publish an in-flight SSH connection under an obsolete definition',async()=>{
  let resolve,closed=0,applied=false
  const manager=new ForwardManager({connect:()=>new Promise(r=>{resolve=r})},store)
  const starting=manager.start(rule.id)
  const rejected=assert.rejects(starting,/规则已更改/)
  const syncing=manager.withRulesStopped([rule.id],async()=>{applied=true})
  resolve({close(){closed++}})
  await rejected;await syncing
  assert.equal(applied,true);assert.equal(closed,1);assert.equal(manager.status(rule.id).state,'stopped')
})
