import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {SshStore} from '../lib/store.js'
import {SshCredentialVault} from '../lib/credentials.js'
import {registerSshTools} from '../lib/tools.js'
import {Context} from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import {dispatchTool} from './runtime-022.mjs'

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'ssh-profile-tools-'))
 const store=await SshStore.open(join(root,'state.json'),{allowPublicBind:false,defaultCommandTimeoutMs:30000,maxOutputChars:32000})
 const records=new Map()
 const provider={readRecord:async key=>records.get(key),describeRecord:async key=>({configured:records.has(key),writable:true}),
  modifyRecord:async(key,update)=>{records.set(key,await update(records.get(key)))},deleteRecord:async key=>{records.delete(key)}}
 const vault=new SshCredentialVault(provider),registered=new Map()
 const ctx={provide:()=>()=>{},agents:{list:()=>[]},on:()=>()=>{},tools:{register:tool=>{registered.set(tool.name,tool);return()=>registered.delete(tool.name)}}}
 const connector={connect:async()=>assert.fail('saving must not connect')}
 const dispose=registerSshTools(ctx,store,connector,{},{},{endpoint:()=>undefined},{},vault)
 t.after(async()=>{dispose();await rm(root,{recursive:true,force:true})})
 const exec={agent:{session:{id:'owner',header:{cwd:root}}},signal:new AbortController().signal}
 const entry=registered.get('ssh')
 const call=(tool,args,execution=exec)=>entry.execute({action:'call',tool,arguments:args},execution)
 return {store,vault,records,registered,entry,call,exec,root}
}
const ssh=(host='ssh.example.test',authType='password')=>({name:'测试主机',host,username:'test',authType,group:'开发组',tags:['AI新增']})
const ftp=(protocol='ftp')=>({name:'测试文件连接',host:'files.example.test',protocol,username:'ftp-user',initialPath:'/uploads'})

test('unmounted sessions discover both creation operations through the single ssh entry without gaining access',async t=>{
 const f=await fixture(t)
 assert.deepEqual([...f.registered.keys()],['ssh'])
 const list=JSON.parse(await f.entry.execute({action:'list'},f.exec)).operations.map(x=>x.name)
 assert.ok(list.includes('ssh_profile_create'));assert.ok(list.includes('ftp_profile_create'));assert.ok(!list.includes('ssh_exec'))
 const schema=JSON.parse(await f.entry.execute({action:'describe',tool:'ssh_profile_create'},f.exec))
 assert.ok(schema.parameters.required.includes('profile'))
 assert.ok(schema.parameters.properties.profile.required.includes('host'))
 const created=JSON.parse(await f.call('ssh_profile_create',{profile:ssh(),secrets:{password:'saved-secret'}}))
 assert.equal(created.created,true);assert.equal(created.mounted,false);assert.equal(created.connected,false)
 assert.equal(created.endpointId,'sftp:'+created.profile.id)
 assert.equal(f.store.injection('owner'),undefined)
 await assert.rejects(f.call('ssh_exec',{profileId:created.profile.id,command:'true'}),/permission mode/)
 await assert.rejects(f.call('file_directory_list',{endpointId:created.endpointId,path:'/'}),/permission mode/)
})

test('SSH creation persists group and connection settings while storing passwords and keys only in the vault',async t=>{
 const f=await fixture(t)
 const samples=[['password',{password:'password-DO-NOT-ECHO'}],['private-key',{privateKey:'PEM-DO-NOT-ECHO',passphrase:'phrase-DO-NOT-ECHO'}],['agent',{}]]
 for(const [authType,secrets] of samples){
  const output=await f.call('ssh_profile_create',{profile:{...ssh(authType+'.example.test',authType),port:2222},secrets})
  const result=JSON.parse(output),saved=f.store.profile(result.profile.id)
  assert.equal(saved.port,2222);assert.equal(saved.group,'开发组');assert.deepEqual(saved.tags,['AI新增'])
  assert.deepEqual(await f.vault.read(saved.id),secrets)
  for(const secret of Object.values(secrets)){assert.ok(!output.includes(secret));assert.ok(!(await readFile(join(f.root,'state.json'),'utf8')).includes(secret))}
 }
 const reopened=await SshStore.open(join(f.root,'state.json'),f.store.settings())
 assert.equal(reopened.profiles().length,3)
 assert.equal(reopened.injection('owner'),undefined)
})

test('FTP, explicit and implicit FTPS use their default ports and support password and anonymous authentication',async t=>{
 const f=await fixture(t)
 for(const [protocol,port] of [['ftp',21],['ftps-explicit',21],['ftps-implicit',990]]){
  const output=await f.call('ftp_profile_create',{profile:ftp(protocol),secrets:{password:'ftp-DO-NOT-ECHO'}})
  const result=JSON.parse(output),saved=f.store.ftpProfile(result.profile.id)
  assert.equal(saved.port,port);assert.equal(saved.initialPath,'/uploads')
  assert.equal(result.endpointId,'ftp:'+saved.id)
  assert.deepEqual(await f.vault.readFtp(saved.id),{password:'ftp-DO-NOT-ECHO'})
  assert.ok(!output.includes('ftp-DO-NOT-ECHO'))
 }
 const before=f.records.size
 const {username,...anonymousDraft}=ftp()
 const anonymous=JSON.parse(await f.call('ftp_profile_create',{profile:{...anonymousDraft,authMode:'anonymous'}}))
 assert.equal(anonymous.profile.username,'anonymous');assert.equal(f.records.size,before)
 assert.equal(f.store.injection('owner'),undefined)
 assert.ok(!(await readFile(join(f.root,'state.json'),'utf8')).includes('ftp-DO-NOT-ECHO'))
})

test('bad schemas, missing credentials, foreign credential types, absent ownership and cancellation do not save profiles',async t=>{
 const f=await fixture(t)
 for(const args of [{profile:{...ssh(),port:0},secrets:{password:'x'}},{profile:ssh()},{profile:{...ssh(),authType:'invalid'}},{profile:{...ssh(),credentialId:'unknown'}},{profile:{...ssh(),extra:'invalid'},secrets:{password:'x'}}]){
  await assert.rejects(f.call('ssh_profile_create',args))
 }
 await assert.rejects(f.call('ftp_profile_create',{profile:ftp()}),/password/)
 await assert.rejects(f.call('ftp_profile_create',{profile:{...ftp(),protocol:'sftp'}}))
 await assert.rejects(f.call('ssh_profile_create',{profile:ssh(),secrets:{password:'x'}},{...f.exec,agent:undefined}),/owning DSH session/)
 await assert.rejects(f.call('ssh_profile_create',{profile:ssh(),secrets:{password:'x'}},{...f.exec,signal:AbortSignal.abort()}))
 assert.equal(f.store.profiles().length,0);assert.equal(f.store.ftpProfiles().length,0);assert.equal(f.records.size,0)
})

test('concurrent duplicate SSH creation commits once and removes the losing credential record',async t=>{
 const f=await fixture(t)
 const results=await Promise.allSettled([f.call('ssh_profile_create',{profile:ssh(),secrets:{password:'first'}}),f.call('ssh_profile_create',{profile:{...ssh(),'name':'第二个名字'},secrets:{password:'second'}})])
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
 assert.equal(f.store.profiles().length,1);assert.equal(f.records.size,1)
 const rejected=results.find(r=>r.status==='rejected').reason
 assert.equal(rejected.code,'DUPLICATE_PROFILE_ENDPOINT')
 assert.doesNotMatch(rejected.message,/测试主机|第二个名字|first|second/)
})

test('failed configuration persistence rolls back newly saved SSH and FTP secrets',async t=>{
 const f=await fixture(t)
 f.store.update=async()=>{throw Error('save failed')}
 await assert.rejects(f.call('ssh_profile_create',{profile:ssh(),secrets:{password:'rollback-secret'}}),/save failed/)
 await assert.rejects(f.call('ftp_profile_create',{profile:ftp(),secrets:{password:'rollback-secret'}}),/save failed/)
 assert.equal(f.records.size,0);assert.equal(f.store.profiles().length,0);assert.equal(f.store.ftpProfiles().length,0)
})

test('existing credential references stay in the vault and do not copy their secret into a new profile',async t=>{
 const f=await fixture(t),now=Date.now()
 await f.store.update(s=>s.credentialEntries.push({id:'saved',name:'用户给定凭据',username:'test',authType:'password',createdAt:now,updatedAt:now}))
 await f.vault.replaceEntry('saved',{password:'existing-DO-NOT-ECHO'})
 const before=f.records.size
 for(const [tool,profile] of [['ssh_profile_create',{...ssh(),credentialId:'saved'}],['ftp_profile_create',{...ftp(),credentialId:'saved'}]]){
  const text=await f.call(tool,{profile}),result=JSON.parse(text)
  assert.equal(result.profile.credentialId,'saved');assert.ok(!text.includes('existing-DO-NOT-ECHO'))
 }
 assert.equal(f.records.size,before)
})

test('the native tool runtime dispatches connection creation through ssh and validates the nested operation schema',async t=>{
 const f=await fixture(t),ctx=new Context()
 const prompt=ctx.plugin(SystemPrompt);await prompt
 const runtime=ctx.plugin(ToolRuntime);await runtime
 t.after(async()=>{await runtime.dispose();await prompt.dispose()})
 const unregister=ctx.tools.register(f.entry);t.after(unregister)
 const created=await dispatchTool(ctx.tools,{...f.exec,callId:'create-host',name:'ssh',arguments:{action:'call',tool:'ssh_profile_create',arguments:{profile:ssh('native.example.test','agent')}}})
 assert.equal(created.isError,false,JSON.stringify(created.content))
 assert.equal(f.store.profiles().length,1)
 const bad=await dispatchTool(ctx.tools,{...f.exec,callId:'bad-profile',name:'ssh',arguments:{action:'call',tool:'ftp_profile_create',arguments:{profile:{name:'missing host'}}}})
 assert.equal(bad.isError,true)
 assert.equal(f.store.ftpProfiles().length,0)
})
