import assert from 'node:assert/strict'
import test from 'node:test'
import { EndpointSessionManager } from '../lib/endpoint-session-manager.js'
import { RemoteFileSystems } from '../lib/remote-file-systems.js'

test('keeps an in-flight pane session alive while switching the pane to another endpoint', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const closed = []
  const files = new RemoteFileSystems([
    adapter('sftp', ['first', 'second'], id => ({
      endpoint: endpoint('sftp', id),
      async list(path) { if (id === 'first') await gate; return { path, parent: null, entries: [] } },
      close() { closed.push(id) },
    })),
  ])
  const manager = new EndpointSessionManager(files, 60_000)
  const first = manager.run('pane', 'sftp:first', session => session.list('/'))
  await Promise.resolve()
  const second = manager.run('pane', 'sftp:second', session => session.list('/'))
  await second
  assert.deepEqual(closed, [])
  release()
  await first
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(closed, ['first'])
  manager.closeAll()
  assert.deepEqual(closed, ['first', 'second'])
})

test('does not idle-reap a pane session while an operation is active', async () => {
  let closed = false
  const files = new RemoteFileSystems([
    adapter('ftp', ['slow'], id => ({
      endpoint: endpoint('ftp', id),
      async list(path) { await new Promise(resolve => setTimeout(resolve, 35)); assert.equal(closed, false); return { path, parent: null, entries: [] } },
      close() { closed = true },
    })),
  ])
  const manager = new EndpointSessionManager(files, 5)
  await manager.run('pane', 'ftp:slow', session => session.list('/'))
  assert.equal(closed, false)
  manager.closeAll()
  assert.equal(closed, true)
})

function adapter(kind, ids, create) {
  return {
    kind,
    endpoint: id => ids.includes(id) ? endpoint(kind, id) : undefined,
    endpoints: () => ids.map(id => endpoint(kind, id)),
    async connect(id) {
      const session = create(id)
      return {
        ...session,
        async stat() { throw Object.assign(new Error('not found'), { status: 404 }) },
        async download() {},
        async upload() {},
        async ensureDirectory() {},
      }
    },
  }
}

function endpoint(kind, id) {
  return { id: `${kind}:${id}`, kind, protocol: kind, name: id, address: id, initialPath: '/' }
}
