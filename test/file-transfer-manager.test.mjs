import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { FileTransferManager } from '../lib/file-transfer-manager.js'
import { RemoteFileSystems } from '../lib/remote-file-systems.js'

test('streams a directory between unlike remote file protocols without local staging', async t => {
  const source = memoryAdapter('sftp', 'source', new Map([
    ['/docs', { kind: 'directory' }],
    ['/docs/a.txt', { kind: 'file', data: Buffer.from('alpha') }],
    ['/docs/nested', { kind: 'directory' }],
    ['/docs/nested/b.txt', { kind: 'file', data: Buffer.from('beta') }],
  ]))
  const destinationFiles = new Map([['/target', { kind: 'directory' }]])
  const destination = memoryAdapter('ftp', 'destination', destinationFiles)
  const manager = new FileTransferManager(new RemoteFileSystems([source, destination]), 1)
  t.after(() => manager.closeAll())
  const job = manager.start('session-test', {
    sourceEndpointId: 'sftp:source', sourcePaths: ['/docs'], destinationEndpointId: 'ftp:destination', destinationDirectory: '/target', conflictPolicy: 'fail',
  })
  const completed = await waitForJob(manager, job.id)
  assert.equal(completed.state, 'completed')
  assert.equal(completed.completedFiles, 2)
  assert.equal(completed.transferredBytes, 9)
  assert.equal(destinationFiles.get('/target/docs/a.txt').data.toString(), 'alpha')
  assert.equal(destinationFiles.get('/target/docs/nested/b.txt').data.toString(), 'beta')
})

test('waits for active streams to release both endpoint sessions during shutdown', async () => {
  const closed = []
  const source = blockingAdapter('sftp', 'source', closed)
  const destination = blockingAdapter('ftp', 'destination', closed)
  const manager = new FileTransferManager(new RemoteFileSystems([source, destination]), 1)
  const job = manager.start('session-test', {
    sourceEndpointId: 'sftp:source', sourcePaths: ['/large.bin'], destinationEndpointId: 'ftp:destination', destinationDirectory: '/target', conflictPolicy: 'fail',
  })
  await waitForState(manager, job.id, 'transferring')
  await manager.closeAll()
  assert.equal(manager.get(job.id).state, 'cancelled')
  assert.deepEqual(closed.sort(), ['destination', 'source'])
  assert.throws(() => manager.start('session-test', job.request), /service is closed/)
})

function memoryAdapter(kind, id, files) {
  const endpoint = { id: `${kind}:${id}`, kind, protocol: kind, name: id, address: id, initialPath: '/' }
  return {
    kind,
    endpoint: value => value === id ? endpoint : undefined,
    endpoints: () => [endpoint],
    async connect(value) {
      assert.equal(value, id)
      return {
        endpoint,
        async stat(path) {
          const item = files.get(path)
          if (!item) throw Object.assign(new Error('not found'), { status: 404 })
          return entry(path, item)
        },
        async list(path) {
          const prefix = path === '/' ? '/' : `${path}/`
          const entries = [...files.entries()].filter(([candidate]) => candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes('/')).map(([candidate, item]) => entry(candidate, item))
          return { path, parent: path === '/' ? null : path.replace(/\/[^/]+$/, '') || '/', entries }
        },
        async download(path, destination) { destination.end(files.get(path).data) },
        async upload(path, source, overwrite) {
          if (!overwrite && files.has(path)) throw Object.assign(new Error('exists'), { status: 409 })
          const chunks = []
          for await (const chunk of source) chunks.push(Buffer.from(chunk))
          files.set(path, { kind: 'file', data: Buffer.concat(chunks) })
        },
        async ensureDirectory(path) { files.set(path, { kind: 'directory' }) },
        close() {},
      }
    },
  }
}

function entry(path, item) {
  return { name: path.split('/').at(-1) || '/', path, kind: item.kind, size: item.data?.length ?? 0, modifiedAt: 0 }
}

function blockingAdapter(kind, id, closed) {
  const remoteEndpoint = { id: `${kind}:${id}`, kind, protocol: kind, name: id, address: id, initialPath: '/' }
  return {
    kind,
    endpoint: value => value === id ? remoteEndpoint : undefined,
    endpoints: () => [remoteEndpoint],
    async connect() {
      return {
        endpoint: remoteEndpoint,
        async stat(path) {
          if (id === 'destination') throw Object.assign(new Error('not found'), { status: 404 })
          return { name: 'large.bin', path, kind: 'file', size: 10_000, modifiedAt: 0 }
        },
        async list(path) { return { path, parent: null, entries: [] } },
        async download(_path, destination, signal) {
          await new Promise((resolve, reject) => {
            const abort = () => reject(signal.reason)
            signal.addEventListener('abort', abort, { once: true })
            destination.once('close', resolve)
          })
        },
        async upload(_path, source) { for await (const _chunk of source) {} },
        async ensureDirectory() {},
        close() { closed.push(id) },
      }
    },
  }
}

async function waitForJob(manager, id) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = manager.get(id)
    if (['completed', 'failed', 'cancelled'].includes(job.state)) return job
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('transfer job did not finish')
}

async function waitForState(manager, id, state) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (manager.get(id).state === state) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`transfer job did not enter ${state}`)
}
