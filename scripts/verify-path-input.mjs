// Isolated interaction check: real explorer and React, stub host icons/modal and HTTP data.
// SSH_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node scripts/verify-path-input.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'

const { chromium } = await import(process.env.SSH_PLAYWRIGHT_MODULE ?? 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const icons = ['IconCheckOutline14', 'IconChevronDownOutline14', 'IconCloseOutline16', 'IconDataOutline16',
  'IconChevronLeftOutline14', 'IconDownloadOutline16', 'IconFolderClose16', 'IconEditOutline16',
  'IconFullscreenOutline16', 'IconRefreshOutline16', 'IconSendOutline14', 'IconTrashOutline16']
const bundle = await build({
  stdin: { contents: `import React, {useState, useCallback} from 'react'; import {createRoot} from 'react-dom/client';
    import {ActivitySftpBrowser, LocalWorkspaceBrowser} from './src/sftp-client.tsx';
    function App() { const [id,setId]=useState('a'); const saved=useCallback(async()=>{window.saved=(window.saved||0)+1},[]);
      const profiles=['a','b'].map(id=>({id,name:id,username:'user',host:'test',port:22,cwd:'/work'}));
      return location.search.includes('remote') ? <ActivitySftpBrowser sessionId="test" profile={profiles.find(p=>p.id===id)} profiles={profiles} onProfile={setId} onSaved={saved}/> : <LocalWorkspaceBrowser sessionId="test"/>;
    } createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: root, loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  plugins: [{ name: 'host-primitives', setup(b) {
    b.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'primitives', namespace: 'fixture' }))
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const Modal=()=>null; ${icons.map(n => `export const ${n}=()=>null;`).join('')}` }))
  } }],
})
const css = await readFile(new URL('../src/client.css', import.meta.url), 'utf8')
const server = createServer((req, res) => {
  if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return }
  res.setHeader('Content-Type', 'text/html')
  res.end(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}#root{height:90vh;max-width:500px}${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
const origin = `http://127.0.0.1:${server.address().port}`
try {
  for (const mode of ['local', 'remote']) for (const width of [375, 1024]) {
    const page = await browser.newPage({ viewport: { width, height: 768 }, reducedMotion: 'reduce' })
    const errors = [], requests = []
    let releaseSlow
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/ssh-local/v1/**', async route => {
      const url = new URL(route.request().url()), path = url.searchParams.get('path') ?? '/work'
      requests.push({ route: url.pathname, path, method: route.request().method() })
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      if (url.pathname.endsWith('stat')) {
        if (path.endsWith('/slow.md')) await new Promise(resolve => { releaseSlow = resolve })
        if (path.endsWith('/missing')) return json({ error: '路径不存在，请检查后重试' }, 404)
        return json({ path, name: path.split('/').at(-1), kind: path.endsWith('.md') || path.endsWith('/README') ? 'file' : 'directory', size: 12, modifiedAt: 1 })
      }
      if (url.pathname.endsWith('/directory') && route.request().method() === 'PUT') return json({ cwd: JSON.parse(route.request().postData()).cwd })
      if (url.pathname.endsWith('/local-file') || url.pathname.endsWith('/file')) return json({ path, name: path.split('/').at(-1), kind: 'text', mimeType: 'text/markdown', text: '# File opened', size: 12 })
      return json({ path, parent: path === '/work' ? null : '/work', entries: [] })
    })
    await page.goto(origin + '/?' + mode)
    const input = page.getByRole('textbox', { name: '目录或文件路径' })
    await page.waitForFunction(() => document.querySelector('input[aria-label="目录或文件路径"]')?.readOnly === false)
    await input.fill('/work/说明 1.md'); await input.press('Enter')
    await page.getByRole('heading', { name: 'File opened' }).waitFor()
    assert.equal(requests.filter(r => r.method === 'PUT').length, 0, 'opening a file must not change session cwd')
    await page.getByRole('button', { name: '返回目录', exact: true }).click()
    assert.equal(await input.inputValue(), '/work')
    await input.fill('README'); await input.press('Enter')
    await page.getByRole('heading', { name: 'File opened' }).waitFor()
    assert.ok(requests.some(r => r.path === '/work/README' && r.route.endsWith('stat')))
    await page.getByRole('button', { name: '返回目录', exact: true }).click()
    await input.fill('nested'); await input.press('Enter')
    await page.waitForFunction(() => { const e=document.querySelector('input[aria-label="目录或文件路径"]'); return e?.value==='/work/nested'&&!e.readOnly })
    if (mode === 'remote') assert.equal(await page.evaluate(() => window.saved), 1)
    await input.fill('missing'); await input.press('Enter')
    await page.getByRole('alert').filter({ hasText: '路径不存在' }).waitFor()
    assert.equal(await input.inputValue(), 'missing')
    assert.equal(await input.getAttribute('aria-invalid'), 'true')
    // IME confirmation must not submit the path before composition has finished.
    const count = requests.length
    await input.fill('中文')
    await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true })
    await page.waitForTimeout(60)
    assert.equal(requests.length, count)
    if (mode === 'remote') {
      await input.fill('/work/slow.md'); await input.press('Enter')
      for (let i=0;i<50&&!releaseSlow;i++) await page.waitForTimeout(10)
      assert.ok(releaseSlow)
      await page.getByLabel('选择远端主机').selectOption('b')
      releaseSlow()
      await page.waitForFunction(() => document.querySelector('input[aria-label="目录或文件路径"]')?.readOnly === false)
      await page.waitForTimeout(100)
      assert.equal(await page.getByRole('heading', { name: 'File opened' }).count(), 0, 'stale file must not open on another host')
    }
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ mode, width, passed: true }))
    await page.close()
  }
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
