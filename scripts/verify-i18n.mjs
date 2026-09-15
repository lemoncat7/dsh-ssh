import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const { chromium } = await import(process.env.SSH_PLAYWRIGHT_MODULE ?? 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const sourceFiles = (await readdir(new URL('../src/', import.meta.url))).filter(name => /\.tsx?$/.test(name))
const sources = await Promise.all(sourceFiles.map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))
const icons = [...new Set(sources.flatMap(text => text.match(/\bIcon[A-Za-z0-9_]+\b/g) ?? []))]
const bundle = await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {SuggestionInput,PasswordInput} from './src/ui-components.tsx';
    import {CommandsPanel} from './src/commands-panel.tsx';
    import {RemoteWorkspaceTree} from './src/remote-workspace-tree.tsx';
    import {FileTransferWorkspace} from './src/file-transfer-workspace.tsx';
    import {TerminalWorkspace} from './src/terminal-workspace.tsx';
    import {ProfileSftpPane} from './src/sftp-client.tsx';
    import {bindHostLocale} from './src/ssh-locale-binding.ts';
    import {useSshLocale} from './src/use-ssh-locale.ts';import {t} from './src/i18n.ts';
    let active='zh';const listeners=new Set();
    bindHostLocale({getSnapshot:()=>({active}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}});
    window.changeLanguage=value=>{active=value;for(const fn of listeners)fn()};
    window.calls=[];window.fetch=async(input,init={})=>{const path=String(input);window.calls.push({path,method:init.method??'GET',body:init.body});
      let data=path.endsWith('/terminals')&&init.method==='POST'?{id:'test-terminal'}:[];
      if(path.includes('/sftp/directory?')){const cwd=new URL(path,location.href).searchParams.get('path');data={path:cwd,parent:'/',entries:[{name:'very-long-file-name-to-check-clipping.md',path:cwd+'/very-long-file-name-to-check-clipping.md',kind:'file',size:1024,modifiedAt:1000},{name:'folder',path:cwd+'/folder',kind:'directory',size:0,modifiedAt:1000}]};}
      if(path.includes('/sftp/file?'))data={path:'/file.md',name:'file.md',kind:'text',mimeType:'text/plain',text:'preview body',size:12};
      return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}})};
    const noop=()=>{};const reportDirectory=path=>{window.reportedDirectory=path};const profile={id:'one',name:'生产 主机',host:'127.0.0.1',port:22,username:'user',tags:[],authType:'password',proxy:{type:'none'},credential:{configured:true}};
    const access={sessionId:'session',profileIds:[],permission:'terminal',requireCommandApproval:false,workingDirectories:{},workingProjectIds:{}};
    function App(){useSshLocale();const [value,setValue]=useState('');const [mode,setMode]=useState('inputs');const [cwd,setCwd]=useState('/home');window.cd=setCwd;window.mode=setMode;
      if(mode==='files')return <div style={{width:280,height:650}}><ProfileSftpPane profile={profile} initialPath='/home' terminalPath={cwd} embedded/></div>;
      if(mode==='commands')return <CommandsPanel/>;
      if(mode==='terminal')return <TerminalWorkspace profile={profile} path='/团队/原始目录' onConnected={noop} onDirectory={reportDirectory}/>;
      if(mode==='transfers')return <FileTransferWorkspace ftpProfiles={[]} vaultEntries={[]} proxyEntries={[]} access={access} onProfilesChanged={noop}/>;
      if(mode==='hosts')return <RemoteWorkspaceTree profiles={[profile,{...profile,id:'two',name:'second',group:'未分组'}]} onNewProfile={noop} onSelect={noop} onProfiles={noop} onDirectory={noop}/>;
      return <><SuggestionInput ariaLabel={t('profile-editor.hostTags')} value={value} options={['alpha','beta','运行中']} multiple onChange={setValue}/><PasswordInput aria-label='secret' defaultValue='a-password'/></>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  ` },
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.css': 'empty' },
  plugins: [{ name: 'test-host', setup(b) {
    b.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'host', namespace: 'stub' }))
    b.onResolve({ filter: /terminal-transport\.js$/ }, () => ({ path: 'transport', namespace: 'stub' }))
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => args.path === 'transport' ? ({ contents: `export class TerminalTransport {observe(listener){window.terminalOutputs??=[];window.terminalOutputs.push(listener.output);return()=>{}}sendInput(){}dispose(){}}` }) : ({ resolveDir: root, contents: `import {createElement} from 'react';
      export const Modal=({open,children,className})=>open?createElement('div',{role:'dialog',className},children):null;
      ${icons.map(name => `export const ${name}=()=>createElement('svg',{width:16,height:16,'aria-hidden':true});`).join('\n')}` }))
  } }],
})
const cssNames = ['client.css', 'remote-workspace-tree.css', 'workbench-pages.css', 'file-transfer-workspace.css', 'interactive-surfaces.css']
const css = (await Promise.all(cssNames.map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n')
const server = createServer((req, res) => {
  if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(bundle.outputFiles[0].text); return }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(`<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0}#root{height:700px;padding:12px;box-sizing:border-box}.dsh-ssh-dialog-modal{position:fixed;inset:12px;overflow:auto}</style><div id="root" class="dsh-ssh-workspace"></div><script src="/app.js"></script>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
try {
  for (const width of [375, 1024]) {
    const page = await browser.newPage({ viewport: { width, height: 800 }, reducedMotion: 'reduce' })
    const errors=[];page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    const input = page.getByRole('combobox', { name: '主机标签' })
    await input.fill('al'); await page.getByRole('option', { name: 'alpha', exact: true }).click()
    await input.fill('alpha, be'); await page.getByRole('option', { name: 'beta', exact: true }).click()
    assert.equal(await input.inputValue(), 'alpha, beta')
    await page.evaluate(() => window.changeLanguage('en'))
    assert.equal(await page.getByRole('combobox', { name: 'Host tags' }).inputValue(), 'alpha, beta')
    await page.getByRole('button', { name: 'Show password' }).click()
    assert.equal(await page.getByLabel('secret').inputValue(), 'a-password')
    assert.equal(await page.getByLabel('secret').getAttribute('type'), 'text')
    await page.evaluate(() => window.changeLanguage('zh'))
    assert.equal(await page.getByLabel('secret').getAttribute('type'), 'text')
    await page.getByRole('button', { name: '隐藏密码' }).waitFor()
    await page.evaluate(() => window.mode('commands'))
    await page.getByRole('button', { name: '新建命令', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox').first().fill('部署脚本')
    await dialog.getByRole('textbox').nth(1).fill('echo "生产 原值"')
    await page.evaluate(() => window.changeLanguage('en'))
    await dialog.getByRole('heading', { name: 'New command' }).waitFor()
    assert.equal(await dialog.getByRole('textbox').first().inputValue(), '部署脚本')
    assert.equal(await dialog.getByRole('textbox').nth(1).inputValue(), 'echo "生产 原值"')
    assert.ok(await dialog.getByRole('button', { name: 'Save', exact: true }).isVisible())
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'English command dialog must fit viewport')
    await page.screenshot({ path: `/tmp/ssh-i18n-command-${width}.png` })
    await page.evaluate(() => { window.changeLanguage('zh'); window.mode('hosts') })
    const groups = page.locator('.dsh-ssh-tree-group h3 button')
    assert.equal(await groups.count(), 2, 'user group name must not collide with ungrouped sentinel')
    await groups.first().click()
    await page.evaluate(() => window.changeLanguage('en'))
    assert.equal(await groups.first().getAttribute('aria-expanded'), 'false', 'group collapse survives locale switch')
    assert.ok((await groups.first().innerText()).includes('Ungrouped'))
    assert.ok((await groups.nth(1).innerText()).includes('未分组'), 'never translate user group names')
    await page.evaluate(() => { window.changeLanguage('zh'); window.mode('transfers') })
    await page.getByRole('tab', { name: '任务 1' }).waitFor()
    const stored = await page.evaluate(() => localStorage.getItem('dsh-ssh:file-transfer:tabs:v2'))
    await page.evaluate(() => window.changeLanguage('en'))
    await page.getByRole('tab', { name: 'Tasks 1', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => localStorage.getItem('dsh-ssh:file-transfer:tabs:v2')), stored, 'language must not rewrite saved tab data')
    await page.evaluate(() => { window.changeLanguage('zh'); window.mode('terminal') })
    await page.getByRole('button', { name: '连接', exact: true }).click()
    await page.getByRole('button', { name: '断开', exact: true }).waitFor()
    const before = await page.evaluate(() => window.calls.filter(c => c.method === 'DELETE' || c.method === 'POST').length)
    await page.evaluate(() => window.changeLanguage('en'))
    await page.getByRole('button', { name: 'Disconnect', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.calls.filter(c => c.method === 'DELETE' || c.method === 'POST').length), before, 'locale switch must not reconnect or close terminals')
    await page.evaluate(()=>window.terminalOutputs[0]({data:'\x1b]1337;CurrentDir=/term-a\x07'}))
    await page.waitForFunction(()=>window.reportedDirectory==='/term-a')
    await page.getByRole('button',{name:'New terminal tab',exact:true}).click()
    await page.getByRole('button',{name:'Connect',exact:true}).click()
    await page.waitForFunction(()=>window.terminalOutputs.length===2)
    await page.evaluate(()=>window.terminalOutputs[1]({data:'\x1b]7;file://127.0.0.1/term-b\x07'}))
    await page.waitForFunction(()=>window.reportedDirectory==='/term-b')
    await page.evaluate(()=>window.terminalOutputs[0]({data:'\x1b]1337;CurrentDir=/background\x07'}))
    await page.waitForTimeout(100)
    assert.equal(await page.evaluate(()=>window.reportedDirectory),'/term-b','background terminal must not take over the directory')
    await page.getByRole('tab',{name:'Terminal 1',exact:true}).click()
    await page.waitForFunction(()=>window.reportedDirectory==='/background')
    await page.evaluate(() => { window.changeLanguage('zh'); window.mode('files') })
    const table=page.locator('.dsh-ssh-sftp-table')
    await table.locator('[role="row"]').first().waitFor()
    assert.ok(await table.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'narrow pane must not overflow horizontally')
    assert.ok(await page.locator('.dsh-ssh-sftp-pathbar').first().evaluate(el=>el.scrollWidth<=el.clientWidth+1),'compact follow toolbar must not overflow')
    const download=page.getByRole('link',{name:'下载 very-long-file-name-to-check-clipping.md',exact:true})
    assert.ok((await download.getAttribute('href')).includes('/sftp/download?'))
    await page.mouse.move(0,0)
    assert.equal(await download.evaluate(el=>getComputedStyle(el).opacity),'0','download hidden until row hover/focus')
    await download.locator('xpath=ancestor::*[@data-ssh-context-row]').hover()
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.dsh-ssh-sftp-row-download')).opacity==='1')
    const received=page.waitForEvent('download');await download.click();await received
    assert.equal(await page.getByText('preview body',{exact:true}).count(),0,'download must not open preview')
    const pathInput=page.locator('.dsh-ssh-sftp-pathbar input').first()
    await page.evaluate(()=>window.cd('/changed'))
    await page.waitForFunction(()=>document.querySelector('.dsh-ssh-sftp-pathbar input').value==='/changed')
    await page.getByRole('button',{name:'跟随终端目录',exact:true}).click()
    await page.evaluate(()=>window.cd('/paused'));await page.waitForTimeout(350)
    assert.equal(await pathInput.inputValue(),'/changed')
    await page.getByRole('button',{name:'跟随终端目录',exact:true}).click()
    await page.waitForFunction(()=>document.querySelector('.dsh-ssh-sftp-pathbar input').value==='/paused')
    await table.locator('[role="row"]').first().click()
    await page.getByText('preview body',{exact:true}).waitFor()
    await page.evaluate(()=>window.cd('/while-preview'));await page.waitForTimeout(350)
    assert.equal(await page.getByText('preview body',{exact:true}).count(),1,'follow must not dismiss preview or draft')
    assert.deepEqual(errors, [])
    console.log(`PASS: ${width}px bilingual controls, drafts, groups, stored tabs and live terminal preservation`)
    await page.close()
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
