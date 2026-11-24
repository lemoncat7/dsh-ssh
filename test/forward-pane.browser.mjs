// DSH_PLAYWRIGHT_MODULE may point to an existing Playwright installation.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'

const { chromium } = await import(process.env.DSH_PLAYWRIGHT_MODULE ?? 'playwright')
const repo = fileURLToPath(new URL('../', import.meta.url))
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-forward-browser-'))
let browser, server, watchdog
try {
  await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { useState } from 'react';
        import { ForwardPane, installStyles } from './src/client.tsx';
        import { sshLocale } from './src/i18n.ts';
        import { ICON_SYMBOLS } from '@deepseek-ai/dsh-client-ui-primitives';
        const sprite = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        sprite.style.display = 'none';
        for (const [id, markup] of Object.entries(ICON_SYMBOLS)) {
          const svg = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
          const symbol = document.createElementNS(sprite.namespaceURI, 'symbol');
          symbol.id = id;
          for (const attribute of svg.attributes) if (attribute.name !== 'xmlns') symbol.setAttribute(attribute.name, attribute.value);
          symbol.innerHTML = svg.innerHTML;
          sprite.append(symbol);
        }
        document.body.append(sprite);
        sshLocale.setLocale(new URLSearchParams(location.search).get('lang') || 'zh');
        installStyles();
        const profiles = [
          {id:'host', name:'Test SSH', host:'host.test', port:22, username:'user', tags:[]},
          {id:'other', name:'Other SSH', host:'other.test', port:22, username:'user', tags:[]}
        ];
        function App() {
          const [open, setOpen] = useState(true);
          window.showForwards = setOpen;
          return (
          <div className="dsh-ssh-workspace dsh-ssh-workspace-v2" style={{width:'100%', height:'100vh'}}>
            <div className="dsh-ssh-tool-card">{open && <ForwardPane profiles={profiles} />}</div>
          </div>);
        }
        createRoot(document.getElementById('root')).render(<App />);`,
      resolveDir: repo, loader: 'tsx',
    },
    outfile: path.join(temp, 'fixture.js'), bundle: true, platform: 'browser', jsx: 'automatic',
    loader: { '.css': 'text', '.module.css': 'local-css' },
    nodePaths: (process.env.DSH_BROWSER_NODE_PATH ?? '').split(path.delimiter).filter(Boolean),
    alias: { react: path.join(repo, 'node_modules/react'), 'react-dom': path.join(repo, 'node_modules/react-dom') },
    plugins: [{ name: 'expose-pane-for-test', setup(builder) {
      builder.onLoad({ filter: /\/src\/client\.tsx$/ }, async ({ path: filename }) => ({
        contents: await fs.readFile(filename, 'utf8') + '\nexport { ForwardPane, installStyles };', loader: 'tsx',
      }))
    } }],
  })
  const bundle = await fs.readFile(path.join(temp, 'fixture.js'))
  const styles = await fs.readFile(path.join(temp, 'fixture.css'))
  server = createServer((req, res) => {
    res.setHeader('content-type', req.url === '/fixture.js' ? 'text/javascript' : req.url === '/fixture.css' ? 'text/css' : 'text/html')
    res.end(req.url === '/fixture.js' ? bundle : req.url === '/fixture.css' ? styles : '<link rel="stylesheet" href="/fixture.css"><style>body{margin:0}</style><div id="root"></div><script src="/fixture.js"></script>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  browser = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
  watchdog = setTimeout(() => { void browser.close() }, 90000)
  for (const lang of ['zh', 'en']) for (const initialWidth of [375, 1024]) {
    const page = await browser.newPage({ viewport: { width: initialWidth, height: 900 }, hasTouch: initialWidth === 375 })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    let rules = ['host', 'other'].map(profileId => ({ id: profileId, profileId, name: `${profileId} existing rule`, kind: 'local', bindHost: '127.0.0.1', bindPort: 10000, targetHost: '127.0.0.1', targetPort: 80 }))
    let statuses = rules.map(rule => ({ ruleId: rule.id, state: 'stopped', bindHost: rule.bindHost, bindPort: rule.bindPort, connections: 0 }))
    let occupied = true, serial = 0
    await page.route('**/ssh-local/v1/forwards**', async route => {
      const req = route.request(), url = new URL(req.url())
      const parts = url.pathname.split('/').slice(4)
      const ruleIndex = rules.findIndex(rule => rule.id === parts[0])
      const forwardStatus = statuses.find(item => item.ruleId === parts[0])
      let result = {}, status = 200
      if (req.method() === 'GET') result = { rules, statuses }
      else if (req.method() === 'POST' && parts.length === 0) {
        const rule = { ...req.postDataJSON().rule, id: `rule-${++serial}` }
        rules.push(rule)
        statuses.push({ ruleId: rule.id, state: 'stopped', bindHost: rule.bindHost, bindPort: rule.bindPort, connections: 0 })
        result = { rule, status: statuses.at(-1) }
      } else if (req.method() === 'PUT') {
        rules[ruleIndex] = { ...rules[ruleIndex], ...req.postDataJSON().rule }
        result = { rule: rules[ruleIndex], status: forwardStatus }
      } else if (parts[1] === 'start') {
        forwardStatus.state = occupied ? 'error' : 'running'
        if (occupied) { status = 409; result = { error: 'EADDRINUSE: address already in use' }; occupied = false }
        else result = forwardStatus
      } else if (parts[1] === 'stop') { forwardStatus.state = 'stopped'; result = forwardStatus }
      else if (req.method() === 'DELETE') { rules = rules.filter(rule => rule.id !== parts[0]); statuses = statuses.filter(item => item.ruleId !== parts[0]) }
      await route.fulfill({ status, json: result })
    })
    await page.goto(`http://127.0.0.1:${server.address().port}/?lang=${lang}`)
    const copy = lang === 'zh'
      ? { add: '新建规则', save: '保存规则', start: '启动', edit: '编辑', stop: '停止', del: '删除' }
      : { add: 'New rule', save: 'Save rule', start: 'Start', edit: 'Edit', stop: 'Stop', del: 'Delete' }
    const allRows = page.locator('.dsh-ssh-forward-row')
    const row = allRows.filter({ hasText: /Local forward|Edited forward/ })
    const filter = page.locator('.dsh-ssh-page-target [role="combobox"]')
    const allHosts = lang === 'zh' ? '全部主机' : 'All hosts'
    await allRows.first().waitFor()
    assert.equal(await filter.inputValue(), '')
    assert.equal(await allRows.count(), 2, 'Entry defaults to all host rules')
    await filter.click()
    await page.getByRole('option', { name: /^Test SSH/ }).click()
    assert.equal(await allRows.count(), 1)
    assert.equal(await allRows.first().locator('strong').textContent(), 'host existing rule')
    await filter.click()
    await page.getByRole('option', { name: allHosts, exact: true }).click()
    assert.equal(await filter.inputValue(), '')
    assert.equal(await allRows.count(), 2)
    await filter.click()
    await filter.fill('Other SSH')
    await filter.press('Enter')
    assert.equal(await allRows.count(), 1, 'Search and keyboard selection filter the host')
    await filter.click()
    await filter.fill('Other')
    await filter.fill('')
    await filter.press('Tab')
    assert.equal(await filter.inputValue(), '')
    assert.equal(await allRows.count(), 2, 'Clearing the field restores all rules')
    // Keep the window unchanged throughout create, save and immediate interaction.
    await page.getByRole('button', { name: copy.add, exact: true }).click()
    const dialog = page.locator('.dsh-ssh-dialog')
    assert.equal(await dialog.getByRole('button', { name: copy.save, exact: true }).isEnabled(), false)
    await dialog.getByRole('combobox').first().click()
    await page.getByRole('option', { name: /^Test SSH/ }).click()
    await dialog.locator('input:not([role="combobox"])').first().fill('Local forward')
    await dialog.getByRole('button', { name: copy.save, exact: true }).click()
    await row.waitFor()
    const checkActions = async () => {
      assert.equal(await row.locator('button').count(), 3)
      for (const button of await row.locator('button').all()) {
        assert.equal(await button.isVisible(), true, 'Saved forward actions must be visible without reloading')
        const box = await button.boundingBox()
        assert.ok(box.x >= 0 && box.x + box.width <= page.viewportSize().width, 'Action stays in the viewport')
      }
      assert.deepEqual(errors, [])
    }
    await checkActions()
    for (const width of [375, 600, 820, 821, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await checkActions()
      await row.hover()
      assert.deepEqual(await page.locator('.dsh-ssh-forward-list').evaluate(list => {
        const css = getComputedStyle(list)
        return [css.overflowX, css.overflowY, css.borderTopLeftRadius, css.borderBottomRightRadius]
      }), ['hidden', 'hidden', '18px', '18px'], 'Hover remains clipped to the rounded list')
      if (process.env.DSH_BROWSER_SCREENSHOTS && initialWidth === 1024 && [375, 1024].includes(width)) {
        await fs.mkdir(process.env.DSH_BROWSER_SCREENSHOTS, { recursive: true })
        await page.screenshot({ path: path.join(process.env.DSH_BROWSER_SCREENSHOTS, `${lang}-${width}.png`) })
      }
    }
    // A local listener occupying the port must still leave retry/edit/delete available.
    await row.getByRole('button', { name: copy.start, exact: true }).click()
    await page.getByText('EADDRINUSE: address already in use', { exact: true }).waitFor()
    await checkActions()
    await row.getByRole('button', { name: copy.start, exact: true }).click()
    await row.getByRole('button', { name: copy.stop, exact: true }).waitFor()
    await checkActions()
    await row.getByRole('button', { name: copy.stop, exact: true }).click()
    await row.getByRole('button', { name: copy.start, exact: true }).waitFor()
    await row.getByRole('button', { name: copy.edit, exact: true }).click()
    assert.match(await dialog.getByRole('combobox').first().inputValue(), /^Test SSH/)
    await dialog.locator('input:not([role="combobox"])').first().fill('Edited forward')
    await dialog.getByRole('button', { name: copy.save, exact: true }).click()
    await row.getByText('Edited forward', { exact: true }).waitFor()
    await checkActions()
    await row.getByRole('button', { name: copy.del, exact: true }).click()
    await page.locator('.dsh-ssh-confirmation .dsh-ssh-danger-button').click()
    await row.waitFor({ state: 'detached' })
    assert.equal(await allRows.count(), 2)
    // Filter-local state cannot leak into another SSH page or the next visit.
    await filter.click()
    await page.getByRole('option', { name: /^Other SSH/ }).click()
    assert.equal(await allRows.count(), 1)
    await page.getByRole('button', { name: copy.add, exact: true }).click()
    assert.match(await dialog.getByRole('combobox').first().inputValue(), /^Other SSH/, 'A filtered new rule defaults to that host')
    await dialog.locator('[data-ssh-dialog-close]').click()
    await dialog.waitFor({ state: 'detached' })
    await filter.click()
    await page.getByRole('option', { name: allHosts, exact: true }).click()
    await allRows.filter({ hasText: 'other existing rule' }).getByRole('button', { name: copy.edit, exact: true }).click()
    assert.match(await dialog.getByRole('combobox').first().inputValue(), /^Other SSH/)
    await dialog.getByRole('button', { name: copy.save, exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.equal(rules.find(rule => rule.id === 'other').profileId, 'other', 'Editing uses the rule owner')
    await filter.click()
    await page.getByRole('option', { name: /^Other SSH/ }).click()
    await page.evaluate(() => window.showForwards(false))
    await allRows.waitFor({ state: 'detached' })
    await page.evaluate(() => window.showForwards(true))
    await allRows.first().waitFor()
    assert.equal(await filter.inputValue(), '')
    assert.equal(await allRows.count(), 2, 'Re-entry resets the filter to all hosts')
    assert.deepEqual(errors, [])
    console.log(`PASS ${lang} initial=${initialWidth}px: all-host entry/filter/reset/re-entry; correct editor host; save without resize/restart; 375–1024px actions/rounded hover; conflict/retry/start/stop/edit/delete`)
    await page.close()
  }
} finally {
  clearTimeout(watchdog)
  await browser?.close()
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  await fs.rm(temp, { recursive: true, force: true })
}
