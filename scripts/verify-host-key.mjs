// Isolated UI fixture: no real hosts, credentials or trust records are changed.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
const { chromium } = await import(process.env.SSH_PLAYWRIGHT_MODULE ?? 'playwright')
const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'tsx', contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {ProfileEditor} from './src/profile-editor';const host={id:'host',name:'Target',host:'localhost',port:22,username:'test',authType:'password',proxy:{type:'none'},tags:[],hostFingerprint:'SHA256:old',credential:{configured:true,fields:['password']}};createRoot(document.getElementById('root')).render(<ProfileEditor profile={host} profiles={[host,{...host,id:'jump',name:'Jump',host:'jump.local'}]} vaultEntries={[]} proxyEntries={[]} onClose={()=>{}} onSaved={()=>{}}/>);` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.css': 'text', '.module.css': 'text' } })
const server = createServer((req,res) => { res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html');res.end(req.url === '/app.js' ? bundle.outputFiles[0].text : '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/app.js"></script>') })
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const browser=await chromium.launch({headless:true,args:['--no-sandbox']})
try {
 const page=await browser.newPage()
 let jump=false, confirmed=false, saved, confirms=0
 await page.route('**/ssh-local/v1/**',async route=>{
   const url=route.request().url(),body=route.request().postDataJSON()
   if(url.endsWith('/confirm-host')) { assert.ok(url.endsWith('/jump/confirm-host'));assert.equal(body.previousFingerprint,'SHA256:old');confirmed=true;confirms++;return route.fulfill({json:{}}) }
   if(url.endsWith('/test-draft')) {
     if(jump ? confirmed : body.profile.hostFingerprint==='SHA256:new') return route.fulfill({json:{ok:true}})
     return route.fulfill({status:409,json:{code:'HOST_KEY_REQUIRED',profileId:jump?'jump':'host',profileName:jump?'Jump':'Target',previousFingerprint:'SHA256:old',fingerprint:'SHA256:new'}})
   }
   saved=body;return route.fulfill({json:{}})
 })
 const css=await readFile(new URL('../src/client.css',import.meta.url),'utf8')
 for(const width of [375,844,1440]) {
   await page.setViewportSize({width,height:900})
   await page.goto(`http://127.0.0.1:${server.address().port}`)
   await page.addStyleTag({content:css})
   await page.getByRole('button',{name:'测试连接',exact:true}).click()
   await page.getByText('主机指纹已变化',{exact:true}).waitFor()
   assert.equal(await page.locator('.dsh-ssh-test-result code').count(),2)
   const warning=page.locator('.dsh-ssh-test-result.is-warning')
   assert.equal(await warning.evaluate(el=>el.scrollWidth>el.clientWidth),false)
   await page.getByRole('button',{name:'已核实，确认并重试',exact:true}).click()
   await page.getByRole('button',{name:'保存连接',exact:true}).click()
   assert.equal(saved.profile.hostFingerprint,'SHA256:new')
 }
 jump=true
 await page.reload()
 await page.getByRole('button',{name:'测试连接',exact:true}).click()
 await page.getByRole('button',{name:'已核实，确认并重试',exact:true}).click()
 await page.getByRole('button',{name:'保存连接',exact:true}).click()
 assert.equal(confirms,1)
 assert.equal(saved.profile.hostFingerprint,'SHA256:old','jump confirmation must not overwrite target trust')
 console.log('Host key UI: changed key, explicit confirmation, responsive layout and jump identity passed')
} finally {await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
