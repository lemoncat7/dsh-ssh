import test from 'node:test'
import assert from 'node:assert/strict'
import { TerminalTransport } from '../lib/terminal-transport.js'

function environment(t) {
  const originals = Object.fromEntries(['window', 'document', 'EventSource'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis,k)]))
  t.after(() => { for (const [key, value] of Object.entries(originals)) if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key] })
  globalThis.window = { setTimeout, location: { href: 'http://localhost/' } }
  globalThis.document = { hidden: false }
  const streams=[]
  globalThis.EventSource = class {
    constructor(url) { this.url=url;streams.push(this) }
    close() { this.closed=true }
    emit(data,cursor,extra={}) { this.onmessage?.({data:JSON.stringify({data,cursor,closed:false,truncated:false,...extra})}) }
  }
  return streams
}

test('hidden activity pauses SSE and resumes exact cursor without accepting stale events', t => {
  const streams=environment(t), outputs=[]
  const transport=new TerminalTransport({streamUrl:'/stream?cursor=0',read:async()=>{throw Error('unexpected polling')},send:async()=>{}})
  const observe=transport.observe({output:v=>outputs.push(v),error:e=>{throw e}})
  t.after(observe)
  streams[0].emit('one',3)
  observe.setVisible(false)
  assert.equal(streams[0].closed,true)
  streams[0].emit('late',7)
  observe.setVisible(true)
  assert.equal(new URL(streams[1].url).searchParams.get('cursor'),'3')
  streams[1].emit(' two',7)
  assert.deepEqual(outputs.map(x=>x.data),['one',' two'])
  observe.setVisible(true);assert.equal(streams.length,2)
  streams[1].emit('latest',50,{truncated:true,closed:true})
  assert.equal(outputs.at(-1).truncated,true)
  observe.setVisible(false);observe.setVisible(true)
  assert.equal(streams.length,2)
})

test('hidden initial panels are lazy; disposal prevents later resumption', t => {
  const streams=environment(t)
  const transport=new TerminalTransport({streamUrl:'/stream',read:async()=>{},send:async()=>{}})
  const observe=transport.observe({output(){},error(){}},false)
  assert.equal(streams.length,0)
  observe.setVisible(true);assert.equal(streams.length,1)
  observe();observe.setVisible(false);observe.setVisible(true)
  assert.equal(streams[0].closed,true);assert.equal(streams.length,1)
})

test('polling fallback ignores a read completed after suspension and resumes uncommitted cursor', async t => {
  environment(t);delete globalThis.EventSource
  const reads=[],outputs=[]
  const transport=new TerminalTransport({streamUrl:'/stream',read:cursor=>new Promise(resolve=>reads.push({cursor,resolve})),send:async()=>{}})
  const observe=transport.observe({output:v=>outputs.push(v),error:e=>{throw e}})
  t.after(observe)
  observe.setVisible(false)
  reads[0].resolve({data:'late',cursor:4,truncated:false,closed:false})
  await Promise.resolve()
  assert.equal(outputs.length,0)
  observe.setVisible(true);assert.equal(reads[1].cursor,0)
  reads[1].resolve({data:'all',cursor:8,truncated:false,closed:true})
  await Promise.resolve()
  assert.equal(outputs.length,1)
})
