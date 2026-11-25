// Use DSH_PLAYWRIGHT_MODULE and optionally DSH_CHROMIUM_EXECUTABLE for an existing browser installation.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { SshStore } from '../lib/store.js'
import { registerSshApi } from '../lib/api.js'

const { chromium } = await import(process.env.DSH_PLAYWRIGHT_MODULE ?? 'playwright')
const repo = fileURLToPath(new URL('../', import.meta.url))
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ssh-mount-inheritance-browser-'))
let browser, server, watchdog
try {
  const store = await SshStore.open(path.join(temp, 'state.json'), { allowPublicBind: false, defaultCommandTimeoutMs: 30000, maxOutputChars: 32000 }, () => 'workspace')
  await store.update(state => {
    state.profiles = ['a', 'b', 'c'].map((id, index) => ({ id, name: ['Alpha', 'Beta', 'Gamma'][index], group: id === 'c' ? 'Other' : 'Dev', host: `${id}.example.test`, port: 22, username: 'test', authType: 'agent', proxy: { type: 'none' }, tags: [], createdAt: 1, updatedAt: 1 }))
    state.remoteProjects = ['app', 'logs', 'archive'].map(id => ({ id, profileId: 'a', name: id, path: '/' + id, createdAt: 1, updatedAt: 1 }))
    state.workspaceMounts = [{ workspaceId: 'workspace', revision: 'one', profileIds: ['a', 'c'], mountedProjectIds: { a: ['app', 'logs'], c: [] }, workingProjectIds: { a: 'app' } }]
  })
  const initial = store.snapshot()
  await build({
    stdin: { resolveDir: repo, loader: 'tsx', contents: `
      import {createRoot} from 'react-dom/client';
      import {useEffect,useState} from 'react';
      import {RemoteWorkspaceTree} from './src/remote-workspace-tree.tsx';
      import {useSessionAccess} from './src/session-access.ts';
      function App(){
        const access=useSessionAccess('active');const [selected,onSelect]=useState(null);
        useEffect(()=>{window.access=access},[access]);
        return <RemoteWorkspaceTree catalogue profiles={${JSON.stringify(initial.profiles)}} groupConfigs={[]}
          access={access.value} accessLoading={access.loading} accessSaving={access.saving} accessError={access.error}
          workspaces={[{workspaceId:'workspace',title:'Test project',path:'/test'}]} currentWorkspaceId="workspace"
          selected={selected} onSelect={onSelect} onProfiles={access.setProfiles} onMountMode={access.setMountMode}
          onToggleProject={access.toggleProject} onDirectory={access.setDirectory} onPermission={access.setPermission}
          onApproval={access.setRequireCommandApproval} onProjectsChanged={access.refresh}
          onCreateSession={async()=>{}} onNewProfile={()=>{}} onNewGroup={()=>{}} onEditProfile={()=>{}} onMoveProfile={async()=>{}} />;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    outfile: path.join(temp, 'fixture.js'), bundle: true, platform: 'browser', jsx: 'automatic',
    loader: { '.css': 'text' }, nodePaths: (process.env.DSH_BROWSER_NODE_PATH ?? '').split(path.delimiter).filter(Boolean),
    alias: { react: path.join(repo, 'node_modules/react'), 'react-dom': path.join(repo, 'node_modules/react-dom') },
  })
  const bundle = await fs.readFile(path.join(temp, 'fixture.js'))
  let route, failNext = false, saveRequests = 0
  registerSshApi({ register(value) { route = value; return () => {} } }, '/ssh-local/v1', {
    store, aiTerminals: { async closeOwner() {}, async closeProfile() {} },
    files: { endpoint: id => ({ id }) },
  })
  server = createServer((req, res) => {
    if (req.url.startsWith('/ssh-local/')) {
      if (req.method === 'PUT' && req.url === '/ssh-local/v1/injections/active') {
        saveRequests++
        if (failNext) { failNext = false; res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Test save failure' })); return }
      }
      void route.handler(req, res); return
    }
    res.setHeader('Content-Type', req.url === '/fixture.js' ? 'text/javascript' : 'text/html')
    res.end(req.url === '/fixture.js' ? bundle : '<div id="root"></div><script src="/fixture.js"></script>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  browser = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'], ...(process.env.DSH_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DSH_CHROMIUM_EXECUTABLE } : {}) })
  watchdog = setTimeout(() => { void browser.close() }, 90000)
  const open = async () => {
    await store.update(state => Object.assign(state, structuredClone(initial)))
    saveRequests = 0; failNext = false
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    page.on('pageerror', error => { throw error })
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    await page.waitForFunction(() => window.access?.value?.mountSource && !window.access.loading)
    assert.equal(await page.getByRole('radio', { name: '继承项目' }).isChecked(), true)
    return page
  }
  const saved = async page => {
    await page.waitForFunction(() => window.access?.value?.mountMode === 'independent' && !window.access.saving)
    assert.equal(await page.getByRole('radio', { name: '单独配置' }).isChecked(), true)
    assert.deepEqual(store.workspaceMounts('active'), initial.workspaceMounts[0])
    assert.deepEqual(store.injection('other').profileIds, ['a', 'c'])
    return store.injection('active')
  }
  {
    const page = await open()
    await page.getByRole('button', { name: 'Alpha test@a.example.test', exact: true }).click()
    await page.getByRole('button', { name: '挂载 Beta', exact: true }).click()
    const access = await saved(page)
    assert.deepEqual(access.profileIds, ['a', 'c', 'b'])
    assert.deepEqual(access.mountedProjectIds.a, ['app', 'logs'])
    assert.equal(saveRequests, 1, 'Mode and mount change save together')
    await page.getByRole('radio', { name: '继承项目' }).check()
    await page.waitForFunction(() => window.access.value.mountMode === 'inherit' && !window.access.saving)
    assert.deepEqual(store.injection('active').profileIds, ['a', 'c'])
    await page.close()
  }
  for (const [button, ids] of [['卸载 Alpha', ['c']], ['挂载「Dev」整组（共 2 台）', ['a', 'c', 'b']], ['卸载「Dev」整组（共 2 台）', ['c']]]) {
    const page = await open()
    await page.getByRole('button', { name: button, exact: true }).click()
    assert.deepEqual((await saved(page)).profileIds, ids)
    await page.close()
  }
  {
    const page = await open()
    await page.getByRole('button', { name: 'Alpha test@a.example.test', exact: true }).click()
    await page.getByRole('button', { name: '挂载 archive', exact: true }).click()
    assert.deepEqual((await saved(page)).mountedProjectIds.a, ['app', 'logs', 'archive'])
    await page.close()
  }
  {
    const page = await open()
    await page.getByRole('button', { name: 'Alpha test@a.example.test', exact: true }).click()
    await page.getByRole('button', { name: '卸载 app', exact: true }).click()
    assert.deepEqual((await saved(page)).mountedProjectIds.a, ['logs'])
    await page.close()
  }
  {
    const page = await open()
    await page.getByRole('button', { name: 'Alpha test@a.example.test', exact: true }).click()
    await page.getByRole('button', { name: 'logs 的目录操作', exact: true }).click()
    await page.getByRole('menuitem', { name: '设为默认工作目录' }).click()
    assert.equal((await saved(page)).workingProjectIds.a, 'logs')
    await page.close()
  }
  {
    const page = await open()
    await page.getByRole('button', { name: 'Alpha test@a.example.test', exact: true }).click()
    assert.equal(store.injection('active').mountMode, 'inherit', 'Browsing leaves inheritance intact')
    failNext = true
    await page.getByRole('button', { name: '挂载 Beta', exact: true }).click()
    await page.waitForFunction(() => !window.access.saving && window.access.error)
    assert.equal(await page.getByRole('radio', { name: '继承项目' }).isChecked(), true)
    assert.equal(store.injection('active').mountMode, 'inherit')
    assert.deepEqual(store.injection('active').profileIds, ['a', 'c'])
    await page.getByRole('button', { name: '挂载 Beta', exact: true }).click()
    await saved(page)
    await page.close()
  }
  {
    const page = await open()
    await page.evaluate(() => window.access.setRequireCommandApproval(false))
    await page.waitForFunction(() => !window.access.saving && window.access.value.requireCommandApproval === false)
    assert.equal(store.injection('active').mountMode, 'inherit', 'Permissions do not detach project mounts')
    await page.evaluate(() => { window.access.setProfiles(['a', 'c', 'b']); window.access.toggleProject('a', 'app', '/app') })
    const access = await saved(page)
    assert.deepEqual(access.profileIds, ['a', 'c', 'b'])
    assert.deepEqual(access.mountedProjectIds.a, ['logs'])
    assert.equal(access.requireCommandApproval, false)
    await page.close()
  }
  console.log('Passed 9 browser scenarios: host/group mount and unmount, directory mount and unmount, default directory, rollback/retry, permission isolation and queued edits.')
} finally {
  clearTimeout(watchdog)
  await browser?.close()
  await new Promise(resolve => server ? server.close(resolve) : resolve())
  await fs.rm(temp, { recursive: true, force: true })
}
