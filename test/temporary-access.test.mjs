import test from 'node:test'
import assert from 'node:assert/strict'
import { registerTemporaryAccess, resolveTemporaryHost } from '../lib/temporary-access.js'
import { currentHumanText, consentMatches, confirmsPending } from '../lib/temporary-consent.js'
import { TemporaryTaskAccess } from '../lib/temporary-task-access.js'

const host = { id: 'host-78', name: 'fnos', host: '192.168.28.78', username: 'user', port: 22 }
const message = (text, kind='user') => ({type:'user/message',data:{source:{kind},content:[{type:'text',text}]}})
const target = (overrides={}) => ({taskId:'task-1',companionId:'worker',companionName:'石火',title:'检查磁盘',scope:'v1',valid:()=>true,...overrides})
function fixture() {
  const handlers = new Map(), tools = new Map(), services = new Map(), controller = new AbortController()
  let events = [], profile = {...host}, connections=0, turn=1
  const agent = {session:{id:'session-a',snapshotEvents:()=>events}}
  const ctx = {
    on(name,handler){handlers.set(name,handler);return()=>handlers.delete(name)},
    provide(name,value){services.set(name,value);return()=>services.delete(name)},
    tools:{register(tool){tools.set(tool.name,tool);return()=>tools.delete(tool.name)}},
    get(name){if(name==='approval')throw Error('popup must not be requested');return services.get(name)},
  }
  const dispose=registerTemporaryAccess(ctx,{profiles:()=>[profile],profile:()=>profile,settings:()=>({defaultCommandTimeoutMs:1000,maxOutputChars:1000})},{async connect(){connections++;throw Error('connection reached')}})
  const exec={agent,signal:controller.signal,name:'ssh_request_temporary_access',callId:'call'}
  const start=async(text='请到 fnos 检查磁盘',kind='user')=>{events.push({type:'turn/start',data:{turn}},message(text,kind));await handlers.get('agent/pre-step')({agent,turn:turn++,signal:controller.signal},async()=>({}))}
  const request=async(patch={})=>JSON.parse(await tools.get('ssh_request_temporary_access').execute({target:'fnos',task:'检查磁盘',...patch},exec))
  const command=(owner=agent)=>tools.get('ssh_temporary_exec').execute({profileId:host.id,command:'pwd'},{...exec,agent:owner})
  const end=(kind='completed')=>handlers.get('session/event')(agent.session,{type:'turn/end',data:{turn:turn-1,reason:{kind}}})
  return {handlers,services,agent,controller,start,request,command,end,dispose,setProfile:p=>profile=p,connections:()=>connections,add:e=>events.push(e)}
}

test('explicit host lookup rejects ambiguous suffixes',()=>{
  for(const name of ['fnos','192.168.28.78','78'])assert.equal(resolveTemporaryHost([host],name),host)
  assert.throws(()=>resolveTemporaryHost([host,{...host,id:'other',host:'10.0.0.78'}],'78'),/不唯一/)
})
test('human consent avoids approval even when approval prompts are disabled',async()=>{
  const f=fixture();await f.start();assert.equal((await f.request()).granted,true)
  await assert.rejects(f.command(),/connection reached/)
  await assert.rejects(f.command({session:{id:'other'}}),/没有有效/)
  f.end();await f.start('继续');assert.equal((await f.request()).granted,false);await assert.rejects(f.command(),/没有有效/);f.dispose()
})
test('unclear consent returns exact scope; following human confirmation grants only that request',async()=>{
  const f=fixture();await f.start('检查一下');const ask=await f.request()
  assert.equal(ask.granted,false);assert.match(ask.scope,/user@192.168.28.78:22/)
  f.end();await f.start('确认临时访问');assert.equal((await f.request()).granted,true);f.dispose()
})
test('confirmation without pending request or with altered task cannot authorize access',async()=>{
  const f=fixture();await f.start('确认临时访问');assert.equal((await f.request()).granted,false)
  f.end();await f.start('确认临时访问');assert.equal((await f.request({task:'删除数据'})).granted,false);f.dispose()
})
test('host config changes invalidate pending confirmation',async()=>{
  const f=fixture();await f.start('检查一下');await f.request();f.end();f.setProfile({...host,host:'10.0.0.1'})
  await f.start('确认临时访问');assert.equal((await f.request()).granted,false);f.dispose()
})
test('plugin messages, quoted instructions and old human turns never grant access',async()=>{
  const f=fixture();await f.start();f.end();await f.start('请到 fnos 检查磁盘','plugin:@lemoncat7/dsh-partner')
  assert.equal((await f.request()).granted,false);f.dispose()
  assert.equal(currentHumanText([{type:'turn/start',data:{turn:1}},message('请到 fnos 检查磁盘'),{type:'turn/start',data:{turn:2}}],2),undefined)
  for(const text of ['不要去 fnos 检查磁盘','可以去 fnos 检查磁盘吗？','他说“去 fnos 检查磁盘”','如果需要可以到 fnos 安装','`请到 fnos 检查磁盘`','请到 fnos2 检查磁盘','请解释到 fnos 检查磁盘的风险','你不必到 fnos 检查磁盘','日志内容是请到 fnos 检查磁盘'])assert.equal(consentMatches(text,host),false,text)
  assert.equal(confirmsPending('不要确认临时访问'),false)
  assert.equal(consentMatches('请让石火到 fnos 检查磁盘',host,'石火'),true)
  assert.equal(consentMatches('请让别的伙伴到 fnos 检查磁盘',host,'石火'),false)
})
test('completion, stop, error, disposal and config changes revoke direct access',async()=>{
  for(const revoke of [f=>f.end(),f=>f.controller.abort(),f=>f.handlers.get('agent/error')({agent:f.agent}),f=>f.handlers.get('agent/disposed')({agent:f.agent}),f=>f.setProfile({...host,host:'10.0.0.1'})]){
    const f=fixture();await f.start();await f.request();revoke(f);await assert.rejects(f.command(),/没有有效/);assert.equal(f.connections(),0);f.dispose()
  }
})
test('delegation needs exact recipient consent and does not grant creator command access',async()=>{
  const f=fixture();f.services.set('dshPartnerSshTaskAccess',{resolve:()=>target()});await f.start()
  assert.equal((await f.request({taskId:'task-1'})).granted,false);f.end()
  await f.start('确认临时访问');assert.equal((await f.request({taskId:'task-1'})).granted,true)
  await assert.rejects(f.command(),/没有有效/)
  f.end();const bridge=f.services.get('dshSshTemporaryAccess'),lease=bridge.bind({taskId:'task-1',companionId:'worker',sessionId:'child'})
  assert.match(lease.prompt,/host-78/);assert.equal(bridge.grant,undefined)
  const child={session:{id:'child'}}
  await f.handlers.get('agent/pre-step')({agent:child,turn:1,signal:f.controller.signal},async()=>({}))
  await assert.rejects(f.command(child),/connection reached/)
  lease.dispose();await assert.rejects(f.command(child),/没有有效/);f.dispose()
})
test('changed assignee or task scope invalidates the short confirmation',async()=>{
  const f=fixture();let value=target();f.services.set('dshPartnerSshTaskAccess',{resolve:()=>value});await f.start('检查一下');await f.request({taskId:'task-1'});f.end()
  value=target({scope:'v2',companionName:'另一个伙伴'});await f.start('确认临时访问');assert.equal((await f.request({taskId:'task-1'})).granted,false);f.dispose()
})
test('task lease is single-execution, recipient-bound, expires and reacts to cancellation and host changes',()=>{
  let now=100,valid=true,profile={...host};const bridge=new TemporaryTaskAccess(()=>profile,()=>now)
  const grant=()=>bridge.grant(target({valid:()=>valid}),profile,'parent')
  grant();assert.equal(bridge.bind({taskId:'wrong',companionId:'worker',sessionId:'wrong'}).prompt,'')
  assert.equal(bridge.bind({taskId:'task-1',companionId:'other',sessionId:'wrong'}).prompt,'')
  const abort=new AbortController(),lease=bridge.bind({taskId:'task-1',companionId:'worker',sessionId:'child',signal:abort.signal})
  assert.equal(bridge.has('child',host),true);assert.equal(bridge.has('parent',host),false)
  const signal=bridge.signal('child',host)
  assert.equal(bridge.bind({taskId:'task-1',companionId:'worker',sessionId:'another'}).prompt,'')
  abort.abort();assert.equal(bridge.has('child',host),false);assert.equal(signal.aborted,true);lease.dispose()
  for(const revoke of [()=>{valid=false},()=>{now+=3600001},()=>{profile={...host,port:2222}},()=>bridge.revokeSession('parent',true),()=>bridge.revokeSession('child')]){
    valid=true;profile={...host};grant();bridge.bind({taskId:'task-1',companionId:'worker',sessionId:'child'});revoke();assert.equal(bridge.has('child',host),false)
  }
  bridge.clear()
})
