import assert from 'node:assert/strict'
import { buffer } from 'node:stream/consumers'
import test from 'node:test'
import { readSftpDownload } from '../lib/sftp-download-reader.js'
import { nextTransferTabName, normalizeTransferTabNames } from '../lib/file-transfer-tab-names.js'

test('parallel SFTP reads keep byte order, retry partial reads and close the handle', async () => {
  const data = Buffer.from(Array.from({ length: 117013 }, (_, index) => index % 251))
  let active = 0
  let peak = 0
  let closed = 0
  const sftp = {
    open(_path, _mode, done) { done(null, Buffer.from('file')) },
    close(_handle, done) { closed++; done() },
    read(_handle, target, offset, length, position, done) {
      peak = Math.max(peak, ++active)
      setTimeout(() => {
        const bytes = Math.min(length, 12000, data.length - position)
        const copied = data.copy(target, offset, position, position + bytes)
        active--
        done(null, copied)
      }, position === 0 ? 8 : 0)
    },
  }
  assert.deepEqual(await buffer(readSftpDownload(sftp, '/test', data.length, 4)), data)
  assert.equal(peak, 4)
  assert.equal(closed, 1)

  await assert.rejects(buffer(readSftpDownload(sftp, '/test', data.length + 10, 4)), /incomplete/)
  assert.equal(closed, 2)
})

test('transfer tab numbers fill gaps and older duplicates preserve the first label and each tab identity', () => {
  assert.equal(nextTransferTabName(new Set(['任务 1', '任务 3'])), '任务 2')
  assert.equal(nextTransferTabName(new Set(['任务 2', '任务 3'])), '任务 1')
  const tabs = [{id:'a',name:'任务 2'}, {id:'b',name:'任务 2'}, {id:'c',name:'任务 3'}]
  assert.deepEqual(normalizeTransferTabNames(tabs), [tabs[0], {id:'b',name:'任务 1'}, tabs[2]])
})
