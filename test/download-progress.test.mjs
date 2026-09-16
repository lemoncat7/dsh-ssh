import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import test from 'node:test'
import { DownloadProgressStore } from '../lib/download-progress.js'

test('download progress counts streamed bytes and completes only after response finishes', async t => {
  const store = new DownloadProgressStore()
  const id = 'a'.repeat(32)
  let intermediate
  const server = createServer((_req, res) => {
    const job = store.track(id, res)
    res.setHeader('Content-Length', '6')
    res.write(Buffer.from('abc'))
    intermediate = structuredClone(store.get(id))
    setTimeout(() => { res.end('def'); job.complete() }, 25)
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const response = await fetch(`http://127.0.0.1:${server.address().port}`)
  assert.equal(await response.text(), 'abcdef')
  assert.deepEqual(intermediate, { state: 'transferring', transferredBytes: 3, totalBytes: 6 })
  assert.deepEqual(store.get(id), { state: 'completed', transferredBytes: 6, totalBytes: 6 })
})

test('unknown lengths, empty downloads and HTTP failures are not fabricated as 100 percent', async t => {
  const store = new DownloadProgressStore()
  let counter = 0
  const server = createServer((_req, res) => {
    const id = String(++counter).repeat(32)
    const job = store.track(id, res)
    if (counter === 1) { res.write('hello'); res.end(' world') }
    if (counter === 2) { res.setHeader('Content-Length', '0'); res.end() }
    if (counter === 3) { job.fail(new Error('remote unavailable')); res.statusCode = 500; res.end('{}') }
    job.complete()
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  for(let i=0;i<3;i++)await (await fetch(`http://127.0.0.1:${server.address().port}`)).text()
  assert.deepEqual(store.get('1'.repeat(32)), {state:'completed',transferredBytes:11})
  assert.deepEqual(store.get('2'.repeat(32)), {state:'completed',transferredBytes:0,totalBytes:0})
  assert.equal(store.get('3'.repeat(32)).state,'failed')
  assert.equal(store.get('3'.repeat(32)).error,'remote unavailable')
})

test('download progress rejects reused and malformed identifiers', () => {
  const store = new DownloadProgressStore()
  const response = {write(){},end(){},once(){},getHeader(){}}
  assert.throws(()=>store.track('invalid',response),/invalid/)
  store.track('a'.repeat(32),response)
  assert.throws(()=>store.track('a'.repeat(32),response),/already exists/)
})

test('disconnects remain failed and cannot be overwritten by completion', async t => {
  const store=new DownloadProgressStore()
  const id='c'.repeat(32)
  const server=createServer((_req,res)=>{
    const progress=store.track(id,res)
    res.write('partial')
    res.once('close',()=>progress.complete())
    setTimeout(()=>res.destroy(),20)
  })
  server.listen(0,'127.0.0.1');await once(server,'listening')
  t.after(()=>{server.closeAllConnections();server.close()})
  await assert.rejects(async()=>{const response=await fetch(`http://127.0.0.1:${server.address().port}`);await response.text()})
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(store.get(id).state,'failed')
})
