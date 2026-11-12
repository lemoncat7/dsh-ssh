// Optional real-browser regression: DSH_PLAYWRIGHT_MODULE may name an existing Playwright installation.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
const { chromium } = await import(process.env.DSH_PLAYWRIGHT_MODULE ?? 'playwright')
const repo = fileURLToPath(new URL('../', import.meta.url))
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-sidebar-browser-'))
let browser, server, watchdog
try {
  const output = path.join(temp, 'fixture.js')
  await build({ entryPoints: [path.join(repo, 'test/sidebar-anchor.fixture.tsx')], outfile: output, bundle: true, platform: 'browser', jsx: 'automatic', alias: { react: path.join(repo, 'node_modules/react'), 'react-dom': path.join(repo, 'node_modules/react-dom') } })
  const bundle = await fs.readFile(output)
  server = createServer((req, res) => { res.setHeader('content-type', req.url === '/fixture.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/fixture.js' ? bundle : '<div id="root"></div><script src="/fixture.js"></script>') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  browser = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
  watchdog = setTimeout(() => { void browser.close() }, 45000)
  for (const strict of [false, true]) {
    const page = await browser.newPage(); const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.address().port}/${strict ? '?strict' : ''}`)
    const configure = async next => { await page.evaluate(value => window.configure(value), next); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))) }
    const check = async (expected = 2) => {
      assert.equal(await page.locator('[data-crash]').count(), 0)
      assert.equal(await page.locator('[data-slot="sidebar"]').count(), 1)
      assert.equal(await page.locator('[data-dsh-workspace-anchor]').count(), expected)
      assert.equal(await page.locator('[data-other-plugin]').count(), 1)
      assert.deepEqual(errors, [])
    }
    await page.waitForSelector('[data-workspaces] [data-entry="ssh"]')
    await page.locator('[data-native]').click()
    await page.locator('[data-entry="ssh"] button').click()
    for (let generation = 1; generation <= 20; generation++) {
      await configure({ entries: [{ id: 'partner', generation }] }); await check(1)
      await configure({ entries: [{ id: 'partner', generation }, { id: 'ssh', generation }] }); await check()
    }
    assert.equal(await page.locator('[data-native]').textContent(), 'native:1')
    assert.deepEqual(await page.locator('[data-workspaces] [data-entry]').evaluateAll(rows => rows.map(row => row.dataset.entry)), ['partner', 'ssh'])
    await page.locator('[data-entry="ssh"] button').click()
    await configure({ workspaceGeneration: 1 }); await check()
    assert.equal(await page.locator('[data-workspaces] [data-entry="ssh"] button').textContent(), 'ssh:1:wide')
    await configure({ workspace: false }); await check()
    assert.equal(await page.locator('footer [data-entry="ssh"] button').textContent(), 'ssh:1:wide')
    await configure({ workspace: true, wide: false }); await check()
    assert.equal(await page.locator('[data-workspaces] [data-entry="ssh"] button').textContent(), 'ssh:1:rail')
    await configure({ entries: [{ id: 'ssh', generation: 20 }, { id: 'ssh', generation: 21 }] }); await check()
    await configure({ entries: [{ id: 'ssh', generation: 21 }] }); await check(1)
    assert.equal(await page.locator('[data-entry="ssh"][data-generation="21"]').count(), 1)
    await configure({ visible: false }); assert.equal(await page.locator('[data-dsh-workspace-anchor]').count(), 0)
    await configure({ visible: true, wrapped: false, entries: [{ id: 'ssh', generation: 22 }, { id: 'partner', generation: 22 }] }); await check()
    await configure({ entries: [] }); await check(0)
    await page.close()
    console.log(`PASS strict=${strict}: 20 hot-reload cycles, overlap disposal, native state, region replacement, fallback, rail and full unmount`)
  }
} finally {
  clearTimeout(watchdog)
  await browser?.close()
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  await fs.rm(temp, { recursive: true, force: true })
}
