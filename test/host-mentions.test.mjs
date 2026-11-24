import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerSshApi } from '../lib/api.js'
import { searchHostMentions } from '../lib/host-mentions.js'
import { createHostMentionSource } from '../lib/host-mention-source.js'
const hosts = [
  { id:'one', name:'生产服务器',host:'192.168.1.20',port:22,username:'root',group:'生产',password:'never-return',credentialId:'private-vault-id' },
  { id:'two', name:'生产服务器',host:'10.1.2.3',port:2222,username:'deploy',group:'测试' },
  { id:'ipv6', name:'IPv6',host:'2001:db8::1',port:22,username:'user' },
]
const session={sessionId:'chat'},signal=()=>new AbortController().signal
const query=(q,abort=signal())=>({query:q,quoted:false,drilled:false,signal:abort})
test('saved host discovery searches names and IPs, bounds results and excludes credentials',()=>{
  assert.equal(searchHostMentions(hosts,'192.168')[0].id,'one')
  assert.equal(searchHostMentions(hosts,'生产 10.1')[0].id,'two')
  assert.equal(searchHostMentions(hosts,'IPV6')[0].id,'ipv6')
  assert.equal(searchHostMentions(Array.from({length:50},(_,i)=>({...hosts[0],id:String(i)})),'').length,20)
  const serialized=JSON.stringify(searchHostMentions(hosts,''));assert.equal(serialized.includes('never-return'),false);assert.equal(serialized.includes('private-vault-id'),false)
})
test('mention API is read-only, uses current address and never reads secrets or connects',async t=>{
  let route,reads=0;const profiles=structuredClone(hosts)
  const forbidden=new Proxy({}, {get(){throw Error('discovery must not access credentials or SSH')}})
  registerSshApi({register(r){route=r;return()=>{}}},'/ssh-local/v1',{store:{profiles:()=>profiles,profile:id=>{reads++;return profiles.find(h=>h.id===id)}},credentials:forbidden,connector:forbidden})
  const server=createServer((req,res)=>route.handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)))
  const base=`http://127.0.0.1:${server.address().port}/ssh-local/v1/host-mentions`
  const result=await fetch(base+'?q=生产');assert.equal(result.headers.get('cache-control'),'no-store');assert.equal((await result.json()).items.length,2)
  profiles[0].host='192.168.1.99';assert.match((await(await fetch(base+'/one')).json()).text,/192\.168\.1\.99/);assert.equal(reads,1)
  assert.equal((await fetch(base+'/gone')).status,404);assert.equal((await fetch(base+'?q='+'x'.repeat(256))).status,400)
  assert.equal((await fetch(base,{headers:{origin:'https://outside.invalid'}})).status,403)
})
test('native @ source distinguishes duplicate host names and resolves edited addresses at send time',async()=>{
  let address='192.168.1.20',opened,calls=[]
  const source=createHostMentionSource(id=>opened=id,async(path)=>{
    calls.push(path);return Response.json(path.includes('?')?{items:hosts}:{text:`SSH 主机 生产服务器：root@${address}:22；profileId=one`})
  })
  const candidates=await source.candidates(session,query('生产'));assert.notEqual(candidates[0].name,candidates[1].name);assert.match(candidates[1].description,/10\.1\.2\.3:2222/);assert.match(candidates[2].description,/\[2001:db8::1\]:22/)
  const pick=source.onPick({candidate:candidates[0],session,action:'pick'});assert.match(pick.insert.label,/192\.168/);assert.equal(pick.insert.ref.includes('never-return'),false);assert.equal(source.onPick({candidate:candidates[0],session:{sessionId:'other'},action:'pick'}),undefined)
  assert.equal(source.openReference(session,{ref:pick.insert.ref}),true);assert.equal(opened,'one')
  address='192.168.1.99';assert.match(await source.codec.serialize(pick.insert.ref,signal()),/192\.168\.1\.99/)
  assert.throws(()=>source.codec.clipboardText('{broken'),/引用|reference/);assert.equal(source.openReference(session,{ref:'{broken'}),false)
  assert.equal(calls.length,2)
})
test('superseded, quoted, drilled and oversized @ queries do not fetch',async()=>{
  let calls=0;const source=createHostMentionSource(()=>{},async()=>{calls++;return Response.json({items:[]})})
  const abort=new AbortController();const pending=source.candidates(session,query('prod',abort.signal));abort.abort();await assert.rejects(pending)
  assert.deepEqual(await source.candidates(session,{...query('x'),quoted:true}),[])
  assert.deepEqual(await source.candidates(session,{...query('x'),drilled:true}),[])
  assert.deepEqual(await source.candidates(session,query('x'.repeat(256))),[])
  assert.equal(calls,0)
})
