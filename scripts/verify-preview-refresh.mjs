import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const { chromium } = await import(process.env.SSH_PLAYWRIGHT_MODULE ?? 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const htmlFixture = `<html><head><meta http-equiv="refresh" content="0;url=https://preview-denied.invalid/redirect"><base href="https://preview-denied.invalid/"><style>body{margin:0;background:#eee;color:#222}p{height:40px}</style></head><body><h1>HTML page</h1><script>parent.previewCompromised=true</script><img src="https://preview-denied.invalid/image" onerror="parent.previewCompromised=true"><iframe src="https://preview-denied.invalid/frame"></iframe><a href="https://preview-denied.invalid/link" target="_top">external</a>${Array.from({length:80},(_,i)=>`<p>HTML paragraph ${i}</p>`).join('')}</body></html>`
const bundle = await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {SftpFilePreview} from './src/sftp-client.tsx';
    window.reads=0;window.stats=0;window.version=1;window.fail=false;
    window.html=${JSON.stringify(htmlFixture)};window.isHtml=location.search.includes('html');
    window.editMode=location.search.includes('edit');window.hash='a'.repeat(64);window.conflict=false;window.savedText=null;
    window.editText='# Heading\\n\\nA **bold** phrase.\\n\\n- first\\n- second\\n\\n| A | B |\\n| --- | --- |\\n| 1 | 2 |\\n';
    const entry={path:'/test.md',name:'test.md',kind:'file',size:100,modifiedAt:1};
    const stat=async()=>{window.stats++; if(window.fail)throw Error('offline');return {...entry,modifiedAt:window.version}};
    const load=async()=>{window.reads++;await new Promise(r=>setTimeout(r,100));return {path:entry.path,name:entry.name,size:100,kind:'text',contentHash:window.editMode?window.hash:undefined,mimeType:window.isHtml?'text/html':'text/markdown',text:window.isHtml?window.html:window.editMode?window.editText:('# Heading\\n\\n'+Array.from({length:200},(_,i)=>'Paragraph '+i+'\\n\\n').join('')+'version '+window.version)}};
    const save=async(input)=>{if(window.conflict||input.expectedHash!==window.hash)throw Error('文件已被其他地方修改');window.savedText=input.text;window.editText=input.text;window.hash='b'.repeat(64);window.version++;return {contentHash:window.hash}};
    const fileUrl=()=>'/file';const app=createRoot(document.getElementById('root'));window.unmount=()=>app.unmount();
    app.render(<SftpFilePreview entry={entry} loadPreview={load} loadPathEntry={stat} fileUrl={fileUrl} saveMarkdown={window.editMode?save:undefined} onBack={()=>{}}/>);
  ` },
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  plugins: [{ name: 'host-stub', setup(b) {
    b.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'host', namespace: 'stub' }))
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ resolveDir: root, contents: `import {createElement} from 'react';
      export const Modal=({open,children,className})=>open?createElement('div',{role:'dialog',className},children):null;
      ${['IconCheckOutline14','IconChevronDownOutline14','IconCloseOutline16','IconDataOutline16','IconFolderOpenOutline16','IconChevronLeftOutline14','IconDownloadOutline16','IconFolderClose16','IconEditOutline16','IconFullscreenOutline16','IconRefreshOutline16','IconSendOutline14','IconTrashOutline16'].map(name=>`export const ${name}=()=>createElement('svg',{width:16,height:16});`).join('')}` }))
  } }],
})
const css = await readFile(new URL('../src/client.css', import.meta.url), 'utf8')
const server = createServer((req,res)=>{
  if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return}
  res.setHeader('Content-Type','text/html');res.end(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0}.dsh-ssh-file-preview{height:500px}.dsh-ssh-preview-modal{position:fixed;inset:0}.dsh-ssh-preview-modal-shell{height:600px}</style><div id="root" class="dsh-ssh-workspace"></div><script src="/app.js"></script>`)
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const browser=await chromium.launch({headless:true,args:['--no-sandbox']})
try {
  const page=await browser.newPage({viewport:{width:375,height:768},reducedMotion:'reduce'})
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByText('version 1',{exact:true}).waitFor()
  const refresh=page.getByRole('button',{name:'刷新预览',exact:true})
  const lock=page.getByRole('button',{name:'自动刷新',exact:true})
  assert.equal(await lock.getAttribute('aria-pressed'),'false')
  const body=page.locator('.dsh-ssh-file-preview-body').first()
  await body.evaluate(el=>{el.scrollTop=800})
  const top=await body.evaluate(el=>el.scrollTop)
  assert.ok(top>0)
  await page.evaluate(()=>window.version++)
  await refresh.click();await page.getByText('version 2',{exact:true}).waitFor()
  assert.equal(await body.evaluate(el=>el.scrollTop),top,'manual refresh preserves scroll')
  await lock.click()
  assert.equal(await lock.getAttribute('aria-pressed'),'true')
  await page.waitForFunction(()=>window.stats>=3,{},{timeout:8000})
  assert.equal(await page.evaluate(()=>window.reads),2,'unchanged metadata avoids rereading')
  await page.evaluate(()=>window.version++)
  await page.getByText('version 3',{exact:true}).waitFor({timeout:8000})
  assert.equal(await body.evaluate(el=>el.scrollTop),top,'auto refresh preserves scroll')
  await lock.click()
  await page.evaluate(()=>window.fail=true)
  await refresh.click();await page.getByRole('status').waitFor()
  assert.equal(await body.evaluate(el=>el.scrollTop),top)
  await page.getByText('version 3',{exact:true}).waitFor()
  await page.evaluate(()=>{window.fail=false;window.version++})
  await page.getByRole('button',{name:'放大预览'}).click()
  const modal=page.getByRole('dialog');const modalBody=modal.locator('.dsh-ssh-file-preview-body')
  await modalBody.evaluate(el=>el.scrollTop=600)
  const modalTop=await modalBody.evaluate(el=>el.scrollTop)
  await modal.getByRole('button',{name:'刷新预览',exact:true}).click()
  await modal.getByText('version 4',{exact:true}).waitFor()
  assert.equal(await modalBody.evaluate(el=>el.scrollTop),modalTop)
  await page.emulateMedia({colorScheme:'dark'});await page.setViewportSize({width:1024,height:768})
  await modal.getByRole('button',{name:'自动刷新',exact:true}).click()
  await page.evaluate(()=>window.unmount())
  const count=await page.evaluate(()=>window.stats)
  await page.waitForTimeout(5300)
  assert.equal(await page.evaluate(()=>window.stats),count,'unmount stops polling')
  assert.deepEqual(errors,[])
  await page.close()
  const htmlPage=await browser.newPage({viewport:{width:375,height:768},reducedMotion:'reduce'})
  const external=[]
  await htmlPage.route('https://preview-denied.invalid/**',route=>{external.push(route.request().url());return route.abort()})
  await htmlPage.goto(`http://127.0.0.1:${server.address().port}/?html`)
  const iframe=htmlPage.locator('.dsh-ssh-html-preview > iframe')
  await htmlPage.frameLocator('.dsh-ssh-html-preview > iframe').getByRole('heading',{name:'HTML page'}).waitFor()
  assert.equal(await iframe.getAttribute('sandbox'),'allow-same-origin','sandbox must never allow scripts')
  assert.equal(await htmlPage.evaluate(()=>window.previewCompromised),undefined)
  assert.equal(await iframe.evaluate(el=>el.contentDocument.querySelectorAll('script,base,iframe,meta[http-equiv="refresh"]').length),0)
  await iframe.evaluate(el=>el.contentWindow.scrollTo(0,700))
  assert.equal(await iframe.evaluate(el=>el.contentWindow.scrollY),700)
  await htmlPage.evaluate(()=>{window.html=window.html.replace('HTML page','Updated HTML');window.version++})
  await htmlPage.getByRole('button',{name:'刷新预览',exact:true}).click()
  await htmlPage.frameLocator('.dsh-ssh-html-preview > iframe').getByRole('heading',{name:'Updated HTML'}).waitFor()
  await htmlPage.waitForFunction(()=>document.querySelector('.dsh-ssh-html-preview > iframe').contentWindow.scrollY===700)
  await htmlPage.getByRole('button',{name:'查看 HTML 源码'}).click()
  assert.ok((await htmlPage.locator('.dsh-ssh-html-preview > pre').innerText()).includes('<script>'),'source is displayed literally')
  await htmlPage.evaluate(()=>{window.html=window.html.replace('Updated HTML','Updated from source');window.version++})
  await htmlPage.getByRole('button',{name:'刷新预览',exact:true}).click()
  await htmlPage.waitForFunction(()=>document.querySelector('.dsh-ssh-html-preview > pre')?.textContent.includes('Updated from source'))
  await htmlPage.getByRole('button',{name:'查看 HTML 源码'}).click()
  assert.equal(await iframe.evaluate(el=>el.contentWindow.scrollY),700)
  assert.equal(await htmlPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await htmlPage.screenshot({path:'/tmp/ssh-html-preview-mobile.png'})
  await htmlPage.setViewportSize({width:1024,height:768});await htmlPage.emulateMedia({colorScheme:'dark'})
  await htmlPage.getByRole('button',{name:'放大预览'}).click()
  await htmlPage.getByRole('dialog').locator('.dsh-ssh-html-preview > iframe').waitFor()
  await htmlPage.screenshot({path:'/tmp/ssh-html-preview-desktop.png'})
  assert.deepEqual(external,[],'HTML preview must not contact external resources')
  await htmlPage.close()
  const editPage=await browser.newPage({viewport:{width:375,height:768},reducedMotion:'reduce'})
  const editErrors=[];editPage.on('pageerror',error=>editErrors.push(error.message))
  await editPage.goto(`http://127.0.0.1:${server.address().port}/?edit`)
  const editor=editPage.getByRole('textbox',{name:'Markdown 正文'}).first()
  await editor.waitFor()
  assert.equal(await editor.getAttribute('contenteditable'),'true')
  const save=editPage.getByRole('button',{name:'保存 Markdown',exact:true})
  assert.equal(await save.isDisabled(),true,'opening rich Markdown must not mark the file dirty')
  await editor.locator('p').first().click();await editPage.keyboard.press('End');await editPage.keyboard.type(' Edited')
  assert.equal(await save.isEnabled(),true)
  assert.equal(await editPage.getByRole('button',{name:'刷新预览',exact:true}).isDisabled(),true)
  assert.equal(await editPage.getByRole('button',{name:'自动刷新',exact:true}).isDisabled(),true)
  await editPage.keyboard.press('Control+s')
  await editPage.waitForFunction(()=>window.savedText?.includes(' Edited'))
  const saved=await editPage.evaluate(()=>window.savedText)
  assert.ok(saved.includes('# Heading'));assert.ok(saved.includes('**bold**'));assert.ok(saved.includes('|'))
  await editPage.waitForFunction(()=>!document.querySelector('button[aria-label="自动刷新"]').disabled)
  await editPage.getByRole('button',{name:'自动刷新',exact:true}).click()
  assert.equal(await editor.getAttribute('contenteditable'),'false')
  await editPage.getByRole('button',{name:'自动刷新',exact:true}).click()
  await editor.locator('p').first().click();await editPage.keyboard.press('End');await editPage.keyboard.type(' Draft')
  await editPage.evaluate(()=>window.conflict=true)
  await save.click();await editPage.getByRole('status').filter({hasText:'保存失败'}).waitFor()
  assert.ok((await editor.innerText()).includes(' Draft'))
  await editPage.getByRole('button',{name:'放大预览',exact:true}).click()
  await editPage.getByRole('dialog').getByRole('textbox',{name:'Markdown 正文'}).waitFor()
  await editPage.screenshot({path:'/tmp/ssh-markdown-edit-mobile.png'})
  await editPage.evaluate(()=>window.unmount())
  await editPage.goto(`http://127.0.0.1:${server.address().port}/?edit`)
  await editPage.getByRole('status').filter({hasText:'草稿'}).waitFor()
  assert.ok((await editPage.getByRole('textbox',{name:'Markdown 正文'}).innerText()).includes(' Draft'))
  assert.deepEqual(editErrors,[])
  await editPage.evaluate(()=>window.unmount());await editPage.close()
  console.log('PASS: Markdown direct editing, structured save, shortcut, readonly auto mode, dirty guards, conflict retention and draft recovery')
  console.log('PASS: HTML rendering, script/network isolation, refresh scroll and source toggle')
  console.log('PASS: manual/locked refresh, unchanged-file skip, scroll preservation, failure retention, modal and cleanup')
} finally {await browser.close();await new Promise(resolve=>server.close(resolve))}
