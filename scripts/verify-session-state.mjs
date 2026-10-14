// Isolated React fixture. No live SSH hosts or user files are accessed.
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFile,readdir} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {build} from 'esbuild'
const {chromium}=await import(process.env.SSH_PLAYWRIGHT_MODULE??'playwright')
const root=fileURLToPath(new URL('../',import.meta.url))
const primitives=new Set()
for(const name of (await readdir(root+'src')).filter(name=>/\.tsx?$/.test(name))){
 const text=await readFile(root+'src/'+name,'utf8')
 for(const match of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]@deepseek-ai\/dsh-client-ui-primitives['"]/g))
  for(const value of match[1].split(',')){const symbol=value.trim().split(/\s+as\s+/)[0];if(symbol)primitives.add(symbol)}
}
const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {RemoteWorkspace,createActivityController,installStyles} from './src/client.tsx';
 installStyles();const app=createRoot(document.getElementById('root'));let current='a',body;const listeners=new Set();
 const docked=location.search.includes('docked'),tabs=new Map();
 const ctx={layout:{openDetails(){},closeDetails(){},...(docked?{selectPanel(){}}:{})},sessions:{list:{getSnapshot:()=>({current}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}}},slots:{register(_options,render){body=render;queueMicrotask(paint);return()=>{body=undefined;queueMicrotask(paint)}}}};
 ctx.get=()=>ctx.sessions;ctx.inject=(_names,fn)=>{const child={get:name=>name==='sidebarRight'?{openTab(){if(!tabs.has(current))tabs.set(current,{id:current,signal:new AbortController().signal,visible:true,actions:{close(){tabs.delete(current);paint()}}});queueMicrotask(paint)}}:{register:()=>()=>{}},effect:fn=>fn(),slots:{inject:(_name,fn)=>fn(),register:(_options,render)=>{body=render;return()=>{body=undefined}}}};fn(child);return {dispose(){}}};
 const controller=createActivityController(ctx);
 const remote={selected:()=>undefined,subscribe:()=>()=>{},open(){},close(){}};
 const paint=()=>app.render(location.search.includes('groups')?<RemoteWorkspace controller={remote} useSessions={fn=>fn({current})} useWorkspaces={fn=>fn({items:[]})}/>:body&&(!docked||tabs.has(current))?React.createElement(body,{key:current,sessionId:current,useTabInfo:()=>({tab:tabs.get(current)})}):<div>closed</div>);
 window.switchSession=id=>{current=id;listeners.forEach(fn=>fn());paint()};window.openActivity=()=>controller.open(current);window.closeActivity=()=>controller.close(current);
 window.repeatGroups=paint;controller.open('a');paint();
 `},bundle:true,write:false,outdir:'/tmp/ssh-session-fixture',platform:'browser',format:'iife',jsx:'automatic',
 nodePaths:process.env.SSH_REACT_DOM_MODULES?[process.env.SSH_REACT_DOM_MODULES]:[],
 alias:{react:root+'node_modules/react'},loader:{'.css':'text','.woff':'dataurl','.woff2':'dataurl','.ttf':'dataurl'},
 plugins:[{name:'fixture',setup(b){
  b.onResolve({filter:/^@deepseek-ai\/dsh-client-ui-primitives$/},()=>({path:'primitives',namespace:'fixture'}))
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({resolveDir:root,contents:`import {createElement} from 'react';export const Modal=({open,children,className})=>open?createElement('div',{role:'dialog',className},children):null;${[...primitives].filter(name=>name!=='Modal').map(name=>`export const ${name}=()=>createElement('svg',{width:16,height:16});`).join('')}`}))
  b.onLoad({filter:/\/src\/client\.tsx$/},async args=>({loader:'tsx',contents:(await readFile(args.path,'utf8')).replace('function RemoteWorkspace(','export function RemoteWorkspace(').replace('function createActivityController(','export function createActivityController(').replace('function installStyles(','export function installStyles(')}))
  b.onLoad({filter:/\/src\/terminal-workspace\.tsx$/},()=>({loader:'tsx',contents:'export function TerminalWorkspace(){return null}'}))
  b.onLoad({filter:/\.module\.css$/},async args=>({loader:'local-css',contents:await readFile(args.path,'utf8')}))
 }}]})
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css'))?.text??''
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?js:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0}#root{height:100vh}.dsh-ssh-activity-panel{height:100vh}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`)})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const browser=await chromium.launch({headless:true,args:['--no-sandbox']})
const profiles=[{id:'other',name:'Other host',group:'Other'},{id:'mounted',name:'Mounted host',group:'Mounted'}].map(p=>({...p,host:'192.0.2.1',username:'user',port:22,tags:[],proxy:{type:'none'},credential:{configured:true,fields:[]}}))
const access=id=>({sessionId:id,profileIds:['mounted'],workingDirectories:{mounted:'/remote'},workingProjectIds:{},mountedProjectIds:{},fileEndpointIds:[],permission:'exec',filePermission:'browse',requireCommandApproval:true,requireFileApproval:true})
const entry=(path,kind='file')=>({path,name:path.split('/').pop(),kind,size:10,modifiedAt:1})
try{
 for(const width of [375,1200]){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'});page.setDefaultTimeout(10000)
  const errors=[],reads=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)})
  await page.addInitScript(()=>{window.EventSource=undefined})
  await page.route('**/ssh-local/v1/**',async route=>{
   const url=new URL(route.request().url()),path=url.pathname.replace('/ssh-local/v1',''),q=url.searchParams,id=q.get('sessionId')??'a',target=q.get('path')??'/'+id
   const json=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)})
   if(path==='/profiles')return json(profiles)
   if(path==='/injections')return json(access(id))
   if(path==='/workspace-revision')return json({revision:'fixture-v1'})
   if(['/ftp-profiles','/vault','/proxies','/group-proxies'].includes(path))return json([])
   if(path==='/activity/native-directory')return json({available:false})
   if(path==='/activity')return json({profiles:[{...profiles[1],cwd:'/remote',mountedDirectories:[]}],terminals:[],injection:access(id)})
   if(path==='/activity/directory'&&route.request().method()==='PUT')return json({cwd:route.request().postDataJSON().cwd})
   if(path==='/activity/local-directory'||path==='/activity/files'){
    reads.push([id,target]);return json({path:target,parent:target.includes('/nested')?target.replace('/nested',''):null,entries:target.includes('/nested')?[entry(target+'/schema.sql'),entry(target+'/broken.txt'),entry(target+'/large.sql')]:[entry(target+'/nested','directory')]})
   }
   if(path==='/activity/local-stat'||path==='/activity/stat')return json(entry(target))
   if(path==='/activity/local-file'||path==='/activity/file'){
    if(target.endsWith('broken.txt'))return json({error:'preview unavailable'},400)
    if(target.endsWith('large.sql'))return json({...entry(target),kind:'binary',mimeType:'text/plain',previewUnavailable:'too-large',size:2000000})
    return json({...entry(target),kind:'text',mimeType:'text/plain',text:id+': SELECT 1;'})
   }
   return json([])
  })
  const base=`http://127.0.0.1:${server.address().port}`
  await page.goto(base+(width===1200?'/?docked':''))
  await page.locator('.dsh-ssh-sftp-table strong',{hasText:'nested'}).click()
  await page.locator('.dsh-ssh-sftp-table strong',{hasText:'schema.sql'}).click()
  await page.getByText('a: SELECT 1;', {exact:true}).waitFor()
  await page.evaluate(()=>{window.switchSession('b');window.openActivity()})
  await page.waitForFunction(()=>document.querySelector('.dsh-ssh-sftp-pathbar input')?.value==='/b')
  assert.equal(await page.locator('.dsh-ssh-sftp-pathbar input').inputValue(),'/b')
  await page.evaluate(()=>window.switchSession('a'))
  await page.getByText('a: SELECT 1;', {exact:true}).waitFor()
  await page.getByRole('button',{name:'返回目录',exact:true}).click()
  assert.equal(await page.locator('.dsh-ssh-sftp-pathbar input').inputValue(),'/a/nested')
  await page.locator('.dsh-ssh-sftp-table strong',{hasText:'broken.txt'}).click()
  await page.getByRole('alert').waitFor();assert.ok(await page.locator('.dsh-ssh-file-binary a').count())
  await page.getByRole('button',{name:'返回目录',exact:true}).click()
  await page.locator('.dsh-ssh-sftp-table strong',{hasText:'large.sql'}).click()
  await page.getByText(/文件超过预览上限/).waitFor()
  assert.ok(await page.locator('.dsh-ssh-file-binary a').count())
  await page.getByRole('button',{name:'远端目录',exact:true}).click()
  await page.locator('.dsh-ssh-sftp-table strong',{hasText:'nested'}).click()
  await page.locator('.dsh-ssh-sftp-table strong',{hasText:'schema.sql'}).click()
  await page.getByText('a: SELECT 1;', {exact:true}).waitFor()
  await page.evaluate(()=>{window.closeActivity();window.openActivity()})
  await page.getByText('a: SELECT 1;', {exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'远端目录',exact:true}).getAttribute('aria-pressed'),'true')
  await page.evaluate(()=>window.switchSession('b'))
  await page.locator('.dsh-ssh-sftp-pathbar input[aria-label]').waitFor()
  assert.equal(await page.getByRole('button',{name:'会话目录',exact:true}).getAttribute('aria-pressed'),'true')
  await page.evaluate(()=>window.switchSession('a'))
  await page.getByText('a: SELECT 1;', {exact:true}).waitFor()
  console.log('activity passed',width);await page.goto(base+'/?groups')
  if(width===375)await page.getByRole('button',{name:'主机',exact:true}).click()
  const mounted=page.getByRole('button',{name:'Mounted 1',exact:true}),other=page.getByRole('button',{name:'Other 1',exact:true})
  await mounted.waitFor();await page.waitForFunction(()=>document.querySelector('.dsh-ssh-tree-host-row.is-active strong')?.textContent==='Mounted host')
  assert.equal(await mounted.getAttribute('aria-expanded'),'true');assert.equal(await other.getAttribute('aria-expanded'),'false')
  await mounted.click();await page.evaluate(()=>window.repeatGroups())
  assert.equal(await mounted.getAttribute('aria-expanded'),'false','manual collapse remains respected')
  assert.deepEqual(errors,[]);console.log(JSON.stringify({width,sessionIsolation:true,previewRestored:true,remoteViewRestored:true,mountedGroupExpanded:true,errors}))
  await page.close()
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
