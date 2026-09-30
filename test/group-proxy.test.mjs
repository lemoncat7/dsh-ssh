import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deleteGroup, effectiveHostProxy, groupProxyId, moveProfileToGroup, parseGroupProxy, saveGroupProxy } from '../lib/group-proxy.js'
import { SshStore } from '../lib/store.js'
import { SshConnector } from '../lib/connector.js'
import { createPortableSnapshot, parsePortableSnapshot, mergePortableSnapshots } from '../lib/gist-sync.js'

test('group proxy is a fallback, preserves explicit host routes and resolves shared credentials', async () => {
  const group = { id: groupProxyId('办公'), name: '办公', proxyId: 'proxy-one', createdAt: 1, updatedAt: 1 }
  const host = { group: '办公', proxy: { type: 'none' } }
  assert.deepEqual(effectiveHostProxy(host, [group]), { type: 'saved', proxyId: 'proxy-one' })
  assert.deepEqual(effectiveHostProxy({ ...host, group: '其他' }, [group]), { type: 'none' })
  for (const proxy of [{ type: 'saved', proxyId: 'own' }, { type: 'jump', profileIds: ['jump'] }, { type: 'http', host: 'own', port: 1 }]) assert.deepEqual(effectiveHostProxy({ ...host, proxy }, [group]), proxy)
  const connector = new SshConnector({ groupProxies: () => [group], proxyEntry: id => id === 'proxy-one' ? { id, proxyType: 'socks5', host: 'proxy.test', port: 1080 } : undefined }, { readProxyEntry: async id => { assert.equal(id, 'proxy-one'); return { proxyPassword: 'secret' } } })
  assert.deepEqual(await connector.resolveProxy(host, {}), { config: { type: 'socks5', host: 'proxy.test', port: 1080 }, password: 'secret' })
})

test('group proxies persist, sync, prevent referenced proxy deletion, and can be cleared', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ssh-group-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'state.json'), defaults = { allowPublicBind: false, defaultCommandTimeoutMs: 30000, maxOutputChars: 32000 }
  const store = await SshStore.open(path, defaults)
  await store.update(state => {
    state.profiles = [{ id: 'host', name: 'host', group: '办公', host: 'example.test', port: 22, username: 'user', authType: 'agent', proxy: { type: 'none' }, tags: [], keepAliveIntervalMs: 0, connectTimeoutMs: 5000, terminalType: 'xterm', createdAt: 1, updatedAt: 1 }]
    state.proxyEntries = [{ id: 'proxy', name: 'proxy', proxyType: 'socks5', host: 'proxy.test', port: 1080, createdAt: 1, updatedAt: 1 }]
  })
  const before = store.workspaceRevision()
  await saveGroupProxy(store, { name: '办公', proxyId: 'proxy' })
  assert.notEqual(store.workspaceRevision(), before)
  assert.equal((await SshStore.open(path, defaults)).groupProxies()[0].proxyId, 'proxy')
  const snapshot = createPortableSnapshot(store.snapshot(), 'device-group')
  assert.deepEqual(parsePortableSnapshot(JSON.stringify(snapshot)).collections.groupProxies, store.groupProxies())
  await assert.rejects(store.update(state => { state.proxyEntries = [] }), /references a missing proxy/)
  const remote = structuredClone(snapshot)
  remote.collections.groupProxies[0].updatedAt++
  delete remote.collections.groupProxies[0].proxyId
  assert.equal(mergePortableSnapshots(snapshot, remote, 'merged-device').collections.groupProxies[0].proxyId, undefined)
  await saveGroupProxy(store, { name: '办公', proxyId: '' })
  assert.equal(store.groupProxies()[0].proxyId, undefined)
  await assert.rejects(saveGroupProxy(store, { name: '办公', proxyId: 'missing' }), /missing proxy/)
  assert.throws(() => parseGroupProxy({ ...store.groupProxies()[0], id: 'wrong' }), /Invalid/)
})

test('empty groups can be created, renamed with their hosts, and receive dragged profiles', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ssh-group-move-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'state.json'), defaults = { allowPublicBind: false, defaultCommandTimeoutMs: 30000, maxOutputChars: 32000 }
  const store = await SshStore.open(path, defaults)
  await store.update(state => {
    state.profiles = [{ id: 'host', name: 'host', group: '办公', host: 'example.test', port: 22, username: 'user', authType: 'agent', proxy: { type: 'none' }, tags: [], keepAliveIntervalMs: 0, connectTimeoutMs: 5000, terminalType: 'xterm', createdAt: 1, updatedAt: 1 }]
  })
  await saveGroupProxy(store, { name: '备用', proxyId: '' })
  assert.deepEqual(store.groupProxies().map(group => group.name), ['备用'])
  await moveProfileToGroup(store, 'host', { group: '备用' })
  assert.equal(store.profiles()[0].group, '备用')
  await saveGroupProxy(store, { previousName: '备用', name: '生产', proxyId: '' })
  assert.equal(store.profiles()[0].group, '生产')
  assert.equal(store.groupProxies()[0].name, '生产')
  await moveProfileToGroup(store, 'host', { group: null })
  assert.equal(store.profiles()[0].group, undefined)
  await assert.rejects(moveProfileToGroup(store, 'host', { group: '不存在' }), /no longer exists/)
  await moveProfileToGroup(store, 'host', { group: '生产' })
  await store.update(state => {
    state.profiles[0].proxy = { type: 'http', host: 'proxy.test', port: 8080 }
    state.profiles.push({ ...state.profiles[0], id: 'outside', group: '其他' })
  })
  const outside = store.profile('outside')
  await saveGroupProxy(store, { previousName: '生产', name: '生产', proxyId: '' })
  assert.equal(store.profile('host').proxy.type, 'http', 'ordinary save preserves host overrides')
  await assert.rejects(saveGroupProxy(store, { previousName: '生产', name: '生产', proxyId: 'missing', resetHostProxies: true }), /missing proxy/)
  assert.equal(store.profile('host').proxy.type, 'http', 'failed save is atomic')
  await saveGroupProxy(store, { previousName: '生产', name: '新生产', proxyId: '', resetHostProxies: true })
  assert.deepEqual(store.profile('host').proxy, { type: 'none' })
  assert.equal(store.profile('host').group, '新生产')
  assert.deepEqual(store.profile('outside'), outside, 'other groups are untouched')
  assert.deepEqual((await SshStore.open(path, defaults)).profile('host').proxy, { type: 'none' })
  const beforeDelete = store.profile('host')
  await deleteGroup(store, { name: '新生产' })
  assert.equal(store.profile('host').group, undefined)
  assert.equal(store.profiles().length, 2)
  assert.deepEqual(store.profile('host').proxy, beforeDelete.proxy)
  assert.deepEqual(store.profile('outside'), outside)
  assert.equal(store.groupProxies().some(group => group.name === '新生产'), false)
  assert.equal((await SshStore.open(path, defaults)).profile('host').group, undefined)
  await assert.rejects(deleteGroup(store, { name: '新生产' }), /no longer exists/)
  await saveGroupProxy(store, { name: '空组', proxyId: '' })
  await deleteGroup(store, { name: '空组' })
  assert.equal(store.groupProxies().some(group => group.name === '空组'), false)
  await deleteGroup(store, { name: '其他' })
  assert.equal(store.profile('outside').group, undefined)
  assert.deepEqual(store.profile('outside').proxy, outside.proxy)
})
