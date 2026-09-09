import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { SshStore } from '../lib/store.js'
import { saveCommand, commandDraft } from '../lib/commands.js'
import { mountedProjects, parseProjectMounts } from '../lib/project-mounts.js'
import { registerSshApi } from '../lib/api.js'

const defaults = { allowPublicBind: false, defaultCommandTimeoutMs: 30000, maxOutputChars: 32000 }
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ssh-workbench-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'state.json')
  const store = await SshStore.open(path, defaults)
  await store.update(state => {
    state.profiles = ['a', 'b'].map(id => ({ id, name: id, host: '127.0.0.1', port: 22, username: 'test', authType: 'agent', proxy: { type: 'none' }, tags: [], createdAt: 1, updatedAt: 1 }))
    state.remoteProjects = [{ id: 'p1', profileId: 'a', name: 'App', path: '/app', createdAt: 1, updatedAt: 1 }, { id: 'p2', profileId: 'a', name: 'Logs', path: '/logs', createdAt: 1, updatedAt: 1 }, { id: 'p3', profileId: 'b', name: 'Other', path: '/other', createdAt: 1, updatedAt: 1 }]
  })
  return { store, path }
}

test('command records validate, serialize updates and survive restart without exposing them to Gist', async t => {
  const { store, path } = await fixture(t)
  const entries = await Promise.all(Array.from({ length: 10 }, (_, i) => saveCommand(store, { name: `命令 ${i}`, command: 'pwd\nls -la' })))
  assert.equal(store.snapshot().commands.length, 10)
  const updated = await saveCommand(store, { name: '修改后的命令', command: 'uptime' }, entries[0].id)
  assert.equal(updated.createdAt, entries[0].createdAt)
  assert.equal((await SshStore.open(path, defaults)).snapshot().commands.find(item => item.id === updated.id).command, 'uptime')
  assert.throws(() => commandDraft({ name: 'bad', command: '\x1b[31m' }), /控制字符/)
  assert.throws(() => commandDraft({ name: '', command: 'pwd' }), /名称/)
  assert.equal(commandDraft({ name: 'Windows 粘贴', command: 'pwd\r\nls' }).command, 'pwd\nls')
  assert.throws(() => commandDraft({ name: 'bad', command: 'x'.repeat(16001) }), /16000/)
  await assert.rejects(saveCommand(store, { name: 'missing', command: 'pwd' }, 'missing'), /已删除/)
  const source = await readFile(new URL('../src/gist-sync.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /state\.commands/)
})

test('mounts inherit legacy defaults, persist multiple directories and drop deleted references', async t => {
  const { store, path } = await fixture(t)
  assert.deepEqual(mountedProjects({ workingProjectIds: { a: 'p1' } }, 'a'), ['p1'])
  assert.deepEqual(parseProjectMounts({ a: ['p1', 'p2', 'p1'] }, ['a'], store.remoteProjects()), { a: ['p1', 'p2'] })
  assert.throws(() => parseProjectMounts({ a: ['p3'] }, ['a'], store.remoteProjects()), /授权/)
  assert.throws(() => parseProjectMounts({ b: ['p3'] }, ['a'], store.remoteProjects()), /授权/)
  await store.update(state => state.injections.push({ sessionId: 's', profileIds: ['a'], fileEndpointIds: [], filePermission: 'browse', requireFileApproval: true, permission: 'exec', requireCommandApproval: true, workingDirectories: { a: '/app' }, workingProjectIds: { a: 'p1' }, mountedProjectIds: { a: ['p1', 'p2'] }, updatedAt: 1 }))
  await store.inheritInjection('s', 'fork')
  assert.deepEqual((await SshStore.open(path, defaults)).injection('fork').mountedProjectIds, { a: ['p1', 'p2'] })
  await store.update(state => { state.remoteProjects = state.remoteProjects.filter(item => item.id !== 'p1') })
  assert.deepEqual(store.injection('fork').mountedProjectIds, { a: ['p2'] })
  assert.deepEqual(store.injection('fork').workingProjectIds, {})
  await store.update(state => { state.injections.find(item => item.sessionId === 'fork').profileIds = [] })
  assert.deepEqual(store.injection('fork').mountedProjectIds, {})
})

test('management API gates mutations, supports commands and preserves mounts across older clients', async t => {
  const { store } = await fixture(t)
  let route
  registerSshApi({ register(value) { route = value; return () => {} } }, '/ssh-local/v1', { store, aiTerminals: { async closeOwner() {}, async closeProfile() {} } })
  const server = createServer((req, res) => { void route.handler(req, res) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const root = `http://127.0.0.1:${server.address().port}/ssh-local/v1`
  const headers = { 'Content-Type': 'application/json', 'X-DSH-SSH-Request': '1' }
  assert.equal((await fetch(root + '/commands', { method: 'POST', body: '{}' })).status, 403)
  const created = await fetch(root + '/commands', { method: 'POST', headers, body: JSON.stringify({ name: '系统版本', command: 'uname -a' }) })
  assert.equal(created.status, 201)
  const item = await created.json()
  assert.equal((await (await fetch(root + '/commands')).json())[0].id, item.id)
  assert.equal((await fetch(root + '/commands/' + item.id, { method: 'DELETE', headers })).status, 204)
  assert.equal((await fetch(root + '/commands/' + item.id, { method: 'PUT', headers, body: JSON.stringify({ name: 'old', command: 'pwd' }) })).status, 404)
  const access = { profileIds: ['a'], permission: 'exec', workingProjectIds: { a: 'p1' }, workingDirectories: { a: '/app' }, mountedProjectIds: { a: ['p1', 'p2'] } }
  const put = value => fetch(root + '/injections/s', { method: 'PUT', headers, body: JSON.stringify(value) })
  assert.equal((await put(access)).status, 200)
  const { mountedProjectIds, ...legacy } = access
  assert.equal((await put(legacy)).status, 200)
  assert.deepEqual(store.injection('s').mountedProjectIds, { a: ['p1', 'p2'] })
  assert.equal((await put({ ...access, mountedProjectIds: { a: ['p3'] } })).status, 400)
  assert.equal((await put({ ...access, mountedProjectIds: { a: ['p2'] }, workingDirectories: {}, workingProjectIds: {} })).status, 200)
  assert.equal(store.injection('s').workingDirectories.a, '/logs')
})
