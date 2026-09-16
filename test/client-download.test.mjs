import assert from 'node:assert/strict'
import test from 'node:test'
import { saveClientDownload } from '../lib/client-download.js'

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
const tick=()=>new Promise(r=>setImmediate(r))
const response=(headers={})=>new Response(new Uint8Array([1,2,3,4]),{headers:{'Content-Disposition':'attachment; filename=test.bin',...headers}})

test('download progress counts acknowledged writes and completion waits for close', async t=>{
  t.mock.method(globalThis,'fetch',async()=>response({'Content-Length':'4'}))
  const write=deferred(),close=deferred(),updates=[]
  let aborts=0
  const run=saveClientDownload('/download',Promise.resolve({name:'test.bin',createWritable:async()=>({write:async()=>write.promise,close:async()=>close.promise,abort:async()=>{aborts++}})}),new AbortController().signal,u=>updates.push(u))
  await tick()
  assert.equal(updates.at(-1).transferredBytes,0,'queued network bytes are not written bytes')
  write.resolve();await tick()
  assert.equal(updates.at(-1).state,'saving')
  assert.equal(updates.at(-1).transferredBytes,4)
  assert.ok(!updates.some(u=>u.state==='completed'))
  close.resolve();await run
  assert.equal(updates.at(-1).state,'completed')
  assert.equal(aborts,0)
})

test('HTTP errors, truncation and disk failures never complete and abort partial writes',async t=>{
  for(const scenario of ['http','short','write','close','html']){
    const updates=[];let aborts=0,opened=0
    t.mock.method(globalThis,'fetch',async()=>scenario==='http'?new Response('denied',{status:403}):scenario==='html'?new Response('login'):response({'Content-Length':scenario==='short'?'8':'4'}))
    await saveClientDownload('/download',Promise.resolve({name:'test',createWritable:async()=>{opened++;return {
      write:async()=>{if(scenario==='write')throw Error('disk full')},
      close:async()=>{if(scenario==='close')throw Error('save denied')},
      abort:async()=>{aborts++},
    }}}),new AbortController().signal,u=>updates.push(u))
    assert.equal(updates.at(-1).state,'failed',scenario)
    assert.ok(!updates.some(u=>u.state==='completed'))
    assert.equal(aborts,scenario==='http'||scenario==='html'?0:1)
    assert.equal(opened,scenario==='http'||scenario==='html'?0:1)
    t.mock.restoreAll()
  }
})

test('picker cancellation and abort before transfer cause no network request',async t=>{
  const fetch=t.mock.method(globalThis,'fetch',()=>{throw Error('must not fetch')})
  const updates=[]
  await saveClientDownload('/download',Promise.reject(new DOMException('cancelled','AbortError')),new AbortController().signal,u=>updates.push(u))
  assert.equal(updates.at(-1).state,'cancelled')
  const controller=new AbortController();controller.abort()
  await saveClientDownload('/download',Promise.resolve({name:'test'}),controller.signal,u=>updates.push(u))
  assert.equal(updates.at(-1).state,'cancelled')
  assert.equal(fetch.mock.callCount(),0)
})

test('unknown and compressed lengths never invent a total',async t=>{
  for(const headers of [{},{'Content-Length':'1','Content-Encoding':'gzip'}]){
    t.mock.method(globalThis,'fetch',async()=>response(headers))
    const updates=[]
    await saveClientDownload('/download',Promise.resolve({name:'test',createWritable:async()=>({write:async()=>{},close:async()=>{},abort:async()=>{}})}),new AbortController().signal,u=>updates.push(u))
    assert.equal(updates.at(-1).state,'completed')
    assert.equal(updates.at(-1).transferredBytes,4)
    assert.ok(updates.every(u=>u.totalBytes===undefined))
    t.mock.restoreAll()
  }
})

test('cancelling after a partial write aborts the destination instead of committing',async t=>{
  t.mock.method(globalThis,'fetch',async()=>response({'Content-Length':'4'}))
  const controller=new AbortController(),updates=[]
  let closed=false,aborted=false
  await saveClientDownload('/download',Promise.resolve({name:'test',createWritable:async()=>({
    write:async()=>controller.abort(),close:async()=>{closed=true},abort:async()=>{aborted=true},
  })}),controller.signal,u=>updates.push(u))
  assert.equal(updates.at(-1).state,'cancelled')
  assert.equal(closed,false)
  assert.equal(aborted,true)
})
