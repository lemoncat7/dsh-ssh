import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileTransferManager } from '../lib/file-transfer-manager.js'
import { registerSshApi } from '../lib/api.js'
import { registerSshTools } from '../lib/tools.js'
import { SshStore } from '../lib/store.js'
import { connectFtpProfile } from '../lib/ftp-adapter.js'
import { connectSocket } from '../lib/proxy.js'
import { openSftpFileSystemSession } from '../lib/sftp.js'
import net from 'node:net'
import { once } from 'node:events'

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const tick = () => new Promise(resolve => setImmediate(resolve))
async function bounded(promise) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('cancellation is still waiting for a dead protocol callback')), 1500) })]) }
  finally { clearTimeout(timer) }
}
async function waitState(manager, id, state) {
  for (let i = 0; i < 100; i++) {
    if (manager.get(id).state === state) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.fail('missing state ' + state)
}
const request = { sourceEndpointId: 'sftp:source', sourcePaths: ['/file.bin'], destinationEndpointId: 'sftp:dest', destinationDirectory: '/target', conflictPolicy: 'fail' }
function fixture(phase = 'transfer') {
  const blocked = deferred(), lateConnection = deferred(), closed = [], connections = []
  let normal = false
  const files = {
    endpoint: id => ({ id, kind: 'sftp', protocol: 'sftp', name: id, address: 'test', initialPath: '/' }),
    async connect(id) {
      const session = {
        endpoint: files.endpoint(id),
        async stat(path) {
          if (!normal && phase === 'scan' && id === 'sftp:source') return blocked.promise
          if (id === 'sftp:dest') throw Object.assign(Error('missing'), { status: 404 })
          return { name: 'file.bin', path, kind: 'file', size: 4, modifiedAt: 0 }
        },
        async ensureDirectory() {},
        async download(_path, target) { target.end(Buffer.from('test')) },
        async upload(_path, source) {
          for await (const _chunk of source) {}
          // Simulate the reported case: sockets already closed, final callback never arrives.
          if (!normal && phase === 'transfer') await blocked.promise
        },
        close() { closed.push(id) },
      }
      connections.push(id)
      if (!normal && phase === 'connect' && id === 'sftp:dest') await lateConnection.promise
      return session
    },
  }
  const manager = new FileTransferManager(files, 1)
  return { manager, files, blocked, lateConnection, closed, connections, resume: () => { normal = true } }
}

for (const phase of ['connect', 'scan', 'transfer']) {
  test(`cancel confirms terminal state despite a stuck ${phase} callback, and ignores late completion`, async () => {
    const f = fixture(phase)
    const job = f.manager.start('owner', request)
    await waitState(f.manager, job.id, phase === 'transfer' ? 'transferring' : 'scanning')
    await tick()
    await assert.rejects(f.manager.cancelAndWait(job.id, 'foreign'), error => error.status === 404)
    const result = await bounded(f.manager.cancelAndWait(job.id, 'owner'))
    assert.equal(result.state, 'cancelled')
    assert.ok(result.completedAt)
    assert.ok(f.closed.includes('sftp:source'))
    const saved = f.manager.get(job.id)
    f.blocked.resolve({ name: 'file.bin', path: '/file.bin', kind: 'file', size: 4, modifiedAt: 0 })
    f.lateConnection.resolve()
    await tick(); await tick()
    assert.deepEqual(f.manager.get(job.id), saved, 'late callbacks cannot resurrect the task')
    assert.deepEqual(f.closed.sort(), ['sftp:dest', 'sftp:source'])
    assert.equal(f.manager.dismiss(job.id, 'owner'), true)
    await bounded(f.manager.closeAll())
  })
}

test('a cancelled stuck callback releases the concurrency slot for the next task', async () => {
  const f = fixture()
  const first = f.manager.start('owner', request)
  await waitState(f.manager, first.id, 'transferring'); await tick()
  const second = f.manager.start('owner', request)
  assert.equal(f.manager.get(second.id).state, 'queued')
  f.resume()
  await bounded(f.manager.cancelAndWait(first.id, 'owner'))
  await waitState(f.manager, second.id, 'completed')
  assert.equal(f.manager.get(first.id).state, 'cancelled')
  await bounded(f.manager.closeAll())
})

test('shutdown cancels dead callbacks and queued work without waiting forever', async () => {
  const f = fixture()
  const first = f.manager.start('owner', request)
  await waitState(f.manager, first.id, 'transferring')
  const second = f.manager.start('owner', request)
  await bounded(f.manager.closeAll())
  assert.equal(f.manager.get(first.id).state, 'cancelled')
  assert.equal(f.manager.get(second.id).state, 'cancelled')
  assert.deepEqual(f.closed.sort(), ['sftp:dest', 'sftp:source'])
})

test('an endpoint that connects after its peer fails is closed instead of leaked', async () => {
  const late = deferred(), closed = []
  const manager = new FileTransferManager({
    async connect(id) {
      if (id === 'sftp:source') throw Error('connect failed')
      await late.promise
      return { close() { closed.push(id) } }
    },
  })
  const job = manager.start('owner', request)
  await waitState(manager, job.id, 'failed')
  late.resolve(); await tick()
  assert.deepEqual(closed, ['sftp:dest'])
  await bounded(manager.closeAll())
})

test('cancelling FTP during greeting closes the real control socket instead of leaving a hidden connection', async t => {
  const accepted = deferred()
  const server = net.createServer(socket => { socket.resume(); accepted.resolve(socket) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => server.close())
  const controller = new AbortController()
  const pending = connectFtpProfile({ id: 'pending', name: 'Pending FTP', protocol: 'ftp', host: '127.0.0.1', port: server.address().port, username: 'test', proxy: { type: 'none' }, initialPath: '/', connectTimeoutMs: 30000, createdAt: 0, updatedAt: 0 }, 'test', {
    connect: (host, port, _proxy, timeout, signal) => connectSocket(host, port, timeout, signal),
  }, controller.signal)
  const rejected = assert.rejects(pending)
  const socket = await accepted.promise
  const closed = once(socket, 'close')
  controller.abort()
  await bounded(rejected); await bounded(closed)
})

test('cancelling SFTP during the initial path probe closes its SSH connection even without a callback', async () => {
  let probing = false, closed = 0
  const controller = new AbortController()
  const pending = openSftpFileSystemSession({ connect: async () => ({
    client: { sftp(callback) { callback(null, { realpath() { probing = true } }) } },
    close() { closed++ },
  }) }, 'source', { id: 'sftp:source' }, controller.signal)
  const rejected = assert.rejects(pending)
  await tick(); assert.equal(probing, true)
  controller.abort(); await bounded(rejected)
  assert.equal(closed, 1)
})

test('cancelling an SFTP operation does not wait for its lost callback', async () => {
  let closed = 0, ended = 0, pendingProbe = false
  const sftp = { realpath(path, callback) { if (path === '.') callback(null, '/home'); else pendingProbe = true }, end() { ended++ } }
  const session = await openSftpFileSystemSession({ connect: async () => ({ client: { sftp(callback) { callback(null, sftp) } }, close() { closed++ } }) }, 'source', { id: 'sftp:source' })
  const controller = new AbortController()
  const rejected = assert.rejects(session.stat('/file', controller.signal))
  await tick(); assert.equal(pendingProbe, true)
  controller.abort(); await bounded(rejected)
  assert.equal(closed, 1); assert.equal(ended, 1)
  session.close(); assert.equal(closed, 1)
})

test('native HTTP cancellation returns the confirmed final job, then history can be dismissed', async t => {
  const f = fixture(), job = f.manager.start('owner', request)
  await waitState(f.manager, job.id, 'transferring')
  let route
  registerSshApi({ register(value) { route = value; return () => {} } }, '/ssh-local/v1', { transfers: f.manager })
  const server = createServer((req, res) => { void route.handler(req, res) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const url = `http://127.0.0.1:${server.address().port}/ssh-local/v1/file-transfer/jobs/${job.id}`
  const headers = { 'X-DSH-SSH-Request': '1' }
  assert.equal((await fetch(url, { method: 'DELETE' })).status, 403)
  const response = await bounded(fetch(url, { method: 'DELETE', headers }))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).state, 'cancelled')
  assert.deepEqual(f.closed.sort(), ['sftp:dest', 'sftp:source'])
  assert.equal((await fetch(url + '/history', { method: 'DELETE', headers })).status, 204)
  assert.deepEqual(f.manager.list(), [])
  await bounded(f.manager.closeAll())
})

test('the single ssh AI entry confirms actual cancellation rather than only acknowledging a request', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ssh-cancel-tool-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = await SshStore.open(join(root, 'state.json'), { allowPublicBind: false, defaultCommandTimeoutMs: 30000, maxOutputChars: 32000 })
  await store.update(state => {
    state.profiles = ['source', 'dest'].map(id => ({ id, name: id, host: 'test', port: 22, username: 'test', authType: 'agent', proxy: { type: 'none' }, tags: [], createdAt: 1, updatedAt: 1 }))
    state.injections.push({ sessionId: 'owner', profileIds: ['source', 'dest'], permission: 'exec', requireCommandApproval: false, fileEndpointIds: [], filePermission: 'transfer', requireFileApproval: false, workingDirectories: {}, workingProjectIds: {}, updatedAt: 1 })
  })
  const f = fixture(), tools = new Map()
  const ctx = { provide: () => () => {}, agents: { list: () => [] }, on: () => () => {}, tools: { register: tool => { tools.set(tool.name, tool); return () => {} } } }
  const dispose = registerSshTools(ctx, store, {}, {}, {}, f.files, f.manager)
  t.after(dispose)
  const job = f.manager.start('owner', request)
  await waitState(f.manager, job.id, 'transferring')
  const result = JSON.parse(await bounded(tools.get('ssh').execute({ action: 'call', tool: 'file_transfer_cancel', arguments: { jobId: job.id } }, { agent: { session: { id: 'owner', header: { cwd: root } } }, signal: new AbortController().signal })))
  assert.equal(result.cancelled, true)
  assert.equal(result.state, 'cancelled')
  assert.equal(result.job.state, 'cancelled')
  assert.deepEqual(f.closed.sort(), ['sftp:dest', 'sftp:source'])
  await bounded(f.manager.closeAll())
})
