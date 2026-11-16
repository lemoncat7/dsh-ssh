import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SshStore } from '../lib/store.js'
import { inheritSessionForks } from '../lib/session-fork.js'
import { registerSshApi } from '../lib/api.js'
import { createServer } from 'node:http'

const defaults = { allowPublicBind: false, defaultCommandTimeoutMs: 30000, maxOutputChars: 32000 }
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ssh-fork-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'state.json'), store = await SshStore.open(path, defaults)
  await store.update(state => {
    state.profiles.push({ id: 'host', name: 'Host', host: '127.0.0.1', port: 22, username: 'test', authType: 'agent', proxy: { type: 'none' }, tags: [], createdAt: 1, updatedAt: 1 })
    state.remoteProjects.push(...['a', 'b'].map(id => ({ id, name: id, profileId: 'host', path: '/'+id, createdAt: 1, updatedAt: 1 })))
    state.injections.push({ sessionId: 'parent', profileIds: ['host'], fileEndpointIds: ['sftp:host'], permission: 'terminal', requireCommandApproval: false, filePermission: 'transfer', requireFileApproval: false, allowLocalUpload: true, allowLocalDownload: true, workingDirectories: { host: '/b' }, workingProjectIds: { host: 'b' }, mountedProjectIds: { host: ['a', 'b'] }, updatedAt: 1 })
  })
  return { store, path }
}

test('public fork without parentSession persists access before immediate UI reads and survives restart', async t => {
  const { store, path } = await fixture(t)
  const request = { sessionId: 'parent', atSeq: 7, allowMigration: false }, result = { sessionId: 'child', extra: true }
  const controller = { async fork(value) { assert.equal(this, controller); assert.equal(value, request); return result } }
  const original = controller.fork, dispose = inheritSessionForks(controller, store)
  t.after(dispose)
  assert.equal(await controller.fork(request), result)
  const inherited = store.injection('child')
  assert.deepEqual({ ...inherited, sessionId: 'parent', updatedAt: 1 }, store.injection('parent'))
  assert.deepEqual((await SshStore.open(path, defaults)).injection('child'), inherited)
  let route
  registerSshApi({ register(value) { route = value; return () => {} } }, '/ssh', { store, aiTerminals: { activity() { return [] } } })
  const server = createServer((req, res) => void route.handler(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}/ssh`
  assert.deepEqual(await (await fetch(base+'/injections?sessionId=child')).json(), inherited)
  const activity = await (await fetch(base+'/activity?sessionId=child')).json()
  assert.equal(activity.profiles[0].cwd, '/b')
  assert.equal(activity.profiles[0].mountedDirectories.length, 2)
  assert.deepEqual(activity.terminals, [])
  dispose(); assert.equal(controller.fork, original)
})

test('concurrent and multi-generation copies stay isolated and never overwrite explicit child access', async t => {
  const { store } = await fixture(t)
  let count = 0
  const controller = { async fork() { return { sessionId: 'child-'+count++ } } }
  t.after(inheritSessionForks(controller, store))
  const children = await Promise.all(Array.from({ length: 8 }, () => controller.fork({ sessionId: 'parent' })))
  assert.equal(store.snapshot().injections.length, 9)
  await store.update(state => { state.injections.find(x => x.sessionId === children[0].sessionId).workingDirectories.host = '/changed' })
  assert.equal(store.injection('parent').workingDirectories.host, '/b')
  const grandchild = await controller.fork({ sessionId: children[0].sessionId })
  assert.equal(store.injection(grandchild.sessionId).workingDirectories.host, '/changed')
  await store.update(state => state.injections.push({ ...store.injection('parent'), sessionId: 'child-9', profileIds: [], fileEndpointIds: [], workingDirectories: {}, workingProjectIds: {}, mountedProjectIds: {} }))
  const empty = await controller.fork({ sessionId: 'parent' })
  assert.deepEqual(store.injection(empty.sessionId).profileIds, [])
  assert.equal(store.injection((await controller.fork({ sessionId: 'unmounted' })).sessionId), undefined)
})

test('failed forks do not grant access; inherited prototype method is restored on unload', async t => {
  const { store } = await fixture(t)
  class Controller { async fork() { throw Error('source unavailable') } }
  const controller = new Controller(), original = controller.fork
  const dispose = inheritSessionForks(controller, store)
  await assert.rejects(controller.fork({ sessionId: 'parent' }), /source unavailable/)
  assert.equal(store.snapshot().injections.length, 1)
  dispose(); dispose()
  assert.equal(Object.hasOwn(controller, 'fork'), false)
  assert.equal(controller.fork, original)
})

test('official host controller fork and Cordis service injection use the wrapped public boundary', async t => {
  const { SessionController } = await import('@deepseek-ai/dsh-api-session-controller')
  const { Context } = await import('@deepseek-ai/cordis')
  const { store } = await fixture(t)
  const controller = Object.create(SessionController.prototype)
  controller.commands = { async fork(request) { assert.equal(request.sessionId, 'parent'); return { sessionId: 'host-child' } } }
  const ctx = new Context()
  ctx.provide('sessionController', controller)
  const original = controller.fork
  const scope = ctx.inject(['sessionController'], runtime => {
    runtime.effect(() => inheritSessionForks(runtime.get('sessionController'), store))
  })
  await scope
  const result = await ctx.get('sessionController').fork({ sessionId: 'parent' })
  assert.equal(result.sessionId, 'host-child')
  assert.deepEqual(store.injection('host-child').profileIds, ['host'])
  await scope.dispose()
  assert.equal(controller.fork, original)
  assert.equal(Object.hasOwn(controller, 'fork'), false)
})

test('traced service methods preserve caller context and unload without stacking wrappers', async t => {
  const { Context, Service } = await import('@deepseek-ai/cordis')
  const { store } = await fixture(t), ctx = new Context()
  class Controller extends Service {
    constructor(ctx) { super(ctx, 'sessionController') }
    async fork() { assert.equal(this.ctx.probe, 'request-context'); return { sessionId: 'traced-child' } }
  }
  const controller = new Controller(ctx)
  const scope = ctx.inject(['sessionController'], runtime => {
    runtime.effect(() => inheritSessionForks(runtime.get('sessionController'), store))
  })
  await scope
  await ctx.extend({ probe: 'request-context' }).get('sessionController').fork({ sessionId: 'parent' })
  assert.deepEqual(store.injection('traced-child').profileIds, ['host'])
  await scope.dispose()
  assert.equal(Object.hasOwn(controller, 'fork'), false)
  assert.equal(controller.fork, Controller.prototype.fork)
})
