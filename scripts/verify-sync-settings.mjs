// Real React/xterm/UI primitives, isolated HTTP fixture. No real host or saved data is modified.
// SSH_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/verify-workbench.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const { chromium } = await import(process.env.SSH_PLAYWRIGHT_MODULE ?? 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const bundle = await build({
  nodePaths: (process.env.DSH_UI_TEST_NODE_PATH ?? '').split(':').filter(Boolean),
  alias: { react: `${root}node_modules/react` },
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {RemoteWorkspace,installStyles} from './src/client.tsx';
    installStyles(); let selected='a'; const listeners=new Set(); const controller={selected:()=>selected,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},close:()=>{},open:id=>{selected=id;listeners.forEach(fn=>fn())}};
    const sessions={current:'test'}; const workspaces={items:[],recentWorkspaceId:undefined};
    const root=createRoot(document.getElementById('root'));window.unmountWorkspace=()=>root.unmount();root.render(<RemoteWorkspace controller={controller} useSessions={fn=>fn(sessions)} useWorkspaces={fn=>fn(workspaces)}/>);`, resolveDir: root, loader: 'tsx' },
  bundle: true, write: false, outdir: '/tmp/ssh-workbench-fixture', platform: 'browser', format: 'iife', jsx: 'automatic',
  loader: { '.css': 'text', '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
  plugins: [{ name: 'fixture-exports', setup(b) {
    b.onLoad({ filter: /\/src\/client\.tsx$/ }, async args => ({ loader: 'tsx', contents: (await readFile(args.path, 'utf8')).replace('function RemoteWorkspace(', 'export function RemoteWorkspace(').replace('function installStyles(', 'export function installStyles(') }))
    b.onLoad({ filter: /\.module\.css$/ }, async args => ({ loader: 'local-css', contents: await readFile(args.path, 'utf8') }))
  } }],
})
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text
const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? ''
const server = createServer((req, res) => {
  if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(js); return }
  res.setHeader('Content-Type', 'text/html')
  res.end(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}body{margin:0;background:#e8edef}html[data-theme=dark] body{background:#161d20}#root{height:100dvh}button{cursor:pointer}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true, executablePath: process.env.SSH_CHROMIUM, args: ['--no-sandbox'] })
let currentPage
try {
  for (const width of [375, 1024, 1600]) for (const colorScheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 950 }, colorScheme, reducedMotion: 'reduce' })
    currentPage = page
    const errors = [], writes = []
    page.on('pageerror', error => errors.push(error.message))
    let gist = { autoSync: false, strategy: 'smart', backupRetention: 5, tokenConfigured: false, encryptionConfigured: false, running: false, oauthAvailable: false }
    let settings = { allowPublicBind: false, defaultCommandTimeoutMs: 30000, maxOutputChars: 32000 }
    let failAuth = true, failConfig = false, oauthPolls = 0
    await page.addInitScript(() => { window.EventSource = undefined })
    await page.route('**/ssh-local/v1/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname.replace('/ssh-local/v1', ''), method = req.method()
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      if (method !== 'GET') writes.push(path)
      if (path === '/settings') { if (method === 'PUT') settings = JSON.parse(req.postData()); return json(settings) }
      if (path === '/gist-sync') {
        if (method === 'PUT') {
          if (failConfig) { failConfig = false; return json({ error: '保存暂时失败，请重试' }, 500) }
          const body = JSON.parse(req.postData())
          gist = { ...gist, ...body.settings, ...(body.token ? { tokenConfigured: true } : {}), ...(body.encryptionPassphrase ? { encryptionConfigured: true } : {}) }
        }
        return json(gist)
      }
      if (path === '/gist-sync/account/test') {
        if (failAuth) { failAuth = false; return json({ error: '令牌无效，请重新输入' }, 401) }
        gist.githubLogin = 'fixture-user'; return json({ login: 'fixture-user' })
      }
      if (path === '/gist-sync/run') { gist = { ...gist, gistId: 'abc123', gistUrl: 'https://gist.github.com/fixture/abc123', lastSyncAt: Date.now(), lastResult: 'uploaded' }; return json(gist) }
      if (path === '/gist-sync/oauth/start') return json({ id: 'fixture-flow', userCode: 'TEST-CODE', verificationUri: 'https://github.com/login/device', expiresAt: Date.now() + 60000, retryAfterMs: 1000 })
      if (path === '/gist-sync/oauth/poll') { oauthPolls++; gist = { ...gist, tokenConfigured: true, githubLogin: 'oauth-user' }; return json({ state: 'complete', login: 'oauth-user' }) }
      if (path === '/gist-sync/oauth/disconnect') { gist.tokenConfigured = false; return json(gist) }
      if (path === '/gist-sync/network/test') return json({ route: 'proxy' })
      if (path === '/forwards') return json({ rules: [], statuses: [] })
      if (path.startsWith('/injections')) return json(null)
      return json([])
    })
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    if (colorScheme === 'dark') await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', ''); document.body.style.background = '#161d20' })
    await page.getByRole('tab', { name: '设置', exact: true }).click()
    assert.equal(await page.getByText('GitHub Gist', { exact: true }).count(), 0)
    await page.getByRole('tab', { name: '同步', exact: true }).click()
    await page.getByRole('button', { name: '开始配置', exact: true }).waitFor()
    assert.equal(await page.getByLabel('两端配置变化时', { exact: false }).inputValue(), 'smart')
    assert.equal(await page.getByRole('button', { name: /WebDAV/ }).isDisabled(), true)
    assert.equal(await page.getByLabel('GitHub 访问令牌', { exact: false }).count(), 0, 'authorization fields belong in the dialog')
    await page.screenshot({ path: `/tmp/ssh-sync-page-${width}-${colorScheme}.png` })
    await page.getByRole('button', { name: '开始配置', exact: true }).click()
    const dialog = page.locator('.dsh-ssh-sync-dialog')
    await dialog.waitFor()
    assert.equal(await dialog.evaluate(el => getComputedStyle(el).borderRadius), width <= 680 ? '22px' : '24px')
    await page.getByRole('button', { name: '验证并继续', exact: true }).click()
    assert.equal(writes.length, 0, 'empty token cannot be submitted')
    await page.getByLabel('GitHub 访问令牌', { exact: false }).fill('ghp_fixture')
    await page.screenshot({ path: `/tmp/ssh-sync-wizard-${width}-${colorScheme}.png` })
    await page.getByRole('button', { name: '验证并继续', exact: true }).click()
    await page.getByText('令牌无效，请重新输入', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('同步加密密码', { exact: false }).count(), 0, 'failed authorization stays on first step')
    await page.getByLabel('GitHub 访问令牌', { exact: false }).fill('ghp_fixture_retry')
    await page.getByRole('button', { name: '验证并继续', exact: true }).click()
    await page.getByLabel('同步加密密码', { exact: false }).waitFor()
    await page.getByRole('button', { name: '继续', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: '完成配置', exact: true }).count(), 0, 'password is required')
    await page.getByLabel('同步加密密码', { exact: false }).fill('fixture-password')
    await page.getByRole('button', { name: '使用已有空间', exact: true }).click()
    await page.getByRole('button', { name: '继续', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: '完成配置', exact: true }).count(), 0, 'existing Gist ID is required')
    await page.getByLabel('Gist ID', { exact: false }).fill('abcdef123')
    await page.getByRole('button', { name: '继续', exact: true }).click()
    await page.getByRole('button', { name: '完成配置', exact: true }).waitFor()
    await page.getByRole('button', { name: '上一步', exact: true }).click()
    assert.equal(await page.getByLabel('同步加密密码', { exact: false }).inputValue(), 'fixture-password')
    await page.getByRole('button', { name: '继续', exact: true }).click()
    failConfig = true
    await page.getByRole('button', { name: '完成配置', exact: true }).click()
    await page.getByText('保存暂时失败，请重试', { exact: true }).waitFor()
    await page.getByRole('button', { name: '完成配置', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(gist.gistId, 'abcdef123'); assert.equal(gist.encryptionConfigured, true)
    await page.getByLabel('两端配置变化时', { exact: false }).selectOption('local-first')
    await page.getByRole('tab', { name: '设置', exact: true }).click()
    await page.getByRole('tab', { name: '同步', exact: true }).click()
    assert.equal(await page.getByLabel('两端配置变化时', { exact: false }).inputValue(), 'local-first', 'switching pages retains unsaved policy')
    await page.getByRole('button', { name: '保存同步设置', exact: true }).click()
    await page.getByText('同步设置已保存', { exact: false }).waitFor()
    assert.equal(gist.strategy, 'local-first')
    await page.getByRole('button', { name: '立即同步', exact: true }).click()
    await page.getByRole('link', { name: '查看云端配置', exact: true }).waitFor()
    await page.getByRole('button', { name: '管理配置', exact: true }).click()
    await page.getByRole('button', { name: '更换或重新授权', exact: true }).click()
    await page.getByRole('button', { name: '浏览器授权', exact: true }).click()
    await page.getByLabel('GitHub OAuth Client ID', { exact: false }).fill('fixture-client')
    await page.getByRole('button', { name: '获取授权码', exact: true }).click()
    await page.getByText('TEST-CODE', { exact: true }).waitFor()
    await page.getByLabel('同步加密密码', { exact: false }).waitFor()
    assert.ok(oauthPolls >= 1)
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    await page.getByText('GitHub 网络与代理', { exact: true }).click()
    await page.getByLabel('GitHub 出站代理', { exact: false }).fill('socks5://127.0.0.1:7893')
    settings.maxOutputChars = 64000
    await page.getByRole('button', { name: '保存代理并测试网络', exact: true }).click()
    await page.getByText(/GitHub 网络连接成功/).waitFor()
    assert.equal(settings.maxOutputChars, 64000, 'network save preserves current runtime settings')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    assert.deepEqual(errors, [])
    console.log(`PASS ${width}px ${colorScheme}: setup, retry, validation, OAuth, policy, theme, layout`)
    await page.close()
  }
} catch (error) {
  if (currentPage && !currentPage.isClosed()) { await currentPage.screenshot({ path: '/tmp/ssh-sync-failure.png' }); console.error((await currentPage.locator('body').innerText()).slice(-4000)) }
  throw error
} finally { await browser.close(); server.close() }
