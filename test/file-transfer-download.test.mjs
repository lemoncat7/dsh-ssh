import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { extract as createTarExtract } from 'tar-stream'
import { registerSshApi } from '../lib/api.js'

test('streams a browser-local download through an independent endpoint session', async t => {
  let route
  let connectCount = 0
  let closeCount = 0
  registerSshApi({ register(value) { route = value; return () => {} } }, '/ssh-local/v1', {
    files: {
      async connect(endpointId) {
        connectCount += 1
        assert.equal(endpointId, 'sftp:host-test')
        return {
          endpoint: { id: endpointId },
          async stat(path) { return { name: '报告 1.txt', path, kind: 'file', size: 5, modifiedAt: 1 } },
          async download(path, destination) { assert.equal(path, '/remote/报告 1.txt'); destination.end('hello') },
          close() { closeCount += 1 },
        }
      },
    },
  })
  const server = createServer((request, response) => { void route.handler(request, response) })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  t.after(() => new Promise(resolve => server.close(resolve)))
  const address = server.address()
  assert(address && typeof address !== 'string')

  const response = await fetch(`http://127.0.0.1:${address.port}/ssh-local/v1/file-transfer/download?endpointId=sftp%3Ahost-test&path=%2Fremote%2F%E6%8A%A5%E5%91%8A%201.txt`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/octet-stream')
  assert.equal(response.headers.get('content-length'), '5')
  assert.match(response.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''/)
  assert.equal(await response.text(), 'hello')
  assert.equal(connectCount, 1)
  assert.equal(closeCount, 1)
})

test('streams a directory as a tar archive and closes the endpoint session', async t => {
  let route
  let closeCount = 0
  registerSshApi({ register(value) { route = value; return () => {} } }, '/ssh-local/v1', {
    files: {
      async connect(endpointId) {
        return {
          endpoint: { id: endpointId },
          async stat(path) { return remoteEntry(path) },
          async list(path) {
            const children = path === '/remote/folder'
              ? ['/remote/folder/notes.txt', '/remote/folder/nested']
              : path === '/remote/folder/nested' ? ['/remote/folder/nested/deep.txt'] : []
            return { path, parent: '/', entries: children.map(remoteEntry) }
          },
          async download(path, destination) { destination.end(path.endsWith('notes.txt') ? 'notes' : 'deep') },
          close() { closeCount += 1 },
        }
      },
    },
  })
  const server = createServer((request, response) => { void route.handler(request, response) })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  t.after(() => new Promise(resolve => server.close(resolve)))
  const address = server.address()
  assert(address && typeof address !== 'string')

  const response = await fetch(`http://127.0.0.1:${address.port}/ssh-local/v1/file-transfer/download?endpointId=sftp%3Ahost-test&path=%2Fremote%2Ffolder`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/x-tar')
  assert.match(response.headers.get('content-disposition'), /folder\.tar/)
  const archive = await readTar(Buffer.from(await response.arrayBuffer()))
  assert.equal(archive.get('folder/notes.txt').toString(), 'notes')
  assert.equal(archive.get('folder/nested/deep.txt').toString(), 'deep')
  assert(archive.has('folder/'))
  assert(archive.has('folder/nested/'))
  assert.equal(closeCount, 1)
})

for (const kind of ['symlink', 'other']) for (const directory of [false, true]) {
  test(`FTP ${kind} resolves on explicit download: directory=${directory}`, async t => {
    let route
    let closed = 0
    const downloaded = []
    registerSshApi({ register(value) { route = value; return () => {} } }, '/ssh-local/v1', {
      files: { async connect() { return {
        endpoint: { kind: 'ftp' },
        async stat(path) { return { name: 'alias', path, kind, navigable: directory, size: 1 } },
        async list(path) { return { entries: [
          { name: 'file.txt', path: `${path}/file.txt`, kind: 'file', size: 5 },
          { name: 'loop', path: `${path}/loop`, kind: 'symlink', navigable: true, size: 0 },
        ] } },
        async download(path, target) { downloaded.push(path); target.write('hel'); target.end('lo') },
        close() { closed++ },
      } } },
    })
    const server = createServer((req, res) => { void route.handler(req, res) })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise(resolve => server.close(resolve)))
    const response = await fetch(`http://127.0.0.1:${server.address().port}/ssh-local/v1/file-transfer/download?endpointId=ftp:test&path=/alias`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-length'), null)
    if (directory) {
      const archive = await readTar(Buffer.from(await response.arrayBuffer()))
      assert.equal(archive.get('alias/file.txt').toString(), 'hello')
      assert.equal(archive.has('alias/loop/'), false)
    } else assert.equal(await response.text(), 'hello')
    assert.deepEqual(downloaded, [directory ? '/alias/file.txt' : '/alias'])
    assert.equal(closed, 1)
  })
}

function remoteEntry(path) {
  const directory = path === '/remote/folder' || path === '/remote/folder/nested'
  return { name: path.split('/').at(-1), path, kind: directory ? 'directory' : 'file', size: directory ? 0 : path.endsWith('notes.txt') ? 5 : 4, modifiedAt: 1 }
}

async function readTar(buffer) {
  const files = new Map()
  const extract = createTarExtract()
  const completed = new Promise((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      const chunks = []
      stream.on('data', chunk => chunks.push(Buffer.from(chunk)))
      stream.on('end', () => { files.set(header.name, Buffer.concat(chunks)); next() })
      stream.on('error', reject)
      stream.resume()
    })
    extract.on('finish', resolve)
    extract.on('error', reject)
  })
  extract.end(buffer)
  await completed
  return files
}
