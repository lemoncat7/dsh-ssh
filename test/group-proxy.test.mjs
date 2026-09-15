import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { effectiveHostProxy, groupProxyId, parseGroupProxy, saveGroupProxy } from '../lib/group-proxy.js'
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
