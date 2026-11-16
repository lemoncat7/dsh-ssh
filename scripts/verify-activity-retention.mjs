// Isolated retained-session host fixture using real React, xterm and HTTP/SSE.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, readdir, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
const { chromium } = await import(process.env.SSH_PLAYWRIGHT_MODULE ?? 'playwright')
const root = fileURLToPath(new URL('../',import.meta.url)), primitives = new Set()
for(const name of (await readdir(root+'src')).filter(n=>/\.tsx?$/.test(n))) {
 const text=await readFile(root+'src/'+name,'utf8')
 for(const m of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]@deepseek-ai\/dsh-client-ui-primitives['"]/g))for(const v of m[1].split(',')){const n=v.trim().split(/\s+as\s+/)[0];if(n)primitives.add(n)}
}
const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {createDockedPanel} from './src/docked-panel-compat.tsx';
 import {SshActivityPanel} from './src/activity-panel.tsx';
 import css from './src/client.css';import xcss from '@xterm/xterm/css/xterm.css';
 const style=document.createElement('style');style.textContent=css+xcss+'body{margin:0}#root{height:600px}.fixture{height:600px}';document.head.append(style);
 window.terminals={};window.created=0;window.disposed=0;
 let Body,current='a',hidden=false;const tabs=new Map(['a','b'].map(id=>[id,new AbortController()]));const app=createRoot(document.getElementById('root'));
 const views=new Map(),listeners=new Set();
 const controller={requestedView:id=>views.get(id)??'terminals',subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},selected:()=>undefined,open(){},close(id){tabs.get(id)?.abort();tabs.delete(id);paint()}};
 const child={get:()=>({register:()=>()=>{}}),effect:fn=>fn(),slots:{inject:(_name,fn)=>fn(),register:(_config,body)=>{Body=body;return()=>{}}}};
 const ctx={inject:(_names,fn)=>{fn(child);return{dispose(){}}}};
 createDockedPanel(ctx,'fixture','SSH',props=><SshActivityPanel {...props} controller={controller}/>,()=>{});
 function paint(){app.render(<>{[...tabs].map(([id,abort])=><div className="fixture" key={id} hidden={current!==id||hidden}><Body sessionId={id} useTabInfo={()=>({tab:{id,visible:current===id&&!hidden,signal:abort.signal,actions:{close:()=>controller.close(id)}}})}/></div>)}</>)}
 window.showFiles=()=>{views.set(current,'local-directory');for(const fn of listeners)fn()};
 window.switchSession=id=>{current=id;paint()};window.hidePanel=value=>{hidden=value;paint()};window.closeSession=id=>controller.close(id);paint();
 `},bundle:true,write:false,outdir:'/tmp/ssh-activity-fixture',platform:'browser',format:'iife',jsx:'automatic',alias:{react:root+'node_modules/react'},loader:{'.css':'text'},plugins:[{name:'fixture',setup(b){
 b.onResolve({filter:/^@deepseek-ai\/dsh-client-ui-primitives$/},()=>({path:'icons',namespace:'fixture'}))
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({resolveDir:root,contents:`import {createElement} from 'react';${[...primitives].map(n=>`export const ${n}=()=>createElement('svg');`).join('')}`}))
 b.onLoad({filter:/\/src\/sftp-client\.tsx$/},()=>({loader:'tsx',contents:`import React,{useEffect} from 'react';import {createPortal} from 'react-dom';export const ActivitySftpBrowser=()=>null;export function LocalWorkspaceBrowser(){return createPortal(<div className="fixture-file-dialog">file dialog</div>,document.body)}`}))
 b.onLoad({filter:/\/src\/activity-panel\.tsx$/},async args=>({loader:'tsx',contents:(await readFile(args.path,'utf8')).replace('terminalRef.current = terminal','window.terminals[sessionId]=terminal;window.created++;terminalRef.current = terminal').replace('terminal.dispose()','window.disposed++;terminal.dispose()')}))
}}]})
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text
const data=new Map(['a','b'].map(id=>[id,{text:Array.from({length:1500},(_,i)=>`${id}-line-${i} ${'x'.repeat(45)}\r\n`).join(''),base:0,listeners:new Set(),polls:0,cursors:[],bytes:0}]))
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),id=url.searchParams.get('sessionId')??'a',state=data.get(id)
 const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))}
 if(url.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(js);return}
 if(url.pathname==='/ssh-local/v1/activity'){state.polls++;return json({injection:{permission:'terminal'},profiles:[],terminals:[{terminalId:id,profileId:'host',name:id,cwd:'/srv',createdAt:1,status:{kind:'running'}}]})}
 if(url.pathname.endsWith('/stream')){
  const cursor=Number(req.headers['last-event-id']??url.searchParams.get('cursor')??0);state.cursors.push(cursor)
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.flushHeaders()
  const send=()=>{const text=state.text.slice(Math.max(cursor,state.base)-state.base);state.bytes+=text.length;res.write(`id: ${state.base+state.text.length}\ndata: ${JSON.stringify({data:text,cursor:state.base+state.text.length,truncated:cursor<state.base,closed:false})}\n\n`)}
  send();state.listeners.add(res);res.on('close',()=>state.listeners.delete(res));return
 }
 if(url.pathname.endsWith('/resize')){res.writeHead(204);res.end();return}
 if(url.pathname.startsWith('/ssh-local'))return json({})
 res.setHeader('Content-Type','text/html');res.end('<html><body><div id="root"></div><script src="/app.js"></script></body></html>')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-webgl']})
try{
 const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`)
 const lines=id=>page.evaluate(id=>{const b=window.terminals[id].buffer.active;return Array.from({length:b.length},(_,i)=>b.getLine(i)?.translateToString(true)).join('\n')},id)
 await page.waitForFunction(()=>window.terminals.a?.buffer.active.length>1000)
 // Wait for xterm's async parser and initial layout before simulating history browsing.
 await page.evaluate(async()=>{await new Promise(resolve=>window.terminals.a.write('',resolve));await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))})
 assert.equal(await page.evaluate(()=>window.created),1,'hidden session must be lazy')
 const first=data.get('a').text.length
 await page.evaluate(()=>{window.saved=document.querySelector('.xterm');window.terminals.a.scrollToTop()})
 await page.waitForFunction(()=>window.terminals.a.buffer.active.viewportY===0)
 await page.evaluate(()=>window.switchSession('b'))
 await page.waitForFunction(()=>window.created===2)
 await page.waitForTimeout(100)
 assert.equal(data.get('a').listeners.size,0)
 const polls=data.get('a').polls;data.get('a').text+='APPENDED-ONE\r\n'
 await page.waitForTimeout(2500);assert.equal(data.get('a').polls,polls,'hidden activity must not poll')
 await page.evaluate(()=>window.switchSession('a'))
 await page.waitForFunction(()=>{const b=window.terminals.a.buffer.active;return Array.from({length:b.length},(_,i)=>b.getLine(i)?.translateToString(true)).some(s=>s==='APPENDED-ONE')})
 assert.equal(await page.evaluate(()=>window.saved===document.querySelector('.xterm')),true)
 assert.equal(data.get('a').cursors.at(-1),first)
 assert.equal((await lines('a')).split('APPENDED-ONE').length-1,1)
 await page.evaluate(()=>new Promise(resolve=>window.terminals.a.write('',resolve)))
 await page.waitForFunction(()=>window.terminals.a.buffer.active.viewportY===0)
 assert.equal(await page.evaluate(()=>window.terminals.a.buffer.active.viewportY),0,'history scroll position is preserved')
 for(let i=0;i<5;i++){await page.evaluate(()=>window.switchSession('b'));await page.waitForTimeout(30);await page.evaluate(()=>window.switchSession('a'));await page.waitForTimeout(30)}
 assert.equal(await page.evaluate(()=>window.created),2);assert.equal(await page.evaluate(()=>window.disposed),0)
 assert.equal(data.get('a').bytes,first+'APPENDED-ONE\r\n'.length)
 await page.evaluate(()=>{window.saved.dispatchEvent(new WheelEvent('wheel',{bubbles:true}));window.terminals.a.scrollToBottom()})
 await page.waitForFunction(()=>window.terminals.a.buffer.active.viewportY===window.terminals.a.buffer.active.baseY)
 await page.waitForTimeout(100)
 assert.equal(await page.evaluate(()=>window.terminals.a.buffer.active.viewportY===window.terminals.a.buffer.active.baseY),true,'user scrolling overrides restoration')
 await page.evaluate(()=>window.terminals.a.scrollToTop());await page.waitForFunction(()=>window.terminals.a.buffer.active.viewportY===0)
 await page.evaluate(()=>window.hidePanel(true));await page.waitForTimeout(100)
 assert.equal(data.get('a').listeners.size,0)
 const s=data.get('a');s.base+=s.text.length+100;s.text='BUFFER-TRUNCATED\r\n'
 await page.evaluate(()=>window.hidePanel(false))
 await page.waitForFunction(()=>window.terminals.a.buffer.active.getLine(0)?.translateToString(true)==='BUFFER-TRUNCATED')
 assert.ok(!(await lines('a')).includes('a-line-0'))
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});await page.waitForTimeout(100)
 assert.equal(data.get('a').listeners.size,0,'background browser page pauses output too')
 await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))});await page.waitForTimeout(100)
 assert.equal(data.get('a').listeners.size,1)
 await page.setViewportSize({width:390,height:700});await page.waitForTimeout(100)
 assert.ok(await page.locator('.dsh-ssh-activity-panel:visible').evaluate(el=>el.getBoundingClientRect().right<=innerWidth+1))
 const out=process.env.SSH_REPORT_DIR;if(out){await mkdir(out,{recursive:true});await page.screenshot({path:out+'/activity-mobile.png'})}
 await page.evaluate(()=>window.showFiles());await page.locator('.fixture-file-dialog').waitFor()
 await page.evaluate(()=>window.switchSession('b'));await page.locator('.fixture-file-dialog').waitFor({state:'detached'})
 await page.evaluate(()=>window.switchSession('a'));await page.locator('.fixture-file-dialog').waitFor()
 await page.evaluate(()=>{window.closeSession('a');window.closeSession('b')});await page.waitForTimeout(100)
 assert.equal(await page.evaluate(()=>window.disposed),2);assert.equal(data.get('a').listeners.size+data.get('b').listeners.size,0)
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({retainedInstances:2,switches:12,hiddenPolling:false,browserPageSuspension:true,hiddenFileDialogsUnmounted:true,resumedCursor:first,duplicateOutput:false,truncationReset:true,disposedInstances:2,errors}))
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
