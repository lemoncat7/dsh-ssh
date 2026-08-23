import assert from 'node:assert/strict'
import { Readable, Writable } from 'node:stream'
import test from 'node:test'
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
