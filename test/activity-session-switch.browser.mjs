// Real xterm and HTTP/SSE; all sessions and SSH endpoints are isolated fixtures.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const { chromium } = await import(process.env.DSH_PLAYWRIGHT_MODULE ?? 'playwright')
const repo=fileURLToPath(new URL('../',import.meta.url)),temp=await fs.mkdtemp(path.join(os.tmpdir(),'ssh-activity-switch-'))
const baseline=process.env.DSH_ACTIVITY_BASELINE==='1',report=process.env.DSH_ACTIVITY_REPORT
const reads=[],inputs=[],resizes=[],streams=new Set(),history=new Map(),closed=new Set(),bases=new Map()
for(const id of ['a','b'])history.set(id,(`\x1b[32m${id}:`+'output '.repeat(12)+'\x1b[0m\r\n').repeat(2300)+`READY_${id}\r\n`)
const initialHistory=new Map(history)
let server,browser
try{
  const icons=new Set()
  for(const file of await fs.readdir(path.join(repo,'src'),{recursive:true}))if(/\.tsx?$/.test(file)){
    const source=ts.createSourceFile(file,await fs.readFile(path.join(repo,'src',file),'utf8'),ts.ScriptTarget.Latest,true)
    for(const statement of source.statements)if(ts.isImportDeclaration(statement)&&statement.moduleSpecifier.text==='@deepseek-ai/dsh-client-ui-primitives')
      for(const element of statement.importClause?.namedBindings?.elements??[])icons.add((element.propertyName??element.name).text)
  }
  await build({stdin:{resolveDir:repo,loader:'tsx',contents:`
    import {StrictMode,useState} from 'react';import {createRoot} from 'react-dom/client';
    ${baseline?'':"import {disposeActivityTerminalViews} from './src/activity-terminal.tsx';window.disposeViews=disposeActivityTerminalViews;"}
    import {Terminal} from '@xterm/xterm';import {SshActivityPanel} from './src/activity-panel.tsx';
    import css from './src/client.css';import surface from './src/activity-surface.css';import xterm from '@xterm/xterm/css/xterm.css';
    import {sshLocale} from './src/i18n.ts';sshLocale.setLocale('en');
    const style=document.createElement('style');style.textContent=css+surface+xterm;document.head.append(style);
    window.stats={opens:0,disposes:0,bytes:0,instances:[],longTasks:[],ticks:[],switches:[]};
    const open=Terminal.prototype.open,dispose=Terminal.prototype.dispose,write=Terminal.prototype.write;
    Terminal.prototype.open=function(...args){window.stats.opens++;window.stats.instances.push(this);return open.apply(this,args)};
    Terminal.prototype.dispose=function(...args){window.stats.disposes++;return dispose.apply(this,args)};
    Terminal.prototype.write=function(data,...args){window.stats.bytes+=data.length;return write.call(this,data,...args)};
    new PerformanceObserver(list=>window.stats.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
    let tick=performance.now();setInterval(()=>{const now=performance.now();window.stats.ticks.push(now-tick);tick=now},20);
    const controller={requestedView:()=> 'terminals',selected:()=>undefined,subscribe:()=>()=>{},open(){},close(){}};
    function App(){const[id,setId]=useState('a'),[visible,setVisible]=useState(!new URLSearchParams(location.search).has('hidden')),[mounted,setMounted]=useState(true);window.switchSession=setId;window.setVisible=setVisible;window.setMounted=setMounted;
      return <><nav><button id="switch-a" onClick={()=>setId('a')}>Session A</button><button id="switch-b" onClick={()=>setId('b')}>Session B</button><input id="conversation-input" aria-label="Conversation input"/></nav>
      <main data-session={id} style={{width:420,height:580,display:visible?'block':'none'}}>{mounted&&<SshActivityPanel key={id} sessionId={id} visible={visible} controller={controller}/>}</main></>}
    const app=<App/>;createRoot(document.querySelector('#root')).render(new URLSearchParams(location.search).has('strict')?<StrictMode>{app}</StrictMode>:app);
  `},outfile:path.join(temp,'fixture.js'),bundle:true,platform:'browser',jsx:'automatic',loader:{'.css':'text','.module.css':'local-css'},define:{'process.env.NODE_ENV':'"production"'},alias:{react:path.join(repo,'node_modules/react'),'react-dom':path.join(repo,'node_modules/react-dom')},plugins:[{name:'host-only-fixtures',setup(b){
    b.onResolve({filter:/^@deepseek-ai\/dsh-client-ui-primitives$/},()=>({path:'icons',namespace:'fixture'}))
    b.onResolve({filter:/^\.\/sftp-client\.js$/},()=>({path:'directories',namespace:'fixture'}))
    b.onLoad({filter:/.*/,namespace:'fixture'},({path:kind})=>({contents:kind==='icons'?`const Icon=({size=16,className})=><svg width={size} height={size} className={className} aria-hidden="true"/>;export const ${[...icons].map(name=>name+'=Icon').join(',')};`:'export const ActivitySftpBrowser=()=>null,LocalWorkspaceBrowser=()=>null;',loader:'tsx',resolveDir:repo}))
  }}]})
  server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost'),sid=url.searchParams.get('sessionId')??'a'
    const json=value=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value))}
    if(url.pathname==='/fixture.js'){res.setHeader('content-type','text/javascript');res.end(await fs.readFile(path.join(temp,'fixture.js')));return}
    if(url.pathname.endsWith('/activity')){json({injection:{sessionId:sid,permission:'terminal'},profiles:[],terminals:closed.has(sid)?[]:[{terminalId:'terminal-'+sid,profileId:'profile',name:'Terminal '+sid,cwd:'/',createdAt:1,status:{kind:'running'}}]});return}
    if(url.pathname.endsWith('/stream')){
      const value=history.get(sid),cursor=Number(url.searchParams.get('cursor')??0),base=bases.get(sid)??0,data=value.slice(Math.max(0,cursor-base))
      reads.push({sid,cursor,bytes:data.length});res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','x-accel-buffering':'no'})
      res.write('data: '+JSON.stringify({data,cursor:base+value.length,truncated:cursor<base,closed:false})+'\n\n')
      const stream={sid,res};streams.add(stream);req.on('close',()=>streams.delete(stream));return
    }
    if(req.method==='DELETE'){closed.add(sid);json({closed:true});return}
    if(req.method==='POST'){
      let body='';for await(const chunk of req)body+=chunk
      if(url.pathname.endsWith('/input'))inputs.push(JSON.parse(body))
      if(url.pathname.endsWith('/resize'))resizes.push(JSON.parse(body))
      json({ok:true});return
    }
    res.setHeader('content-type','text/html');res.end('<!doctype html><meta charset="utf-8"><style>body{margin:16px;font:14px system-ui}nav{display:flex;gap:12px;margin-bottom:12px}</style><div id="root"></div><script src="/fixture.js"></script>')
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  browser=await chromium.launch({args:['--no-sandbox','--no-proxy-server']})
  const results=[]
  for(const strict of [false,true]){
    closed.clear();bases.clear()
    for(const [sid,value] of initialHistory)history.set(sid,value)
    const initialResizes=resizes.length
    const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[]
    page.on('pageerror',e=>errors.push(e.message))
    const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4})
    const ready=async sid=>{
      await page.waitForFunction(sid=>{
        if(document.querySelector('main')?.dataset.session!==sid)return false
        const terminal=window.stats.instances.find(t=>t.element?.isConnected)
        if(!terminal)return false
        const b=terminal.buffer.active;return Array.from({length:Math.min(128,b.length)},(_,i)=>b.getLine(b.length-1-i)?.translateToString()).join('').includes('READY_'+sid)
      },sid,{timeout:30000})
    }
    await page.goto('http://127.0.0.1:'+server.address().port+'/'+(strict?'?strict':''));await ready('a')
    const initial=await page.evaluate(()=>{const t=window.stats.instances.find(t=>t.element?.isConnected);window.originalA=t;t.scrollToLine(20);return{opens:window.stats.opens,bytes:window.stats.bytes}})
    const beforeInput=inputs.length
    await page.locator('.xterm-helper-textarea').press('a')
    await page.waitForFunction(()=>true);for(let i=0;i<20&&inputs.length===beforeInput;i++)await page.waitForTimeout(20)
    assert.equal(inputs.length,beforeInput+1)
    const startReads=reads.length,startInputs=inputs.length,timings=[]
    for(let round=0;round<4;round++)for(const sid of ['b','a']){
      const start=await page.evaluate(()=>performance.now());await page.locator('#switch-'+sid).click();await ready(sid)
      timings.push({sid,ms:await page.evaluate(start=>performance.now()-start,start)})
    }
    await page.locator('.xterm-helper-textarea').press('b');await page.waitForTimeout(100)
    const summary=await page.evaluate(()=>({opens:window.stats.opens,disposes:window.stats.disposes,bytes:window.stats.bytes,reusedA:window.stats.instances.find(t=>t.element?.isConnected)===window.originalA,scroll:window.originalA.buffer.active.viewportY,longTasks:window.stats.longTasks,maxTick:Math.max(...window.stats.ticks)}))
    const currentReads=reads.slice(startReads),currentInputs=inputs.slice(startInputs)
    const currentResizes=resizes.slice(initialResizes)
    if(!baseline){
      assert.equal(summary.opens,2,'Switching sessions must reuse both xterm instances')
      assert.equal(summary.disposes,0);assert.equal(summary.reusedA,true)
      assert.ok(currentReads.filter(x=>x.sid==='a').every(x=>x.cursor>0),'Returning to A must resume its output cursor')
      assert.ok(summary.bytes<=history.get('a').length+history.get('b').length,'Historical output must not be parsed again')
      assert.ok(currentInputs.every(x=>x.sequence>0),'Input sequence must survive remounts')
      assert.equal(new Set(currentResizes.map(x=>JSON.stringify([x.sessionId,x.cols,x.rows]))).size,currentResizes.length,'Session returns must not repeat unchanged remote terminal sizes')
      await page.evaluate(()=>{window.originalA.scrollToLine(20);window.setVisible(false)})
      await page.waitForTimeout(100)
      const paused=reads.length,delta='AFTER_HIDDEN_a\r\n';history.set('a',history.get('a')+delta)
      assert.equal([...streams].filter(s=>s.sid==='a').length,0,'Hidden output subscription must stop')
      await page.waitForTimeout(100);assert.equal(reads.length,paused)
      await page.evaluate(()=>window.setVisible(true))
      await page.waitForFunction(()=>{const b=window.originalA.buffer.active;return Array.from({length:5},(_,i)=>b.getLine(Math.max(0,b.length-1-i))?.translateToString()).join('').includes('AFTER_HIDDEN_a')})
      await page.waitForTimeout(100)
      assert.equal(reads.at(-1).bytes,delta.length)
      assert.equal(await page.evaluate(()=>window.originalA.buffer.active.viewportY),20,'History scroll position must survive suspension')
      await page.evaluate(()=>window.switchSession('b'));await ready('b')
      history.set('a','READY_a\r\nTRUNCATED_a\r\n');bases.set('a',1_000_000)
      await page.evaluate(()=>window.switchSession('a'));await ready('a')
      await page.waitForFunction(()=>{const b=window.originalA.buffer.active;return b.length<100&&Array.from({length:b.length},(_,i)=>b.getLine(i)?.translateToString()).join('').includes('TRUNCATED_a')})
      await page.getByRole('button',{name:/End.*Terminal a/}).click()
      await page.waitForFunction(()=>window.stats.disposes===1)
      assert.equal(closed.has('a'),true)
      await page.evaluate(()=>{window.setMounted(false);window.disposeViews()})
      await page.waitForFunction(()=>window.stats.disposes===2)
    }
    results.push({strict,initial,...summary,reads:currentReads,inputs:currentInputs,resizes:currentResizes,timings})
    assert.deepEqual(errors,[])
    await page.close()
  }
  if(!baseline){
    closed.clear();const page=await browser.newPage()
    await page.goto('http://127.0.0.1:'+server.address().port+'/?hidden');await page.waitForTimeout(150)
    assert.equal(await page.evaluate(()=>window.stats.opens),0,'Initially hidden activity must not initialize xterm')
    await page.evaluate(()=>window.setMounted(false));await page.close()
  }
  if(report)await fs.writeFile(report,JSON.stringify({baseline,cpuThrottle:4,historyChars:history.get('a').length,results},null,2)+'\n')
  console.log((baseline?'BASELINE':'PASS')+': session A/B remounts, real xterm, history cursors and input sequence checked')
}finally{
  await browser?.close();for(const stream of streams)stream.res.end();server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));await fs.rm(temp,{recursive:true,force:true})
}
