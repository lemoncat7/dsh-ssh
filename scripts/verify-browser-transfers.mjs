import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { DownloadProgressStore } from '../lib/download-progress.js'

const {chromium} = await import(process.env.SSH_PLAYWRIGHT_MODULE ?? 'playwright')
const root=fileURLToPath(new URL('../',import.meta.url))
const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';
import {BrowserTransferStatus} from './src/browser-transfer-status.tsx';
import {trackDownloadClick} from './src/browser-transfers.ts';
import {uploadProfileSftpFile} from './src/client-api.ts';
window.upload=()=>uploadProfileSftpFile('test','/',new File([new Uint8Array(1024*1024)],'upload.bin'));
createRoot(document.getElementById('root')).render(<><a href='/ssh-local/v1/file-transfer/download?path=/demo.bin' download onClick={trackDownloadClick}>download</a><BrowserTransferStatus/></>);
`},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'icons',setup(b){b.onResolve({filter:/^@deepseek-ai\/dsh-client-ui-primitives$/},()=>({path:'icons',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({resolveDir:root,contents:`import React from 'react';export const IconCloseOutline16=()=> <svg width='14' height='14'/>`,loader:'tsx'}))}}]})
const css=await readFile(root+'src/client.css','utf8')
const store=new DownloadProgressStore()
let uploadResponse, failUpload=false
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost')
 if(url.pathname==='/bundle.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundle.outputFiles[0].text)}
 if(url.pathname.endsWith('/download-progress')){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(store.get(url.searchParams.get('id'))))}
 if(url.pathname.endsWith('/download')){
  const progress=store.track(url.searchParams.get('transferId'),res);res.setHeader('Content-Length',65536*16);res.setHeader('Content-Disposition','attachment; filename="demo.bin"');
  let count=0;const timer=setInterval(()=>{res.write(Buffer.alloc(65536));if(++count===16){clearInterval(timer);res.end();progress.complete()}},150);res.on('close',()=>clearInterval(timer));return
 }
 if(url.pathname.endsWith('/upload')){req.resume();req.on('end',()=>{uploadResponse=()=>{res.statusCode=failUpload?409:201;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(failUpload?{error:'Already exists'}:{path:'/upload.bin',name:'upload.bin',size:1048576}))}});return}
 res.setHeader('Content-Type','text/html');res.end(`<html><meta name="viewport" content="width=device-width"><style>${css}</style><body><div id="root" class="dsh-ssh-workspace"></div><script src="/bundle.js"></script></body></html>`)
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const browser=await chromium.launch({headless:true,args:['--no-sandbox']})
try {
 for(const width of [375,1024]){
  const page=await browser.newPage({viewport:{width,height:650},acceptDownloads:true});await page.goto(`http://127.0.0.1:${server.address().port}`)
  if(width===1024)await page.evaluate(()=>document.body.setAttribute('data-ds-dark-theme',''))
  const download=page.waitForEvent('download');await page.getByRole('link',{name:'download',exact:true}).click();const file=await download
  await page.waitForFunction(()=>{const p=document.querySelector('[role=progressbar]');return p&&Number(p.getAttribute('aria-valuenow'))>0&&Number(p.getAttribute('aria-valuenow'))<100})
  await page.screenshot({path:`/tmp/ssh-browser-transfer-${width}.png`})
  assert.equal(await file.failure(),null)
  await page.getByText('传输完成，保存结果请查看浏览器下载列表',{exact:true}).waitFor()
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
  await page.close();console.log('PASS streamed download and acknowledged upload progress '+width)
 }
} finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
