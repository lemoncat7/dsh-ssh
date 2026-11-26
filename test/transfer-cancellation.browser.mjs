// Existing Playwright/browser installations may be selected with DSH_* environment variables.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { FileTransferManager } from '../lib/file-transfer-manager.js'
import { registerSshApi } from '../lib/api.js'

const { chromium } = await import(process.env.DSH_PLAYWRIGHT_MODULE ?? 'playwright')
const repo = fileURLToPath(new URL('../', import.meta.url))
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ssh-transfer-cancel-browser-'))
let browser, server, watchdog, manager
const endpoints = ['source', 'dest'].map(id => ({ id: 'sftp:' + id, kind: 'sftp', protocol: 'sftp', name: id, address: 'test', initialPath: '/target' }))
const stats = { downloads: 0, downloadAborts: 0, uploads: 0, uploadAborts: 0, removedStaging: 0, commits: 0 }
let holdUpload = true, conflict = false, delayList = false, delayedList, failCancel = false
const files = {
  endpoints: () => endpoints,
  endpoint: id => endpoints.find(x => x.id === id),
  async connect(id) {
    return {
      endpoint: files.endpoint(id),
      async stat(value) {
        if (value === '/target') return { name: 'target', path: value, kind: 'directory', size: 0, modifiedAt: 0 }
        if (id === 'sftp:dest') {
          if (conflict) return { name: 'file.bin', path: value, kind: 'file', size: 4, modifiedAt: 0 }
          throw Object.assign(Error('missing'), { status: 404 })
        }
        return { name: path.posix.basename(value), path: value, kind: 'file', size: value === '/stream.bin' ? 8 : 4, modifiedAt: 0 }
      },
      async list(value) { return { path: value, parent: '/', entries: [] } },
      async download(value, output, signal) {
        stats.downloads++
        if (value !== '/stream.bin') { output.end('test'); return }
        output.write('test')
        await new Promise((_, reject) => signal.addEventListener('abort', () => { stats.downloadAborts++; reject(signal.reason) }, { once: true }))
      },
      async ensureDirectory() {},
      async upload(_value, input, _overwrite, signal) {
        stats.uploads++
        for await (const _chunk of input) {}
        if (id === 'sftp:dest') return new Promise(() => {}) // Lost protocol acknowledgement, like the reported task.
        if (holdUpload) await new Promise((_, reject) => {
          const abort = () => { stats.uploadAborts++; reject(signal.reason) }
          signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort()
        })
      },
      async move() { stats.commits++ },
      async remove() { stats.removedStaging++ },
      close() {},
    }
  },
}
const request = { sourceEndpointId: 'sftp:source', sourcePaths: ['/file.bin'], destinationEndpointId: 'sftp:dest', destinationDirectory: '/target', conflictPolicy: 'fail' }
async function until(check) {
  for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)) }
  assert.fail('browser test condition did not settle')
}
try {
  manager = new FileTransferManager(files, 1)
  await build({
    stdin: { resolveDir: repo, loader: 'tsx', contents: `
      import {createRoot} from 'react-dom/client';
      import {installStyles} from './src/client.tsx';
      import {FileTransferWorkspace} from './src/file-transfer-workspace.tsx';
      import {LocalTransferTasks} from './src/transfer-task-list.tsx';
      import {trackDownloadClick,browserTransfers} from './src/browser-transfers.ts';
      installStyles();window.stats={aborts:0,closes:0,writes:0};window.jobs=browserTransfers;
      const writer={write:async()=>{window.stats.writes++;if(window.pendingWrite)await new Promise(resolve=>window.releaseWrite=resolve)},
        close:async()=>{window.stats.closes++;if(window.pendingClose)await new Promise(resolve=>window.releaseClose=resolve)},
        abort:async()=>{window.stats.aborts++;if(window.pendingAbort)await new Promise(resolve=>window.releaseAbort=resolve)}};
      const handle={name:'test.bin',createWritable:async()=>writer};
      window.showSaveFilePicker=async()=>window.pendingPicker?await new Promise(resolve=>window.releasePicker=()=>resolve(handle)):handle;
      const mode=new URLSearchParams(location.search).get('mode');
      const access={value:null,loading:false,saving:false};
      createRoot(document.getElementById('root')).render(mode==='workspace'?<FileTransferWorkspace ftpProfiles={[]} vaultEntries={[]} proxyEntries={[]} access={access} onProfilesChanged={()=>{}}/>:
        <><a href={'/ssh-local/v1/file-transfer/download?endpointId=sftp:source&path='+encodeURIComponent(mode==='save'?'/tiny.bin':'/stream.bin')} download="test.bin" onClick={trackDownloadClick}>开始下载</a><LocalTransferTasks/></>);
    ` },
    outfile: path.join(temp, 'fixture.js'), bundle: true, platform: 'browser', jsx: 'automatic', loader: { '.css': 'text' },
    nodePaths: (process.env.DSH_BROWSER_NODE_PATH ?? '').split(path.delimiter).filter(Boolean),
    alias: { react: path.join(repo, 'node_modules/react'), 'react-dom': path.join(repo, 'node_modules/react-dom') },
    plugins: [{ name: 'production-styles', setup(builder) { builder.onLoad({ filter: /\/src\/client\.tsx$/ }, async ({ path: filename }) => ({ contents: await fs.readFile(filename, 'utf8') + '\nexport {installStyles};', loader: 'tsx' })) } }],
  })
  const bundle = await fs.readFile(path.join(temp, 'fixture.js'))
  let route
  registerSshApi({ register(value) { route = value; return () => {} } }, '/ssh-local/v1', { files, transfers: manager, fileSessions: { run: async (_pane, id, action) => action(await files.connect(id)) } })
  server = createServer((req, res) => {
    if (req.url.startsWith('/ssh-local/')) {
      if (req.method === 'GET' && req.url === '/ssh-local/v1/file-transfer/jobs' && delayList) {
        delayList = false
        const snapshot = manager.list()
        delayedList = () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(snapshot)) }
        return
      }
      if (req.method === 'DELETE' && /\/file-transfer\/jobs\/[^/]+$/.test(req.url) && failCancel) {
        failCancel = false; res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":"retry cancel"}'); return
      }
      void route.handler(req, res); return
    }
    res.setHeader('Content-Type', req.url === '/fixture.js' ? 'text/javascript' : 'text/html')
    res.end(req.url === '/fixture.js' ? bundle : '<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}#root{min-height:100vh}</style><div id="root" class="dsh-ssh-workspace dsh-ssh-workspace-v2"></div><script src="/fixture.js"></script>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  browser = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'], ...(process.env.DSH_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DSH_CHROMIUM_EXECUTABLE } : {}) })
  watchdog = setTimeout(() => { void browser.close() }, 90000)
  const pageFor = async mode => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    page.setDefaultTimeout(7000)
    page.on('pageerror', error => { throw error })
    page.on('response', response => { if (response.status() >= 400) console.error('HTTP', response.status(), response.url()) })
    await page.goto(`http://127.0.0.1:${server.address().port}/?mode=${mode}`)
    return page
  }
  const cancel = page => page.getByRole('button', { name: '取消传输', exact: true })
  const dismiss = page => page.getByRole('button', { name: '关闭传输记录', exact: true })
  {
    const page = await pageFor('download'), before = stats.downloads
    await page.evaluate(() => { window.pendingPicker = true })
    await page.getByRole('link', { name: '开始下载' }).click(); await cancel(page).click()
    await page.getByText('已取消', { exact: true }).waitFor()
    await page.evaluate(() => window.releasePicker()); assert.equal(stats.downloads, before)
    await dismiss(page).click(); assert.equal(await page.locator('.dsh-ssh-transfer-job-list article').count(), 0)
    await page.close()
  }
  {
    const page = await pageFor('download'), before = stats.downloadAborts
    await page.evaluate(() => { window.pendingWrite = true; window.pendingAbort = true })
    await page.getByRole('link', { name: '开始下载' }).click(); await page.waitForFunction(() => window.stats.writes > 0)
    await cancel(page).click()
    await page.getByText('正在取消…', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '正在取消…', exact: true }).isDisabled(), true)
    await page.evaluate(() => window.releaseAbort()); await page.getByText('已取消', { exact: true }).waitFor()
    await until(() => stats.downloadAborts > before)
    assert.equal(await page.evaluate(() => window.stats.closes), 0)
    await page.evaluate(() => window.releaseWrite()); await dismiss(page).click(); await page.close()
  }
  {
    const page = await pageFor('save')
    await page.evaluate(() => { window.pendingClose = true })
    await page.getByRole('link', { name: '开始下载' }).click(); await page.getByText('正在完成本地保存…', { exact: true }).waitFor()
    assert.equal(await cancel(page).isDisabled(), true)
    await page.evaluate(() => window.releaseClose()); await page.getByText('已保存到所选文件', { exact: true }).waitFor()
    await dismiss(page).click(); await page.close()
  }
  {
    const page = await pageFor('workspace'), before = stats.uploads
    const pane = page.locator('.dsh-ssh-file-pane').first()
    await pane.locator('.dsh-ssh-endpoint-row').filter({ hasText: 'source' }).click()
    await page.waitForFunction(() => document.querySelector('.dsh-ssh-file-pane button[aria-label="从本机上传文件"]')?.disabled === false)
    await pane.locator('input[type=file]').setInputFiles([{ name: 'one.bin', mimeType: 'application/octet-stream', buffer: Buffer.from('test') }, { name: 'two.bin', mimeType: 'application/octet-stream', buffer: Buffer.from('test') }])
    await page.getByText('已发送，等待远端保存完成…', { exact: true }).waitFor()
    await cancel(page).click(); await page.getByText('已取消', { exact: true }).waitFor()
    await until(() => stats.uploadAborts > 0 && stats.removedStaging > 0)
    assert.equal(stats.uploads, before + 1, 'Cancelling the batch must not start the next file')
    assert.equal(stats.commits, 0)
    await dismiss(page).click(); await page.close()
  }
  {
    const job = manager.start('ui', request)
    await until(() => manager.get(job.id).state === 'transferring')
    const page = await pageFor('workspace')
    await cancel(page).waitFor()
    delayList = true; await until(() => delayedList)
    failCancel = true; await cancel(page).click(); await page.getByText('retry cancel', { exact: true }).waitFor()
    assert.equal(manager.get(job.id).state, 'transferring')
    await cancel(page).click(); await page.getByText('传输已取消', { exact: true }).waitFor()
    assert.equal(manager.get(job.id).state, 'cancelled')
    delayedList(); delayedList = undefined
    await page.waitForTimeout(100)
    assert.equal(await cancel(page).count(), 0, 'A stale poll cannot resurrect the task')
    await dismiss(page).click(); assert.equal(manager.list().length, 0)
    await page.close()
  }
  {
    conflict = true
    const job = manager.start('ui', request)
    await until(() => manager.get(job.id).state === 'failed')
    const page = await pageFor('workspace'), before = stats.removedStaging
    await page.getByRole('button', { name: '处理', exact: true }).waitFor()
    await dismiss(page).click(); assert.equal(manager.list().length, 0)
    assert.equal(stats.removedStaging, before, 'Dismissing history must not remove a remote file')
    await page.close()
  }
  console.log('Passed 6 real browser scenarios: pending picker, stalled local write, atomic save, upload batch cancellation, stuck remote cancellation/retry/stale polling, and history dismissal.')
} finally {
  clearTimeout(watchdog)
  delayedList?.()
  await browser?.close()
  await manager?.closeAll()
  server?.closeAllConnections()
  await new Promise(resolve => server ? server.close(resolve) : resolve())
  await fs.rm(temp, { recursive: true, force: true })
}
