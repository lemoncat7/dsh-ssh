import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {readLocalWorkspacePreview} from '../lib/local-workspace.js'
import {readSftpFilePreview,mimeTypeFor} from '../lib/sftp.js'
import {MAX_TEXT_PREVIEW_BYTES,textPreview} from '../lib/text-preview.js'

test('local previews sniff unknown suffixes, SQL, TXT, dotfiles and BOM-marked Unicode; binary/large files offer download',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ssh-preview-'));t.after(()=>rm(root,{recursive:true,force:true}))
 for(const name of ['schema.sql','notes.TXT','settings.custom','no-extension','.env.production','unit.service']){
  await writeFile(join(root,name),'SELECT 1; -- 中文\n')
  const result=await readLocalWorkspacePreview(root,join(root,name))
  assert.equal(result.kind,'text',name);assert.equal(result.text,'SELECT 1; -- 中文\n');assert.ok(result.contentHash)
 }
 await writeFile(join(root,'utf16.sql'),Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('SELECT 中文','utf16le')]))
 const utf16=await readLocalWorkspacePreview(root,join(root,'utf16.sql'));assert.equal(utf16.kind,'text');assert.match(utf16.text,/SELECT 中文/);assert.equal(utf16.contentHash,undefined)
 for(const [name,bytes,reason] of [['bad.txt',Buffer.from([0,1,2]),'unreadable'],['data.custom',Buffer.from([0xff,0,0xfe]),'unreadable'],['bad-utf8.sql',Buffer.from([0xc3,0x28]),'unreadable'],['large.sql',Buffer.alloc(MAX_TEXT_PREVIEW_BYTES+1,65),'too-large']]){
  await writeFile(join(root,name),bytes);const result=await readLocalWorkspacePreview(root,join(root,name))
  assert.equal(result.kind,'binary');assert.equal(result.previewUnavailable,reason);assert.equal(result.text,undefined)
 }
 await writeFile(join(root,'empty.custom'),'');assert.equal((await readLocalWorkspacePreview(root,join(root,'empty.custom'))).text,'')
 assert.equal(mimeTypeFor('schema.SQL'),'text/plain')
})

test('SFTP uses the same content rules, bounds growing files and skips reading oversized files',async()=>{
 let bytes=Buffer.from('SELECT 1;'),size=bytes.length,reads=0,closed=0,mode=0o100644
 const channel={realpath:(p,cb)=>cb(null,p),stat:(_p,cb)=>cb(null,{size,mode}),createReadStream:()=>{reads++;return Readable.from([bytes])},end:()=>closed++}
 const connector={connect:async()=>({client:{sftp:cb=>cb(null,channel)},close(){}})}
 assert.equal((await readSftpFilePreview(connector,'p','/data.unknown')).text,'SELECT 1;')
 size=MAX_TEXT_PREVIEW_BYTES+1
 assert.equal((await readSftpFilePreview(connector,'p','/dump.sql')).previewUnavailable,'too-large');assert.equal(reads,1)
 size=1;bytes=Buffer.alloc(20,65)
 assert.equal((await readSftpFilePreview(connector,'p','/growing.sql',10)).kind,'binary')
 mode=0o010644;await assert.rejects(readSftpFilePreview(connector,'p','/pipe'),/regular file/)
 assert.equal(closed,4)
})

test('incomplete reads are not rendered or offered as editable text',()=>{
 const result=textPreview({path:'/x',name:'x',size:50,mimeType:'text/plain',kind:'text'},Buffer.from('short'))
 assert.equal(result.kind,'binary');assert.equal(result.contentHash,undefined)
})
