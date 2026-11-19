import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import test from 'node:test'
import { writeSftpUpload } from '../lib/sftp-upload-writer.js'

for (const concurrency of [1, 4, 16]) test(`SFTP writes disjoint ranges with concurrency ${concurrency}`, async () => {
  const original = randomBytes(1048583)
  const saved = Buffer.alloc(original.length)
  let active = 0, peak = 0, previous = 0, closed = false
  const channel = {
    open(_path, flags, _mode, callback) { assert.equal(flags, 'wx'); callback(null, Buffer.from('h')) },
    write(_handle, data, start, length, position, callback) {
      peak = Math.max(peak, ++active)
      setTimeout(() => { data.copy(saved, position, start, start + length); active--; callback() }, position % 3)
    },
    close(_handle, callback) { assert.equal(active, 0); closed = true; callback() },
  }
  await writeSftpUpload(channel, '/file', Readable.from([original]), true, {
    concurrency, onProgress(bytes) { assert.ok(bytes > previous); previous = bytes },
  })
  assert.equal(closed, true)
  assert.equal(peak, concurrency)
  assert.deepEqual(saved, original)
  assert.equal(previous, original.length)
})

test('a failed write rejects after draining outstanding writes and closing the handle', async () => {
  let closed = false
  const channel = {
    open(_path, _flags, _mode, cb) { cb(null, Buffer.alloc(1)) },
    write(_handle, _data, _start, _length, pos, cb) { setImmediate(cb, pos === 32768 ? new Error('disk full') : undefined) },
    close(_handle, cb) { closed = true; cb() },
  }
  await assert.rejects(writeSftpUpload(channel, '/file', Readable.from([Buffer.alloc(2 ** 20)]), true, { concurrency: 4 }), /disk full/)
  assert.equal(closed, true)
})
