// Real React form -> API -> store, with isolated state and no external FTP host.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { SshStore } from '../lib/store.js'
import { registerSshApi } from '../lib/api.js'

const { chromium } = await import(process.env.SSH_PLAYWRIGHT_MODULE ?? 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const tmp = await mkdtemp(join(tmpdir(), 'ssh-ftp-auth-'))
const store = await SshStore.open(join(tmp, 'state.json'), { allowPublicBind: false, defaultCommandTimeoutMs: 30000, maxOutputChars: 32000 })
let handler
registerSshApi({ register(route) { handler = route.handler; return () => {} } }, '/ssh-local/v1', {
  store,
  credentials: {
    readFtp: async () => ({}),
    describeFtp: async () => ({ configured: false, fields: [] }),
    deleteFtp: async () => {},
    replaceFtp: async () => { throw new Error('anonymous login must not store a password') },
  },
})
const bundle = await build({
  stdin: { contents: `import React,{useState} from 'react'; import {createRoot} from 'react-dom/client'; import {installStyles} from './src/client.tsx'; import {FtpConnectionsDialog} from './src/ftp-profile-editor.tsx';
    installStyles(); function App(){const [profiles,setProfiles]=useState([]); return <FtpConnectionsDialog profiles={profiles} vaultEntries={[]} proxyEntries={[]} onClose={()=>{}} onChanged={()=>fetch('/ssh-local/v1/ftp-profiles').then(r=>r.json()).then(setProfiles)}/>}; createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: root, loader: 'tsx' },
  bundle: true, write: false, outdir: '/tmp/ftp-auth-bundle', platform: 'browser', format: 'iife', jsx: 'automatic',
  loader: { '.css': 'text' },
  plugins: [{ name: 'fixture', setup(b) {
    b.onLoad({ filter: /\/src\/client\.tsx$/ }, async args => ({ loader: 'tsx', contents: (await readFile(args.path, 'utf8')).replace('function installStyles(', 'export function installStyles(') }))
    b.onLoad({ filter: /\.module\.css$/ }, async args => ({ loader: 'local-css', contents: await readFile(args.path, 'utf8') }))
  } }],
})
const js = bundle.outputFiles.find(f => f.path.endsWith('.js')).text
const css = bundle.outputFiles.find(f => f.path.endsWith('.css'))?.text ?? ''
const server = createServer((req, res) => {
  if (req.url.startsWith('/ssh-local/v1/')) { void handler(req, res); return }
  if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(js); return }
  res.setHeader('Content-Type', 'text/html')
  res.end(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page.getByLabel('连接名称', { exact: true }).fill('Anonymous fixture')
  await page.getByLabel('服务器地址', { exact: true }).fill('127.0.0.1')
  await page.locator('select').filter({ has: page.locator('option[value="anonymous"]') }).selectOption('anonymous')
  assert.equal(await page.getByLabel('用户名', { exact: true }).count(), 0)
  const savedResponse = page.waitForResponse(r => r.url().endsWith('/ftp-profiles') && r.request().method() === 'POST')
  await page.getByRole('button', { name: '保存连接', exact: true }).click()
  const response = await savedResponse
  assert.equal(response.request().postDataJSON().profile.username, 'anonymous')
  assert.equal(response.status(), 201, await response.text())
  assert.equal(store.ftpProfiles()[0].username, 'anonymous')
  assert.equal(store.ftpProfiles()[0].authMode, 'anonymous')
  await page.locator('.dsh-ssh-ftp-profile-main').filter({ hasText: 'Anonymous fixture' }).click()
  assert.equal(await page.locator('select').filter({ has: page.locator('option[value="anonymous"]') }).inputValue(), 'anonymous')
  assert.equal(await page.getByLabel('用户名', { exact: true }).count(), 0)
  const updatedResponse = page.waitForResponse(r => r.url().includes('/ftp-profiles/') && r.request().method() === 'PUT')
  await page.getByRole('button', { name: '保存连接', exact: true }).click()
  assert.equal((await updatedResponse).status(), 200)
  assert.deepEqual(errors, [])
  console.log('Anonymous FTP form create/reopen/update passed')
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
