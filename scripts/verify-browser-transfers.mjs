import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const {chromium} = await import(process.env.SSH_PLAYWRIGHT_MODULE ?? 'playwright')
const root=fileURLToPath(new URL('../',import.meta.url))
const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';
import {LocalTransferTasks} from './src/transfer-task-list.tsx';
import {trackDownloadClick,browserTransfers} from './src/browser-transfers.ts';
import {uploadProfileSftpFile} from './src/client-api.ts';
window.upload=()=>uploadProfileSftpFile('test','/',new File([new Uint8Array(1024*1024)],'upload.bin'));
window.transferSnapshot=()=>browserTransfers.getSnapshot();
createRoot(document.getElementById('root')).render(<><a href='/ssh-local/v1/file-transfer/download?path=/demo.bin' download onClick={trackDownloadClick}>download</a><LocalTransferTasks/></>);
`},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'icons',setup(b){b.onResolve({filter:/^@deepseek-ai\/dsh-client-ui-primitives$/},()=>({path:'icons',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({resolveDir:root,contents:`import React from 'react';export const IconChevronDownOutline14=()=> <svg width='14' height='14'/>;export const IconCloseOutline16=()=> <svg width='14' height='14'/>`,loader:'tsx'}))}}]})
const css=(await Promise.all(['client.css','file-transfer-workspace.css'].map(f=>readFile(root+'src/'+f,'utf8')))).join('\n')
let uploadResponse, failUpload=false, downloadRequests=0, progressRequests=0
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost')
 if(url.pathname==='/bundle.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundle.outputFiles[0].text)}
 if(url.pathname.endsWith('/download-progress')){progressRequests++;res.statusCode=410;return res.end()}
 if(url.pathname.endsWith('/download')){
  downloadRequests++;res.setHeader('Content-Length',65536*16);res.setHeader('Content-Disposition','attachment; filename="demo.bin"');
  let count=0;const timer=setInterval(()=>{res.write(Buffer.alloc(65536));if(++count===16){clearInterval(timer);res.end()}},150);res.on('close',()=>clearInterval(timer));return
 }
 if(url.pathname.endsWith('/upload')){req.resume();req.on('end',()=>{uploadResponse=()=>{res.statusCode=failUpload?409:201;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(failUpload?{error:'Already exists'}:{path:'/upload.bin',name:'upload.bin',size:1048576}))}});return}
 res.setHeader('Content-Type','text/html');res.end(`<html><meta name="viewport" content="width=device-width"><style>${css}</style><body><div id="root" class="dsh-ssh-workspace"></div><script src="/bundle.js"></script></body></html>`)
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const browser=await chromium.launch({headless:true,args:['--no-sandbox']})
try {
 for(const width of [375,1024]){
  const page=await browser.newPage({viewport:{width,height:650},acceptDownloads:true});
  await page.addInitScript(()=>{window.showSaveFilePicker=undefined})
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  if(width===1024)await page.evaluate(()=>document.body.setAttribute('data-ds-dark-theme',''))
  const download=page.waitForEvent('download');await page.getByRole('link',{name:'download',exact:true}).click();const file=await download
  await page.getByText('已发起下载，当前环境无法确认进度或保存结果；无响应时请在浏览器中重试',{exact:true}).waitFor()
  assert.equal(await page.getByRole('progressbar').count(),0,'native download has no invented percentage')
  await page.screenshot({path:`/tmp/ssh-browser-transfer-${width}.png`})
  assert.equal(await file.failure(),null)
  assert.equal(await page.evaluate(()=>window.transferSnapshot()[0].state),'unavailable','native save status remains unknown even after HTTP completion')
  await page.getByRole('button',{name:'关闭',exact:true}).click()
  await page.evaluate(()=>{
    window.writtenBytes=0;window.saveClosed=false;window.writeAborted=false;
    window.showSaveFilePicker=async()=>({name:'chosen.bin',createWritable:async()=>({
      write:async chunk=>{await new Promise(r=>setTimeout(r,200));window.writtenBytes+=chunk.byteLength},
      close:async()=>{await new Promise(r=>window.finishSaving=r);window.saveClosed=true},
      abort:async()=>{window.writeAborted=true},
    })});
  })
  let nativeDownloads=0;page.on('download',()=>nativeDownloads++)
  await page.getByRole('link',{name:'download',exact:true}).click()
  await page.waitForFunction(()=>{const job=window.transferSnapshot()[0];return job.transferredBytes>0&&job.transferredBytes<job.totalBytes})
  assert.ok(await page.evaluate(()=>window.transferSnapshot()[0].transferredBytes<=window.writtenBytes),'progress never leads acknowledged client writes')
  await page.getByText('正在完成本地保存…',{exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>window.saveClosed),false)
  assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'),'99')
  await page.evaluate(()=>window.finishSaving())
  await page.getByText('已保存到所选文件',{exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>window.writtenBytes),1048576)
  assert.equal(nativeDownloads,0,'managed downloads do not also trigger native navigation')
  const beforeCancel=downloadRequests
  await page.evaluate(()=>{window.showSaveFilePicker=async()=>{throw new DOMException('Cancelled','AbortError')}})
  await page.getByRole('link',{name:'download',exact:true}).click()
  await page.waitForFunction(()=>window.transferSnapshot()[0].state==='cancelled')
  assert.equal(downloadRequests,beforeCancel,'picker cancellation never starts a fallback download')
  await page.evaluate(()=>{window.uploadDone=false;window.upload().then(()=>window.uploadDone=true)})
  await page.getByText('已发送，等待远端保存完成…',{exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>window.uploadDone),false,'upload not completed before remote acknowledgement')
  uploadResponse();await page.getByText('已保存到远端',{exact:true}).waitFor()
  failUpload=true
  await page.evaluate(()=>{window.upload().catch(e=>window.uploadError=e.status)})
  await page.getByText('已发送，等待远端保存完成…',{exact:true}).waitFor();uploadResponse()
  await page.getByText('Already exists',{exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>window.uploadError),409)
  failUpload=false
  await page.close();console.log('PASS native unknown status, client writes, save acknowledgement, cancellation and upload progress '+width)
 }
 assert.equal(progressRequests,0,'no server-send progress polling')
} finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
