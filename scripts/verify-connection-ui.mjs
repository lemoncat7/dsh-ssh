// Isolated browser fixture: no live settings, credentials or SSH hosts are touched.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const { chromium } = await import(process.env.SSH_PLAYWRIGHT_MODULE ?? 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const files = (await readdir(new URL('../src/', import.meta.url))).filter(f => /\.tsx?$/.test(f))
const sources = await Promise.all(files.map(f => readFile(new URL(`../src/${f}`, import.meta.url), 'utf8')))
const icons = [...new Set(sources.flatMap(s => s.match(/\bIcon[A-Za-z0-9_]+\b/g) ?? []))]
const bundle = await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {SettingsPane} from './src/settings-pane.tsx';import {ProfileEditor} from './src/profile-editor.tsx';
    window.requests=[];window.saved={allowPublicBind:false,defaultCommandTimeoutMs:30000,maxOutputChars:32000,defaultConnectTimeoutMs:15000,reuseTerminalConnections:false};
    window.fetch=async(path,init={})=>{
      const body=init.body?JSON.parse(init.body):undefined;window.requests.push({path,method:init.method,body});
      if(String(path).endsWith('/settings')&&init.method==='PUT'){await new Promise(r=>setTimeout(r,40));if(window.failSave)return new Response(JSON.stringify({error:'fixture save failed'}),{status:500});window.saved=body;}
      return new Response(JSON.stringify(String(path).endsWith('/settings')?window.saved:{}),{status:200});
    };
    function App(){const [mode,change]=useState('settings');window.show=change;return mode==='settings'?<SettingsPane/>:<ProfileEditor profiles={[]} vaultEntries={[]} proxyEntries={[]} onClose={()=>change('settings')} onSaved={()=>{window.profileSaved=true}}/>}
    createRoot(document.getElementById('root')).render(<App/>);
  ` },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' },
  alias: { react: `${root}/node_modules/react`, ...(process.env.SSH_REACT_DOM_CLIENT ? { 'react-dom/client': process.env.SSH_REACT_DOM_CLIENT } : {}) },
  plugins: [{ name: 'host-ui', setup(b) {
    b.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'host', namespace: 'stub' }))
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ resolveDir: root, contents: `import {createElement} from 'react';export const Modal=({open,children,className})=>open?createElement('div',{role:'dialog',className},children):null;${icons.map(name => `export const ${name}=()=>createElement('svg',{width:16,height:16,'aria-hidden':true});`).join('\n')}` }))
  } }],
})
const css = (await Promise.all(['client.css', 'workbench-pages.css', 'interactive-surfaces.css', 'dialog.css'].map(f => readFile(new URL(`../src/${f}`, import.meta.url), 'utf8')))).join('\n')
const server = createServer((req, res) => {
  if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return }
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(`<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;background:var(--bg,#f6f8fb);color:var(--fg,#1e293b)}#root{min-height:100vh;padding:16px;box-sizing:border-box}.dsh-ssh-dialog-modal{position:fixed;inset:0;overflow:auto}</style><div class="dsh-ssh-workspace" id="root"></div><script src="/app.js"></script>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(process.env.SSH_CHROMIUM ? { executablePath: process.env.SSH_CHROMIUM } : {}) })
try {
  for (const width of [375, 1200]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error('Fixture page error:', e.message) })
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.waitForTimeout(300)
    assert.deepEqual(errors, [])
    assert.ok(await page.locator('input').count(), (await page.locator('body').innerText()).slice(0, 500))
    const timeout = page.getByRole('spinbutton', { name: '默认连接超时', exact: true })
    await timeout.fill('60000'); await timeout.press('Tab')
    await page.waitForFunction(() => window.saved.defaultConnectTimeoutMs === 60000)
    const reuse = page.getByRole('checkbox', { name: /复用终端 SSH 连接/ })
    await reuse.click(); await page.waitForFunction(() => window.saved.reuseTerminalConnections === true)
    assert.equal(await timeout.inputValue(), '60000')
    assert.equal(await page.evaluate(() => window.saved.defaultCommandTimeoutMs), 30000)
    await page.evaluate(() => { window.failSave = true })
    await reuse.click(); await page.getByRole('alert').filter({ hasText: 'fixture save failed' }).waitFor()
    assert.equal(await reuse.isChecked(), true, 'failed save retains confirmed switch')
    await timeout.fill('120001'); await timeout.press('Tab')
    assert.equal(await timeout.evaluate(e => e.validity.valid), false)
    await timeout.fill('60000')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'settings have no horizontal overflow')
    await page.screenshot({ path: `/tmp/ssh-1140-settings-${width}.png`, fullPage: true })
    await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', ''); document.body.style.background = '#20242a'; document.body.style.color = '#e9edf2' })
    await page.screenshot({ path: `/tmp/ssh-1140-settings-dark-${width}.png`, fullPage: true })
    await page.evaluate(() => { document.body.removeAttribute('data-ds-dark-theme'); document.body.style.background = ''; document.body.style.color = '' })
    await page.evaluate(() => { window.failSave = false; window.show('editor') })
    await page.getByRole('combobox', { name: /^SSH 连接超时/ }).selectOption('custom')
    const custom = page.getByRole('spinbutton', { name: '连接超时（ms）', exact: true })
    await custom.fill('60000')
    await page.locator('input[maxlength="80"]').fill('Fixture')
    await page.locator('input[placeholder="server.example.com"]').fill('127.0.0.1')
    await page.locator('input[autocomplete="username"]').fill('fixture')
    await page.locator('input[type="password"]').fill('fixture-only')
    // Test the real editor payload without connecting to any saved host.
    await page.getByRole('button', { name: '测试连接', exact: true }).click()
    await page.waitForFunction(() => window.requests.some(r => String(r.path).endsWith('/profiles/test-draft')))
    const draft = await page.evaluate(() => window.requests.findLast(r => String(r.path).endsWith('/profiles/test-draft')).body.profile)
    assert.equal(draft.connectTimeoutMs, 60000); assert.equal(draft.useDefaultConnectTimeout, false)
    await page.screenshot({ path: `/tmp/ssh-1140-editor-${width}.png`, fullPage: true })
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('Connection settings/editor verified at 375/1200px: save, failure, validation, draft test payload and layout.')
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
