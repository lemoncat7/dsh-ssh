import assert from 'node:assert/strict'
import test from 'node:test'
import { browserTransfers, canCancelBrowserTransfer, cancelBrowserTransfer, dismissBrowserTransfer } from '../lib/browser-transfers.js'
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

for (const state of ['transferring', 'waiting']) {
  test(`an upload can be cancelled while ${state}; late XHR events cannot restore it`, async t => {
    let xhr, aborts = 0
    t.after(() => { delete globalThis.XMLHttpRequest })
    globalThis.XMLHttpRequest = class {
      upload = {}
      open() { xhr = this }
      setRequestHeader() {}
      send() {}
      abort() { aborts++; this.onabort() }
    }
    const promise = uploadFileEndpointFile('sftp:test', '/home', new File(['hello'], 'cancel.bin'))
    const rejected = assert.rejects(promise, { name: 'AbortError' })
    if (state === 'waiting') xhr.upload.onload()
    const job = browserTransfers.getSnapshot()[0]
    assert.equal(job.state, state)
    assert.equal(canCancelBrowserTransfer(job), true)
    cancelBrowserTransfer(job.id)
    await rejected
    assert.equal(aborts, 1)
    assert.equal(browserTransfers.getSnapshot().find(x => x.id === job.id).state, 'cancelled')
    xhr.upload.onprogress({ loaded: 5 }); xhr.upload.onload()
    xhr.status = 201; xhr.responseText = '{"path":"/home/cancel.bin","name":"cancel.bin","size":5}'; xhr.onload()
    assert.equal(browserTransfers.getSnapshot().find(x => x.id === job.id).state, 'cancelled')
    dismissBrowserTransfer(job.id)
    xhr.upload.onload()
    assert.ok(!browserTransfers.getSnapshot().some(x => x.id === job.id))
  })
}

test('a browser setup error fails the queued upload', async t => {
  t.after(() => { delete globalThis.XMLHttpRequest })
  globalThis.XMLHttpRequest = class { open() { throw new Error('failed to open') } }
  await assert.rejects(uploadFileEndpointFile('sftp:test', '/home', new File([], 'test')), /failed to open/)
  assert.equal(browserTransfers.getSnapshot()[0].state, 'failed')
})
