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
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
let currentPage
try {
  for (const width of [375, 1024, 1600]) for (const colorScheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 950 }, colorScheme, reducedMotion: 'reduce' })
    currentPage = page
    page.setDefaultTimeout(10000)
    const errors = [], inputs = [], closed = []
    let nextTerminal = 0
    let delayNext = false, releaseOpen
    let failSave = false
    let access = { sessionId: 'test', profileIds: ['a'], workingDirectories: {}, workingProjectIds: {}, mountedProjectIds: {}, fileEndpointIds: [], permission: 'exec', filePermission: 'browse', requireCommandApproval: true, requireFileApproval: true, updatedAt: 1 }
    let commands = [{ id: 'one', name: '系统版本', command: 'uname -a', createdAt: 1, updatedAt: 1 }]
    const profiles = ['a', 'b'].map(id => ({ id, name: id === 'a' ? '开发主机' : '测试主机', username: 'developer', host: '192.0.2.' + (id === 'a' ? '10' : '20'), port: 22, tags: [], proxy: { type: 'none' }, terminalType: 'xterm-256color', credential: { configured: true, fields: [], writable: true } }))
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => { window.EventSource = undefined })
    await page.route('**/ssh-local/v1/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname.replace('/ssh-local/v1', ''), method = req.method()
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      if (path === '/profiles') return json(profiles)
      if (path === '/profiles/a/projects') return json([{ id: 'p1', profileId: 'a', name: '应用目录', path: '/srv/app' }, { id: 'p2', profileId: 'a', name: '日志目录', path: '/var/log/app' }])
      if (path === '/profiles/b/projects') return json([])
      if (path === '/ftp-profiles') return json([])
      if (path === '/vault' || path === '/proxies') return json([])
      if (path === '/injections' || path === '/injections/test') { if (method === 'PUT') { if (failSave) { failSave = false; return json({ error: '保存失败，请重试' }, 500) }; access = JSON.parse(req.postData()) }; return json(access) }
      if (path === '/commands') {
        if (method === 'POST') commands.push({ id: 'two', ...JSON.parse(req.postData()), createdAt: 2, updatedAt: 2 })
        return json(method === 'POST' ? commands.at(-1) : commands)
      }
      if (path === '/terminals' && method === 'POST') {
        const id = 't' + (++nextTerminal)
        if (delayNext) await new Promise(resolve => { releaseOpen = resolve })
        return json({ id })
      }
      if (/\/terminals\/t\d+\/output/.test(path)) return json({ cursor: 0, data: '', truncated: false, closed: false })
      if (path.endsWith('/input')) { inputs.push({ path, ...JSON.parse(req.postData()) }); return json({}) }
      if (path.endsWith('/resize')) return json({})
      if (/^\/terminals\/t\d+$/.test(path) && method === 'DELETE') { closed.push(path); return json({}) }
      if (path.endsWith('/sftp/directory')) return json({ path: '/srv/app', parent: '/', entries: [] })
      if (path === '/forwards') return json({ rules: [], statuses: [] })
      if (path === '/settings') return json({ allowPublicBind: false, defaultCommandTimeoutMs: 30000, maxOutputChars: 32000 })
      if (path === '/gist-sync') return json({ autoSync: false, strategy: 'smart', backupRetention: 5, tokenConfigured: false, encryptionConfigured: false, running: false })
      if (path === '/file-transfer/endpoints') return json([{ id: 'local:test', name: '当前会话', kind: 'local', initialPath: '/work' }])
      if (path === '/file-transfer/jobs') return json([])
      if (path === '/file-transfer/directory') return json({ path: '/work', parent: null, entries: [] })
      return json({})
    })
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    if (colorScheme === 'dark') await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', ''); document.body.style.background = '#161d20' })
    await page.getByRole('button', { name: '连接', exact: true }).waitFor()
    await page.getByRole('button', { name: '连接', exact: true }).click()
    await page.getByRole('button', { name: '断开', exact: true }).waitFor()
    await page.getByRole('button', { name: '新建终端标签', exact: true }).click()
    await page.getByRole('button', { name: '连接', exact: true }).click()
    await page.getByRole('button', { name: '断开', exact: true }).waitFor()
    await page.getByRole('button', { name: '左右分屏', exact: true }).click()
    assert.equal(await page.locator('.dsh-ssh-terminal-slot:visible').count(), 2)
    const toolbar = page.locator('.dsh-ssh-terminal-tabbar:visible')
    assert.ok((await toolbar.boundingBox()).height <= 56, 'terminal controls must stay in one compact row')
    assert.equal(await page.locator('.dsh-ssh-terminal-layout').count(), 0, 'no separate layout toolbar')
    assert.equal(await page.locator('.dsh-ssh-terminal-pane-label').count(), 0, 'no repeated pane heading')
    assert.equal(await page.locator('.dsh-ssh-terminal-panes:visible').evaluate(el => getComputedStyle(el).gap), '1px')
    const firstTerminal = page.locator('.dsh-ssh-terminal-slot[aria-label="终端 1"]')
    const beforeFocus = await firstTerminal.boundingBox()
    await firstTerminal.click({ position: { x: 8, y: 8 } })
    assert.deepEqual(await firstTerminal.boundingBox(), beforeFocus, 'selecting a split must not rearrange terminals')
    assert.equal(await page.locator('.dsh-ssh-terminal-session-actions:visible').getAttribute('aria-label'), '终端 1 操作')
    await page.screenshot({ path: `/tmp/ssh-terminal-compact-split-${width}-${colorScheme}.png` })
    await page.getByRole('button', { name: '常用命令', exact: true }).first().click()
    assert.equal(await page.locator('.dsh-ssh-command-picker').count(), 1)
    assert.equal(await page.locator('.dsh-ssh-command-picker h1').count(), 0, 'picker must not embed the workspace heading')
    await page.screenshot({ path: `/tmp/ssh-command-picker-${width}-${colorScheme}.png` })
    await page.getByRole('button', { name: '选用', exact: true }).click()
    assert.equal(inputs.length, 0, 'choosing a command must never run it')
    await page.getByRole('button', { name: '确认执行', exact: true }).click()
    await page.waitForTimeout(120)
    assert.equal(inputs.length, 1)
    assert.equal(inputs[0].text, 'uname -a\r')
    assert.equal(inputs[0].path, '/terminals/t1/input', 'commands target the selected split only')
    await page.getByRole('tab', { name: '常用命令', exact: true }).click()
    await page.getByRole('button', { name: '新建命令', exact: true }).click()
    await page.getByRole('textbox', { name: '名称', exact: true }).fill('查看磁盘')
    await page.getByRole('textbox', { name: /^命令/ }).fill('df -h')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByText('查看磁盘', { exact: true }).waitFor()
    await page.getByRole('tab', { name: '终端与文件', exact: true }).click()
    assert.equal(await page.locator('.dsh-ssh-terminal-slot:visible').count(), 2)
    assert.equal(closed.length, 0, 'changing workspace page must retain terminals')
    await page.getByRole('button', { name: '单屏', exact: true }).click()
    await page.getByRole('tab', { name: '终端 1', exact: true }).press('End')
    assert.equal(await page.getByRole('tab', { name: '终端 2', exact: true }).getAttribute('aria-selected'), 'true')
    await page.getByRole('tab', { name: '终端 2', exact: true }).press('Home')
    assert.equal(await page.getByRole('tab', { name: '终端 1', exact: true }).getAttribute('aria-selected'), 'true')
    if (width < 820) await page.getByRole('button', { name: '主机', exact: true }).click()
    await page.getByTitle('选择并展开 开发主机', { exact: true }).click()
    if (width < 820) await page.getByRole('button', { name: '主机', exact: true }).click()
    await page.getByRole('button', { name: /应用目录/ }).first().click()
    if (width < 820) await page.getByRole('button', { name: '主机', exact: true }).click()
    await page.getByRole('button', { name: /日志目录/ }).first().click()
    await page.waitForTimeout(120)
    assert.deepEqual(access.mountedProjectIds.a, ['p1', 'p2'])
    assert.equal(access.workingDirectories.a, '/srv/app')
    if (width < 820) await page.getByRole('button', { name: '主机', exact: true }).click()
    failSave = true
    await page.locator('.dsh-ssh-tree-project-main').filter({ hasText: '日志目录' }).click()
    await page.waitForTimeout(120)
    assert.equal(await page.locator('.dsh-ssh-tree-project-main').filter({ hasText: '日志目录' }).getAttribute('aria-pressed'), 'true', 'failed mount changes must roll back to confirmed access')
    assert.equal(nextTerminal, 2)
    assert.equal(closed.length, 0)
    if (width < 820) await page.getByRole('button', { name: '主机', exact: true }).click()
    await page.getByTitle('选择并展开 测试主机', { exact: true }).click()
    assert.equal(closed.length, 0, 'switching hosts must retain original terminals')
    assert.equal(await page.locator('.dsh-ssh-host-page:visible .xterm').count(), 0, 'unconnected hosts must not instantiate xterm')
    if (width < 820) await page.getByRole('button', { name: '主机', exact: true }).click()
    await page.getByTitle('选择并展开 开发主机', { exact: true }).click()
    assert.equal(await page.locator('.dsh-ssh-host-page:visible .xterm').count(), 2)
    await page.screenshot({ path: `/tmp/ssh-workbench-${width}-${colorScheme}.png` })
    for (const tab of ['常用命令', '密钥库', '代理库', '设置', '文件传输']) {
      await page.getByRole('tab', { name: tab, exact: true }).click()
      await page.waitForTimeout(80)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${tab} must fit ${width}px`)
    }
    await page.getByRole('tab', { name: '终端与文件', exact: true }).click()
    await page.getByRole('button', { name: '关闭终端 2', exact: true }).click()
    await page.getByRole('button', { name: '关闭连接', exact: true }).click()
    await page.waitForTimeout(120)
    assert.equal(closed.length, 1)
    await page.getByRole('button', { name: '新建终端标签', exact: true }).click()
    delayNext = true
    await page.getByRole('button', { name: '连接', exact: true }).click()
    await page.getByRole('button', { name: '连接中…', exact: true }).waitFor()
    await page.getByRole('button', { name: '关闭终端 3', exact: true }).click()
    await page.getByRole('button', { name: '关闭连接', exact: true }).click()
    assert.equal(typeof releaseOpen, 'function')
    releaseOpen()
    await page.waitForTimeout(200)
    assert.equal(closed.length, 2, 'closing a connecting tab must clean up its late response')
    await page.getByRole('button', { name: '收起 SFTP', exact: true }).click()
    assert.equal(await page.locator('.dsh-ssh-workbench-files:visible').count(), 0)
    assert.equal(await page.locator('.dsh-ssh-host-page:visible .xterm').count(), 1)
    await page.getByRole('button', { name: '展开 SFTP', exact: true }).click()
    assert.equal(await page.locator('.dsh-ssh-workbench-files:visible').count(), 1)
    await page.getByRole('button', { name: '左右分屏', exact: true }).click()
    await page.getByRole('button', { name: '增加分屏', exact: true }).click()
    await page.getByRole('button', { name: '增加分屏', exact: true }).click()
    assert.equal(await page.locator('.dsh-ssh-terminal-slot:visible').count(), 4)
    assert.equal(await page.getByRole('button', { name: '增加分屏', exact: true }).isDisabled(), true)
    const positions = await page.locator('.dsh-ssh-terminal-slot:visible').evaluateAll(nodes => nodes.map(node => ({ id: node.id, order: node.style.order })))
    await page.getByRole('tab', { name: '终端 1', exact: true }).click()
    assert.deepEqual(await page.locator('.dsh-ssh-terminal-slot:visible').evaluateAll(nodes => nodes.map(node => ({ id: node.id, order: node.style.order }))), positions, 'visible tab selection must never swap panes')
    await page.getByRole('button', { name: '新建终端标签', exact: true }).click()
    assert.equal(await page.locator('.dsh-ssh-terminal-slot:visible').count(), 4)
    assert.equal(await page.locator('#ssh-terminal-a-1').isVisible(), false)
    assert.equal(await page.locator('.dsh-ssh-terminal-slot[aria-label="终端 7"]').evaluate(node => node.style.order), '0')
    await page.screenshot({ path: `/tmp/ssh-four-panes-${width}-${colorScheme}.png` })
    await page.evaluate(() => window.unmountWorkspace())
    await page.waitForTimeout(120)
    assert.equal(closed.length, 3, 'leaving the workbench closes the remaining terminal')
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ width, colorScheme, passed: true, terminals: nextTerminal, mounts: access.mountedProjectIds.a }))
    await page.close()
  }
} catch (error) { await currentPage?.screenshot({ path: '/tmp/ssh-workbench-failure.png' }); throw error }
finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
