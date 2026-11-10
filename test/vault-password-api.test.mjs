import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { registerSshApi } from '../lib/api.js'

test('saved password requires explicit same-origin POST and never appears in vault metadata', async t => {
  const entries=[{id:'password',name:'Test',username:'operator',authType:'password'},{id:'key',name:'Key',username:'operator',authType:'private-key'},{id:'missing',name:'Missing',authType:'password'}]
  let route,reads=0
  registerSshApi({register(value){route=value;return()=>{}}},'/ssh-local/v1',{
    store:{credentialEntry:id=>entries.find(e=>e.id===id),credentialEntries:()=>entries,profiles:()=>[],ftpProfiles:()=>[]},
    credentials:{describeEntry:async()=>({configured:true,fields:['password'],writable:true}),readEntry:async id=>{reads++;return id==='missing'?{}:{password:'test-password-only',privateKey:'do-not-return',passphrase:'do-not-return'}}},
  })
  const server=createServer((req,res)=>void route.handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)))
  const base=`http://127.0.0.1:${server.address().port}/ssh-local/v1/vault`
  const call=(id='password',headers={'X-DSH-SSH-Request':'1'},method='POST')=>fetch(base+'/'+id+'/password',{method,headers})
  const listed=await (await fetch(base)).json();assert.equal(JSON.stringify(listed).includes('test-password-only'),false);assert.equal(reads,0)
  assert.equal((await call('password',{},'GET')).status,404)
  assert.equal((await call('password',{})).status,403)
  assert.equal((await call('password',{'X-DSH-SSH-Request':'1',Origin:'https://untrusted.example'})).status,403)
  assert.equal((await call('unknown')).status,404)
  assert.equal((await call('key')).status,400);assert.equal(reads,0)
  const result=await call();assert.equal(result.status,200);assert.equal(result.headers.get('Cache-Control'),'no-store');assert.deepEqual(await result.json(),{password:'test-password-only'});assert.equal(reads,1)
  assert.equal((await call('missing')).status,404)
})
