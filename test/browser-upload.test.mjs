import assert from 'node:assert/strict'
import test from 'node:test'
import { browserTransfers } from '../lib/browser-transfers.js'
import { uploadFileEndpointFile } from '../lib/client-api.js'

test('upload leaves preparing before the first browser event and waits for a save receipt', async t => {
  let xhr
  t.after(() => { delete globalThis.XMLHttpRequest })
  globalThis.XMLHttpRequest = class {
    upload = {}
    open(method, url) { assert.equal(method, 'PUT'); assert.match(url, /concurrency=4/); xhr = this }
    setRequestHeader() {}
    send() {}
  }
  const current = () => browserTransfers.getSnapshot()[0]
  const transfer = uploadFileEndpointFile('sftp:test', '/home', new File(['hello'], 'test'))
  assert.equal(current().state, 'transferring')
  xhr.upload.onprogress({ loaded: 2 })
  assert.equal(current().transferredBytes, 2)
  xhr.upload.onload()
  assert.equal(current().state, 'waiting')
  xhr.status = 201
  xhr.responseText = '{"path":"/home/test","size":5,"name":"test"}'
  xhr.onload()
  await transfer
  assert.equal(current().state, 'completed')
})

test('a browser setup error fails the queued upload', async t => {
  t.after(() => { delete globalThis.XMLHttpRequest })
  globalThis.XMLHttpRequest = class { open() { throw new Error('failed to open') } }
  await assert.rejects(uploadFileEndpointFile('sftp:test', '/home', new File([], 'test')), /failed to open/)
  assert.equal(browserTransfers.getSnapshot()[0].state, 'failed')
})
