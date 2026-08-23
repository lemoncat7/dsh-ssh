import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { Readable, Writable } from 'node:stream'
import test from 'node:test'
import { registerSshApi } from '../lib/api.js'
import { uploadSftpFile } from '../lib/sftp.js'

test('streams SFTP uploads, protects existing files, and enforces the byte limit', async () => {
  const files = new Map()
  const connector = fakeConnector(files)

  const created = await uploadSftpFile(connector, 'host-test', '/remote', 'notes.txt', Readable.from(['hello', ' world']), { overwrite: false, maxBytes: 1024 })
  assert.deepEqual(created, { path: '/remote/notes.txt', name: 'notes.txt', size: 11 })
  assert.equal(files.get('/remote/notes.txt').toString('utf8'), 'hello world')

  await assert.rejects(
    uploadSftpFile(connector, 'host-test', '/remote', 'notes.txt', Readable.from(['blocked']), { overwrite: false, maxBytes: 1024 }),
    error => error.status === 409,
  )

  await uploadSftpFile(connector, 'host-test', '/remote', 'notes.txt', Readable.from(['replaced']), { overwrite: true, maxBytes: 1024 })
  assert.equal(files.get('/remote/notes.txt').toString('utf8'), 'replaced')

  await assert.rejects(
    uploadSftpFile(connector, 'host-test', '/remote', 'large.bin', Readable.from([Buffer.alloc(8)]), { overwrite: false, maxBytes: 4 }),
    error => error.status === 413,
  )
})

test('registers managed SFTP routes under SSH profiles', async t => {
  const connector = fakeConnector(new Map())
  let route
  registerSshApi({ register(value) { route = value; return () => {} } }, '/ssh-local/v1', {
    store: { profile(id) { return id === 'host-test' ? { id } : undefined } },
    connector,
  })
  const server = createServer((request, response) => { void route.handler(request, response) })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  t.after(() => new Promise(resolve => server.close(resolve)))
  const address = server.address()
  assert(address && typeof address !== 'string')

  const response = await fetch(`http://127.0.0.1:${address.port}/ssh-local/v1/profiles/host-test/sftp/directory?path=%2Fremote`, { headers: { Connection: 'close' } })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { path: '/remote', parent: '/', entries: [] })
})

function fakeConnector(files) {
  return {
    async connect() {
      const sftp = {
        realpath(value, callback) { callback(null, value === '.' ? '/home/tester' : value) },
        stat(value, callback) {
          if (value === '/remote' || value === '/home/tester') return callback(null, { mode: 0o040755, size: 0 })
          const file = files.get(value)
          if (file !== undefined) return callback(null, { mode: 0o100600, size: file.length })
          callback(Object.assign(new Error('not found'), { code: 2 }))
        },
        readdir(_value, callback) { callback(null, []) },
        createWriteStream(value) {
          const chunks = []
          return new Writable({
            write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback() },
            final(callback) { files.set(value, Buffer.concat(chunks)); callback() },
          })
        },
        end() {},
      }
      return { client: { sftp(callback) { callback(null, sftp) } }, close() {} }
    },
  }
}
