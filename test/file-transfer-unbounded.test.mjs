import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,open,stat,rm,readdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Readable} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {SessionFileUploads} from '../lib/session-file-upload.js'
import {SessionFileDownloads} from '../lib/session-file-download.js'

// Node's MockTimers does not reschedule Timeout.refresh(). Model the native
// Timeout API explicitly so inactivity can be checked without a five-minute wait.
function idleClock(t){
 let now=0
 const timers=new Map()
 t.mock.method(globalThis,'setTimeout',(callback,delay)=>{
  const timer={refresh(){timers.set(timer,{callback,at:now+delay});return timer},unref(){return timer}}
  timer.refresh();return timer
 })
 t.mock.method(globalThis,'clearTimeout',timer=>{timers.delete(timer)})
 return {tick(ms){now+=ms;for(const [timer,item] of [...timers])if(item.at<=now){timers.delete(timer);item.callback()}}}
}

test('AI uploads and downloads a file beyond the former 512 MiB boundary with bounded streaming buffers',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ssh-large-stream-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const size=513*1024*1024+139,local=join(root,'large.bin'),handle=await open(local,'w')
 try{await handle.truncate(size);await handle.write(Buffer.from([1,2,3]),0,3,size-3)}finally{await handle.close()}
 const entries=new Map(),chunk=Buffer.alloc(1024*1024,0x6d)
 let uploaded=0,tail
 const files={async connect(){return {
  close(){},
  async stat(path){return path==='/out'?{kind:'directory',path}:{kind:'file',path,name:'download.bin',size:path==='/source.bin'?size:entries.get(path)}},
  async upload(path,source,_overwrite,signal){let bytes=0;for await(const part of source){signal.throwIfAborted();bytes+=part.length;tail=Buffer.from(part.subarray(-3))}entries.set(path,bytes);uploaded=bytes},
  async move(from,to){entries.set(to,entries.get(from));entries.delete(from)},
  async remove(path){entries.delete(path)},
  async download(_path,target,signal){await pipeline(Readable.from((function*(){for(let at=0;at<size;at+=chunk.length)yield chunk.subarray(0,Math.min(chunk.length,size-at))})()),target,{signal})},
 }} }
 const uploads=new SessionFileUploads(files),downloads=new SessionFileDownloads(files)
 t.after(()=>{uploads.close();downloads.close()})
 const signal=new AbortController().signal
 const sent=await uploads.upload({endpointId:'ftp:test',localPath:'large.bin',sessionDirectory:root,remoteDirectory:'/out'},signal,()=>{})
 assert.equal(sent.bytes,size);assert.equal(uploaded,size);assert.deepEqual(tail,Buffer.from([1,2,3]))
 const saved=await downloads.download({endpointId:'sftp:test',remotePath:'/source.bin',sessionDirectory:root},signal,()=>{})
 assert.equal(saved.bytes,size);assert.equal((await stat(saved.localPath)).size,size)
 const read=await open(saved.localPath,'r')
 try{for(const position of [0,512*1024*1024,size-1]){const buffer=Buffer.alloc(1);assert.equal((await read.read(buffer,0,1,position)).bytesRead,1);assert.equal(buffer[0],0x6d)}}finally{await read.close()}
 assert.deepEqual((await readdir(root)).sort(),['download.bin','large.bin'])
})

test('download timeout measures inactivity and refreshes on progress rather than limiting total duration',async t=>{
 const clock=idleClock(t)
 const root=await mkdtemp(join(tmpdir(),'ssh-download-idle-'));t.after(()=>rm(root,{recursive:true,force:true}))
 let ready,target,activeSignal
 const started=new Promise(resolve=>{ready=resolve})
 const files={async connect(){return {close(){},async stat(){return {kind:'file',path:'/two.bin',name:'two.bin',size:2}},async download(_path,destination,signal){target=destination;activeSignal=signal;ready();await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))}}}}
 const service=new SessionFileDownloads(files);t.after(()=>service.close())
 const pending=service.download({endpointId:'sftp:test',remotePath:'/two.bin',sessionDirectory:root},new AbortController().signal,()=>{})
 const rejected=assert.rejects(pending,/连续 5 分钟没有进展/)
 await started
 clock.tick(240_000)
 await new Promise((resolve,reject)=>target.write(Buffer.from([1]),error=>error?reject(error):resolve()))
 clock.tick(240_000)
 assert.equal(activeSignal.aborted,false,'eight minutes total with progress is still allowed')
 clock.tick(60_000)
 await rejected
 assert.deepEqual(await readdir(root),[])
})

test('a stalled upload still aborts and removes its remote staging data',async t=>{
 const clock=idleClock(t)
 const root=await mkdtemp(join(tmpdir(),'ssh-upload-idle-'));t.after(()=>rm(root,{recursive:true,force:true}))
 await writeFile(join(root,'data.bin'),Buffer.alloc(1024))
 let ready,removed=false,closed=false
 const started=new Promise(resolve=>{ready=resolve})
 const files={async connect(){return {close(){closed=true},async stat(path){return {kind:'directory',path}},async upload(_path,source,_overwrite,signal){source.once('data',()=>{source.pause();ready()});await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))},async remove(){removed=true}}}}
 const service=new SessionFileUploads(files);t.after(()=>service.close())
 const pending=service.upload({endpointId:'ftp:test',localPath:'data.bin',sessionDirectory:root,remoteDirectory:'/out'},new AbortController().signal,()=>{})
 const rejected=assert.rejects(pending,/连续 5 分钟没有进展/)
 await started;clock.tick(300_000);await rejected
 assert.equal(removed,true);assert.equal(closed,true)
})
