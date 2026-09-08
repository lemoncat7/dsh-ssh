// Real transfer workspace with mocked transport and host icons. No remote writes.
// SSH_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node scripts/verify-ftp-directory.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const { chromium } = await import(process.env.SSH_PLAYWRIGHT_MODULE ?? 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const sources = await Promise.all((await readdir(root + 'src')).filter(name => name.endsWith('.tsx')).map(name => readFile(root + 'src/' + name, 'utf8')))
const icons = [...new Set(sources.join('\n').match(/\bIcon\w+/g))]
const bundle = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {FileTransferWorkspace} from './src/file-transfer-workspace.tsx';
    createRoot(document.getElementById('root')).render(<FileTransferWorkspace ftpProfiles={[]} vaultEntries={[]} proxyEntries={[]} access={{value:null}} onProfilesChanged={()=>{}}/>);`, resolveDir: root, loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  plugins: [{ name: 'host-primitives', setup(b) {
    b.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'primitives', namespace: 'fixture' }))
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const Modal=()=>null; ${icons.map(n => `export const ${n}=()=>null;`).join('')}` }))
  } }],
})
const css = (await Promise.all(['client.css', 'file-transfer-workspace.css'].map(name => readFile(root + 'src/' + name, 'utf8')))).join('\n')
const server = createServer((req, res) => {
  if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return }
  res.setHeader('Content-Type', 'text/html')
  res.end(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}#root{height:100vh}${css}</style></head><body><div id="root" class="dsh-ssh-workspace"></div><script src="/bundle.js"></script></body></html>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
try {
  for (const width of [375, 1024]) {
    const page = await browser.newPage({ viewport: { width, height: 768 }, reducedMotion: 'reduce' })
    page.setDefaultTimeout(10000)
    const errors = [], requests = []
    page.on('pageerror', error => errors.push(error.message))
    const entries = Array.from({ length: 10000 }, (_, i) => ({ name: `file-${i}.txt`, path: `/file-${i}.txt`, kind: 'file', size: i, modifiedAt: 1 }))
    entries.push({ name: '0-shortcut', path: '/0-shortcut', kind: 'symlink', size: 4, modifiedAt: 1 })
    await page.route('**/ssh-local/v1/**', async route => {
      const url = new URL(route.request().url())
      const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      if (url.pathname.endsWith('/endpoints')) return json([{ id: 'ftp:test', name: 'Test FTP', kind: 'ftp', protocol: 'ftp', address: 'test', initialPath: '/' }])
      if (url.pathname.endsWith('/jobs')) return json([])
      if (url.pathname.endsWith('/directory')) {
        const path = url.searchParams.get('path')
        requests.push(path)
        return json(path === '/0-shortcut' ? { path: '/docs', parent: '/', entries: [] } : { path: '/', parent: null, entries })
      }
      throw new Error(`Unexpected request: ${url.pathname}`)
    })
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.getByRole('button', { name: /Test FTP/ }).first().click()
    const link = page.getByRole('row', { name: '0-shortcut，单击尝试进入目录', exact: true })
    await link.waitFor()
    assert.ok(await page.locator('.dsh-ssh-file-row').count() <= 56, 'large listing stays virtualized')
    assert.equal(await link.getAttribute('draggable'), 'false', 'unverified links cannot be transferred as directories')
    await link.focus(); await link.press('Enter')
    await page.waitForFunction(() => document.querySelector('input[aria-label="远端路径"]')?.value === '/docs')
    assert.deepEqual(requests, ['/', '/0-shortcut'])
    await page.getByRole('button', { name: '上一级目录' }).first().click()
    await link.waitFor()
    await link.click()
    await page.waitForFunction(() => document.querySelector('input[aria-label="远端路径"]')?.value === '/docs')
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ width, entries: entries.length, virtualized: true, mouseAndKeyboardNavigation: true }))
    await page.close()
  }
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
