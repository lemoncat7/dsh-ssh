import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { normalizeSftpPathMappings, mapTerminalSftpPath, parseSftpPathMappings } from '../lib/sftp-path-mapping.js'
import { registerSshApi } from '../lib/api.js'
import { listSftpDirectory } from '../lib/sftp.js'

test('terminal aliases respect boundaries, longest prefix and native SFTP paths', () => {
  const mappings = parseSftpPathMappings('/home/moye/ => /home/\n/volume1/docker => /docker\n/home/moye/private => /private')
  assert.equal(mapTerminalSftpPath('/home/moye/Online Document/笔记', mappings), '/home/Online Document/笔记')
  assert.equal(mapTerminalSftpPath('/home/moye/private/a', mappings), '/private/a')
  assert.equal(mapTerminalSftpPath('/volume1/docker', mappings), '/docker')
  for (const path of ['/home/moye2', '/volume1/@docker', '/home/Online Document', '/home/moye/../other', '~']) assert.equal(mapTerminalSftpPath(path, mappings), path)
  assert.equal(mapTerminalSftpPath('/a/b', [{terminal:'/',sftp:'/root'}]), '/root/a/b')
  assert.equal(mapTerminalSftpPath('/root/a', [{terminal:'/root',sftp:'/'}]), '/a')
  assert.equal(mapTerminalSftpPath('/root', [{terminal:'/root',sftp:'/'}]), '/')
})
test('invalid aliases cannot be saved', () => {
  for (const value of [null, {}, Array(33).fill({terminal:'/a',sftp:'/b'}), [{terminal:'a',sftp:'/b'}], [{terminal:'/a/../b',sftp:'/b'}], [{terminal:'/a',sftp:'/b\n'}], [{terminal:'/a',sftp:'/b'}, {terminal:'/a/',sftp:'/c'}]]) assert.throws(() => normalizeSftpPathMappings(value), e => e.status === 400)
  assert.throws(() => parseSftpPathMappings('/a /b'), e => e.status === 400)
  assert.deepEqual(parseSftpPathMappings(''), [])
})
test('mapping update requires mutation header and preserves unrelated host and session settings', async t => {
  const state = {profiles:[{id:'nas',host:'nas',username:'moye',updatedAt:1},{id:'public',proxy:{type:'socks5',port:6623}}],injections:{session:{permission:'exec'}}}
  const original=structuredClone(state)
  let route
  registerSshApi({register(value){route=value;return()=>{}}},'/ssh-local/v1',{store:{profile:id=>state.profiles.find(p=>p.id===id),update:async change=>change(state)}})
  const server=createServer((req,res)=>void route.handler(req,res))
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)))
  const put=(mappings,header=true)=>fetch(`http://127.0.0.1:${server.address().port}/ssh-local/v1/profiles/nas/sftp/path-mappings`,{method:'PUT',headers:{'Content-Type':'application/json',...(header?{'X-DSH-SSH-Request':'1'}:{})},body:JSON.stringify({mappings})})
  const mappings=[{terminal:'/home/moye',sftp:'/home'}]
  assert.equal((await put(mappings,false)).status,403)
  assert.equal((await put([{terminal:'relative',sftp:'/home'}])).status,400)
  assert.deepEqual(state,original)
  assert.equal((await put(mappings)).status,200)
  assert.deepEqual(state.profiles[0].sftpPathMappings,mappings)
  const result=structuredClone(state);delete result.profiles[0].sftpPathMappings;result.profiles[0].updatedAt=1
  assert.deepEqual(result,original)
  assert.equal((await put([])).status,200)
  assert.deepEqual(state.profiles[0].sftpPathMappings,[])
})
test('missing readdir after successful realpath is a 404 and closes resources', async () => {
  let closed=0
  const channel={realpath(path,cb){cb(null,path)},readdir(path,cb){cb(Object.assign(new Error('No such file'),{code:2}))},end(){closed++}}
  const connector={async connect(){return {client:{sftp(cb){cb(null,channel)}},close(){closed++}}}}
  await assert.rejects(()=>listSftpDirectory(connector,'nas','/missing'),e=>e.status===404&&e.code==='ENOENT')
  assert.equal(closed,2)
})
