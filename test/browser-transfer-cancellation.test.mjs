import test from 'node:test'
import assert from 'node:assert/strict'
import { browserTransfers, trackDownloadClick, cancelBrowserTransfer, canCancelBrowserTransfer, dismissBrowserTransfer } from '../lib/browser-transfers.js'
import { saveClientDownload } from '../lib/client-download.js'

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const tick = () => new Promise(resolve => setImmediate(resolve))
const response = () => new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'Content-Disposition': 'attachment; filename=test.bin', 'Content-Length': '4' } })
async function bounded(promise) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('browser cancellation is stuck')), 1000) })]) }
  finally { clearTimeout(timer) }
}
async function waitJob(id, state) {
  for (let i = 0; i < 100; i++) {
    const job = browserTransfers.getSnapshot().find(x => x.id === id)
    if (job?.state === state) return job
    await tick()
  }
  assert.fail('missing browser transfer state ' + state)
}
function browser(t, picker) {
  const oldWindow = globalThis.window, oldLocation = globalThis.location
  globalThis.window = { isSecureContext: true, showSaveFilePicker: picker }
  globalThis.location = { origin: 'https://test.example', href: 'https://test.example/' }
  t.after(() => {
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow
    if (oldLocation === undefined) delete globalThis.location; else globalThis.location = oldLocation
  })
  let prevented = false
  return {
    event: { button: 0, currentTarget: { href: 'https://test.example/ssh-local/v1/file-transfer/download?path=/test.bin', download: 'test.bin' }, stopPropagation() {}, preventDefault() { prevented = true } },
    prevented: () => prevented,
  }
}

test('cancelling a download waiting for the picker ends promptly and never starts a late download', async t => {
  const picker = deferred(), b = browser(t, () => picker.promise)
  const fetch = t.mock.method(globalThis, 'fetch', async () => { assert.fail('cancelled picker must never download') })
  trackDownloadClick(b.event)
  const job = browserTransfers.getSnapshot()[0]
  assert.equal(canCancelBrowserTransfer(job), true)
  cancelBrowserTransfer(job.id)
  await waitJob(job.id, 'cancelled')
  assert.equal(canCancelBrowserTransfer(browserTransfers.getSnapshot().find(x => x.id === job.id)), false)
  picker.resolve({ name: 'test.bin', createWritable: async () => assert.fail('cancelled picker must not open a writer') })
  await tick()
  assert.equal(fetch.mock.callCount(), 0)
  dismissBrowserTransfer(job.id)
  assert.ok(!browserTransfers.getSnapshot().some(x => x.id === job.id))
})

test('a writer opened after cancellation is aborted and cannot be committed', async t => {
  const opened = deferred(), controller = new AbortController(), updates = []
  let requested = false, aborted = 0
  t.mock.method(globalThis, 'fetch', async () => response())
  const run = saveClientDownload('/download', Promise.resolve({ name: 'test.bin', createWritable() { requested = true; return opened.promise } }), controller.signal, u => updates.push(u))
  await tick(); assert.equal(requested, true)
  controller.abort(); await bounded(run)
  assert.equal(updates.at(-1).state, 'cancelled')
  opened.resolve({ abort: async () => { aborted++ }, close: async () => assert.fail('must not close'), write: async () => assert.fail('must not write') })
  await tick(); assert.equal(aborted, 1)
})

test('a stalled local write can be aborted without waiting for that write to finish', async t => {
  const write = deferred(), controller = new AbortController(), updates = []
  let writing = false, aborted = 0, closed = 0
  t.mock.method(globalThis, 'fetch', async () => response())
  const run = saveClientDownload('/download', Promise.resolve({ name: 'test.bin', createWritable: async () => ({ write: async () => { writing = true; await write.promise }, abort: async () => { aborted++ }, close: async () => { closed++ } }) }), controller.signal, u => updates.push(u))
  await tick(); assert.equal(writing, true)
  controller.abort(); await bounded(run)
  assert.equal(updates.at(-1).state, 'cancelled'); assert.equal(aborted, 1); assert.equal(closed, 0)
  write.resolve(); await tick()
  assert.equal(updates.at(-1).state, 'cancelled')
})

test('a stalled response read is cancelled and its partial file is aborted', async t => {
  let sourceCancelled = 0, fileAborted = 0
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ cancel() { sourceCancelled++ } }), { headers: { 'Content-Disposition': 'attachment' } }))
  const controller = new AbortController(), updates = []
  const run = saveClientDownload('/download', Promise.resolve({ name: 'test.bin', createWritable: async () => ({ write: async () => {}, abort: async () => { fileAborted++ }, close: async () => assert.fail('must not commit') }) }), controller.signal, u => updates.push(u))
  await tick(); controller.abort(); await bounded(run)
  assert.equal(updates.at(-1).state, 'cancelled'); assert.equal(fileAborted, 1); assert.equal(sourceCancelled, 1)
})

test('the atomic save phase keeps a stable status and completes instead of falsely reporting cancellation', async t => {
  const close = deferred(), b = browser(t, async () => ({ name: 'test.bin', createWritable: async () => ({ write: async () => {}, close: async () => close.promise, abort: async () => assert.fail('commit already began') }) }))
  t.mock.method(globalThis, 'fetch', async () => response())
  trackDownloadClick(b.event)
  const job = browserTransfers.getSnapshot()[0]
  const saving = await waitJob(job.id, 'saving')
  assert.equal(canCancelBrowserTransfer(saving), false)
  cancelBrowserTransfer(job.id)
  assert.equal(browserTransfers.getSnapshot().find(x => x.id === job.id).state, 'saving')
  close.resolve(); await waitJob(job.id, 'completed')
  dismissBrowserTransfer(job.id)
})

test('native browser downloads expose dismissible records without inventing cancellation control', t => {
  const b = browser(t, undefined)
  trackDownloadClick(b.event)
  const job = browserTransfers.getSnapshot()[0]
  assert.equal(job.state, 'unavailable'); assert.equal(b.prevented(), false); assert.equal(canCancelBrowserTransfer(job), false)
  dismissBrowserTransfer(job.id)
  assert.ok(!browserTransfers.getSnapshot().some(x => x.id === job.id))
})
