// Real transfer workspace, modal and icons with mocked transport. No remote writes.
// SSH_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node scripts/verify-ftp-directory.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const { chromium } = await import(process.env.SSH_PLAYWRIGHT_MODULE ?? 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const bundle = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {FileTransferWorkspace} from './src/file-transfer-workspace.tsx';
    createRoot(document.getElementById('root')).render(<FileTransferWorkspace ftpProfiles={[]} vaultEntries={[]} proxyEntries={[]} access={{value:null}} onProfilesChanged={()=>{}}/>);`, resolveDir: root, loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  outdir: '/tmp/ssh-ftp-fixture-bundle',
  loader: { '.css': 'css', '.module.css': 'local-css', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
})
const css = [bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '', ...(await Promise.all(['client.css', 'file-transfer-workspace.css'].map(name => readFile(root + 'src/' + name, 'utf8'))))].join('\n')
const server = createServer((req, res) => {
  if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return }
  res.setHeader('Content-Type', 'text/html')
  res.end(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}#root{height:100vh}${css}</style></head><body><div id="root" class="dsh-ssh-workspace"></div><script src="/bundle.js"></script></body></html>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
try {
  for (const dark of [false, true]) for (const width of [375, 697, 1024]) {
    const page = await browser.newPage({ viewport: { width, height: 768 }, reducedMotion: 'reduce' })
    page.setDefaultTimeout(10000)
    const errors = [], requests = []
    page.on('pageerror', error => errors.push(error.message))
    const entries = Array.from({ length: 10000 }, (_, i) => ({ name: `file-${i}.txt`, path: `/file-${i}.txt`, kind: 'file', size: i, modifiedAt: 1 }))
    const longName = 'DSG_V5.0.1_R211B089_oe2203_x86_64.txt'
    const longPath = '/Product_Warehouse_CICD/BigData_Security/DSG/OneTrunk/20260908/DSG/oe2203_x86_64/' + longName
    entries.push({name:longName,path:longPath,kind:'file',size:0,modifiedAt:1})
    entries.push({ name: '0-shortcut', path: '/0-shortcut', kind: 'symlink', size: 4, modifiedAt: 1 })
    await page.route('**/ssh-local/v1/**', async route => {
      const url = new URL(route.request().url())
      const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      if (url.pathname.endsWith('/endpoints')) return json([{ id: 'ftp:test', name: 'Test FTP', kind: 'ftp', protocol: 'ftp', address: 'test', initialPath: '/' }])
      if (url.pathname.endsWith('/jobs')) return json([])
      if (url.pathname.endsWith('/stat')) {
        const path = url.searchParams.get('path')
        return json({ name: path.split('/').at(-1), path, kind: 'symlink', navigable: path === '/0-shortcut', size: 4 })
      }
      if (url.pathname.endsWith('/directory')) {
        const path = url.searchParams.get('path')
        requests.push(path)
        return json(path === '/0-shortcut' ? { path: '/docs', parent: '/', entries: [] } : { path: '/', parent: null, entries })
      }
      throw new Error(`Unexpected request: ${url.pathname}`)
    })
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.evaluate(dark => document.body.toggleAttribute('data-ds-dark-theme', dark), dark)
    await page.getByRole('button', { name: /Test FTP/ }).first().click()
    const link = page.getByRole('row', { name: '0-shortcut，单击查看', exact: true })
    await link.waitFor()
    assert.ok(await page.locator('.dsh-ssh-file-row').count() <= 56, 'large listing stays virtualized')
    assert.equal(await link.getAttribute('draggable'), 'false', 'unverified links cannot be transferred as directories')
    assert.equal(await link.getByRole('link', { name: '下载 0-shortcut 到本地' }).count(), 1)
    await page.getByRole('row', { name: 'file-0.txt', exact: true }).click()
    await page.getByRole('dialog').waitFor()
    assert.equal(await page.getByRole('dialog').getByRole('link', { name: '下载到本地' }).count(), 1)
    assert.deepEqual(requests, ['/'], 'opening a file does not list it as a directory')
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await page.getByRole('row', {name:longName,exact:true}).click()
    const download = page.getByRole('dialog').getByRole('link', {name:'下载到本地'})
    await download.waitFor()
    const layout = await download.evaluate(a => {
      const r=a.getBoundingClientRect(), icon=a.querySelector('svg'), text=a.querySelector('span'), dialog=a.closest('.dsh-ssh-dialog');
      const i=icon.getBoundingClientRect(), t=text.getBoundingClientRect(), d=dialog.getBoundingClientRect();
      return {width:r.width,height:r.height,iconWidth:i.width,iconHeight:i.height,textHeight:t.height,nowrap:getComputedStyle(a).whiteSpace,stroke:getComputedStyle(icon).stroke,fill:getComputedStyle(icon).fill,fits:r.right<=d.right&&r.left>=d.left&&d.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,overflow:dialog.scrollWidth>dialog.clientWidth+1,href:a.getAttribute('href')}
    })
    assert.equal(layout.iconWidth,16);assert.equal(layout.iconHeight,16)
    assert.equal(layout.nowrap,'nowrap');assert.ok(layout.textHeight<=20);assert.ok(layout.height>=44)
    assert.equal(layout.fill,'none');assert.notEqual(layout.stroke,'none');assert.equal(layout.fits,true);assert.equal(layout.overflow,false)
    assert.ok(layout.href.includes(encodeURIComponent(longPath)))
    await page.screenshot({path:`/tmp/ssh-ftp-file-dialog-${width}-${dark?'dark':'light'}.png`})
    await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click()
    await page.getByRole('dialog').waitFor({state:'hidden'})
    await link.focus(); await link.press('Enter')
    await page.waitForFunction(() => document.querySelector('input[aria-label="远端路径"]')?.value === '/docs')
    assert.deepEqual(requests, ['/', '/0-shortcut'])
    await page.getByRole('button', { name: '上一级目录' }).first().click()
    await link.waitFor()
    await link.click()
    await page.waitForFunction(() => document.querySelector('input[aria-label="远端路径"]')?.value === '/docs')
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ width, dark, entries: entries.length, virtualized: true, mouseAndKeyboardNavigation: true, downloadDialog:layout }))
    await page.close()
  }
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
