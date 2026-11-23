// Isolated browser fixture: real mount UI + save queue, no production data or SSH connections.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const { chromium } = await import(process.env.SSH_PLAYWRIGHT_MODULE ?? 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const bundle = await build({
  nodePaths: (process.env.DSH_UI_TEST_NODE_PATH ?? '').split(':').filter(Boolean),
  alias: { react: `${root}node_modules/react` },
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {RemoteWorkspaceTree} from './src/remote-workspace-tree.tsx';
    import {useSessionAccess} from './src/session-access.ts'; import {sshLocale} from './src/i18n.ts';
    import {installStyles} from './src/client.tsx'; installStyles();
    const profiles=['a','b','c','u'].map(id=>({id,name:{a:'应用服务器',b:'数据库服务器',c:'其他主机',u:'未分组主机'}[id],
      group:id==='a'||id==='b'?'生产环境':id==='c'?'其他分组':undefined,
      host:'192.0.2.1',username:'fixture',port:22,tags:[],proxy:{type:'none'},credential:{configured:true}}));
    function Fixture(){
      const [session,setSession]=useState('independent'); window.selectSession=setSession; window.setLocale=locale=>sshLocale.setLocale(locale);
      const access=useSessionAccess(session||undefined);
      return <div className="dsh-ssh-workspace dsh-ssh-workspace-v2" style={{height:'100%',minWidth:0}}><RemoteWorkspaceTree catalogue profiles={profiles} groupConfigs={[{name:'空分组'}]}
        access={access.value} accessLoading={access.loading} accessSaving={access.saving} accessError={access.error}
        workspaces={[{workspaceId:'workspace',title:'示例项目',path:'/fixture'}]}
        currentWorkspaceId={session==='inherit'?'workspace':undefined} selected={null} onSelect={()=>{}}
        onProfiles={access.setProfiles} onMountMode={access.setMountMode} onDirectory={access.setDirectory}
        onToggleProject={access.toggleProject} onPermission={access.setPermission} onApproval={access.setRequireCommandApproval}
        onProjectsChanged={access.refresh} onGroupProxy={()=>{}} onCreateSession={async()=>{}}
        onNewProfile={()=>{}} onNewGroup={()=>{}} onEditProfile={()=>{}} onMoveProfile={async()=>{}}/></div>;
    } createRoot(document.getElementById('root')).render(<Fixture/>);
  ` },
  bundle: true, write: false, outdir: '/tmp/ssh-group-fixture', platform: 'browser', format: 'iife', jsx: 'automatic',
  loader: { '.css': 'text', '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
  plugins: [{ name: 'fixture-exports', setup(b) {
    b.onLoad({ filter: /\/src\/client\.tsx$/ }, async args => ({ loader: 'tsx', contents: (await readFile(args.path, 'utf8')).replace('function installStyles(', 'export function installStyles(') }))
    b.onLoad({ filter: /\.module\.css$/ }, async args => ({ loader: 'local-css', contents: await readFile(args.path, 'utf8') }))
  } }],
})
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text
const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? ''
const server = createServer((req, res) => {
  if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(js); return }
  res.setHeader('Content-Type', 'text/html')
  res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;background:#e8edef}#root{height:100dvh}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  for (const width of [375, 1024]) {
    browser = await chromium.launch({ headless: true, ...(process.env.SSH_CHROMIUM_EXECUTABLE ? { executablePath: process.env.SSH_CHROMIUM_EXECUTABLE } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', ...(process.env.SSH_CHROMIUM_SINGLE_PROCESS ? ['--single-process', '--no-zygote', '--in-process-gpu'] : [])] })
    const page = await browser.newPage({ viewport: { width, height: 950 }, reducedMotion: 'reduce' })
    page.setDefaultTimeout(12_000)
    const errors = [], writes = [], projectWrites = []
    let failSave = false
    const baseline = { profileIds: ['a', 'c'], mountedProjectIds: { a: ['p1', 'p2'], c: ['pc'] }, workingProjectIds: { a: 'p1', c: 'pc' } }
    let workspace = { workspaceId: 'workspace', revision: 'r1', ...structuredClone(baseline) }
    let independent = { sessionId: 'independent', mountMode: 'independent', ...structuredClone(baseline), workingDirectories: { a: '/app', c: '/other' }, fileEndpointIds: ['sftp:a'], filePermission: 'browse', permission: 'terminal', requireCommandApproval: true, requireFileApproval: true, updatedAt: 1 }
    const inherited = () => ({ ...independent, sessionId: 'inherit', mountMode: 'inherit', ...workspace, workingDirectories: Object.fromEntries(Object.entries(workspace.workingProjectIds).map(([id]) => [id, id === 'a' ? '/app' : '/other'])) })
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/ssh-local/v1/**', async route => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname.replace('/ssh-local/v1', '')
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      if (/^\/profiles\/[^/]+\/projects$/.test(path)) {
        const id = path.split('/')[2]
        return json(id === 'a' ? [{ id: 'p1', profileId: 'a', name: '应用目录', path: '/app' }, { id: 'p2', profileId: 'a', name: '日志目录', path: '/logs' }] : [])
      }
      if (path === '/injections') return json(url.searchParams.get('sessionId') === 'inherit' ? inherited() : independent)
      if (path === '/injections/independent' && req.method() === 'PUT') {
        writes.push(JSON.parse(req.postData()))
        if (failSave) { failSave = false; return json({ error: '模拟保存失败' }, 500) }
        independent = writes.at(-1); return json(independent)
      }
      if (path === '/project-mounts') {
        if (req.method() === 'PUT') { projectWrites.push(JSON.parse(req.postData())); workspace = { ...projectWrites.at(-1), revision: 'r2' } }
        return json(workspace)
      }
      errors.push(`Unexpected API: ${req.method()} ${path}`)
      return json({ error: 'Unexpected fixture API' }, 500)
    })
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    const actions = name => page.getByRole('group', { name: `「${name}」的整组挂载操作`, exact: true, includeHidden: true })
    const group = actions('生产环境'), mount = group.getByRole('button', { name: '挂载「生产环境」整组（共 2 台）', exact: true, includeHidden: true }), unmount = group.getByRole('button', { name: '卸载「生产环境」整组（共 2 台）', exact: true, includeHidden: true })
    const section = page.locator('.dsh-ssh-tree-group').filter({ has: page.locator('h3 > button[title="生产环境"]') })
    const header = section.locator('h3'), disclosure = header.locator(':scope > button')
    await disclosure.waitFor()
    await page.mouse.move(0, 0)
    assert.equal(await group.isVisible(), false, 'Group actions must be hidden at rest')
    assert.equal(await header.locator('small').isVisible(), true)
    const countBefore = await header.locator('small').boundingBox()
    await header.hover()
    assert.equal(await group.isVisible(), true, 'Hover reveals group actions')
    const countAfter = await header.locator('small').boundingBox(), mountBox = await mount.boundingBox(), unmountBox = await unmount.boundingBox()
    assert.ok(Math.abs(countAfter.x - countBefore.x) < 1, 'Count stays at the right edge')
    assert.ok(mountBox.x + mountBox.width <= unmountBox.x && unmountBox.x + unmountBox.width <= countAfter.x, 'Both actions appear to the left of the count')
    await page.mouse.move(0, 0)
    assert.equal(await group.isVisible(), false)
    await page.keyboard.press('Tab')
    await disclosure.focus()
    assert.equal(await group.isVisible(), true, 'Keyboard focus reveals group actions')

    await page.waitForFunction(() => document.querySelector('.dsh-ssh-group-mount-button:not(:disabled)'))
    assert.equal(await mount.isEnabled(), true); assert.equal(await unmount.isEnabled(), true)
    assert.match(await section.locator('h3 small').innerText(), /1 \/ 2/)
    assert.equal(await actions('空分组').locator('.dsh-ssh-group-mount-button').first().isDisabled(), true)
    assert.equal(await actions('空分组').locator('.dsh-ssh-group-mount-button').nth(1).isDisabled(), true)

    // A collapsed and searched group still acts on its complete membership.
    await section.locator('h3 > button').click()
    await page.getByRole('textbox').fill('应用服务器')
    assert.equal(await page.getByRole('button', { name: /数据库服务器 fixture@/ }).count(), 0)
    assert.equal(await page.getByText('整组操作包含搜索未显示的主机，数量按完整分组统计。').isVisible(), true)
    await header.hover()
    await mount.click()
    await page.waitForFunction(() => document.querySelector('.dsh-ssh-group-mount-button')?.disabled && !document.querySelectorAll('.dsh-ssh-group-mount-button')[1]?.disabled)
    assert.equal(writes.length, 1)
    assert.deepEqual(independent.profileIds, ['a', 'c', 'b'])
    assert.deepEqual(independent.mountedProjectIds.a, ['p1', 'p2'])
    assert.deepEqual(independent.mountedProjectIds.b, [])
    assert.deepEqual(independent.workingDirectories, { a: '/app', c: '/other' })
    assert.match(await section.locator('h3 small').innerText(), /2 \/ 2/)
    await header.hover()
    await unmount.click()
    await page.waitForFunction(() => !document.querySelector('.dsh-ssh-group-mount-button')?.disabled)
    assert.equal(writes.length, 2)
    assert.deepEqual(independent.profileIds, ['c'])
    assert.deepEqual(independent.workingProjectIds, { c: 'pc' })
    assert.deepEqual(independent.workingDirectories, { c: '/other' })
    assert.deepEqual(independent.mountedProjectIds, { c: ['pc'] })
    assert.deepEqual(independent.fileEndpointIds, ['sftp:a'])
    assert.equal(independent.permission, 'terminal')

    failSave = true
    await header.hover()
    await mount.click()
    await page.getByText('模拟保存失败', { exact: true }).waitFor()
    assert.equal(writes.length, 3)
    assert.deepEqual(independent.profileIds, ['c'])
    assert.match(await section.locator('h3 small').innerText(), /0 \/ 2/)
    assert.equal(await mount.isEnabled(), true)

    await page.getByRole('textbox').fill('')
    await page.evaluate(() => window.selectSession('inherit'))
    await page.getByText('继承自「示例项目」', { exact: false }).waitFor()
    assert.equal(await mount.isDisabled(), true); assert.equal(await unmount.isDisabled(), true)
    assert.match(await mount.getAttribute('title'), /编辑项目挂载/)
    await page.getByRole('button', { name: '编辑项目挂载', exact: true }).click()
    await page.getByRole('button', { name: '确认项目挂载', exact: true }).waitFor()
    await header.hover()
    await mount.click()
    assert.match(await section.locator('h3 small').innerText(), /2 \/ 2/)
    assert.equal(projectWrites.length, 0); assert.equal(writes.length, 3)
    await page.getByRole('button', { name: '取消', exact: true }).click()
    assert.match(await section.locator('h3 small').innerText(), /1 \/ 2/)
    assert.equal(projectWrites.length, 0)
    await page.getByRole('button', { name: '编辑项目挂载', exact: true }).click()
    await page.getByRole('button', { name: '确认项目挂载', exact: true }).waitFor()
    await header.hover()
    await unmount.click()
    assert.equal(projectWrites.length, 0)
    await page.getByRole('button', { name: '确认项目挂载', exact: true }).click()
    await page.getByRole('button', { name: '编辑项目挂载', exact: true }).waitFor()
    assert.equal(projectWrites.length, 1)
    assert.deepEqual(workspace.profileIds, ['c'])
    assert.deepEqual(workspace.mountedProjectIds, { c: ['pc'] })
    assert.deepEqual(workspace.workingProjectIds, { c: 'pc' })
    assert.equal(await mount.isDisabled(), true)

    await page.evaluate(() => window.selectSession(''))
    await page.waitForFunction(() => [...document.querySelectorAll('.dsh-ssh-group-mount-button')].every(button => button.disabled))
    assert.match(await mount.getAttribute('title'), /打开一个 DSH 会话|打开 DSH 会话|DSH/)
    await page.evaluate(() => window.setLocale('en'))
    await page.getByRole('button', { name: 'Mount all hosts in “生产环境” (2 total)', exact: true, includeHidden: true }).waitFor({ state: 'attached' })
    await header.hover()
    const dimensions = await page.evaluate(() => ({ window: window.innerWidth, document: document.documentElement.scrollWidth,
      headers: [...document.querySelectorAll('.dsh-ssh-tree-group h3')].map(el => ({ width: el.clientWidth, scroll: el.scrollWidth })) }))
    if (process.env.SSH_GROUP_SCREENSHOTS) {
      await mkdir(process.env.SSH_GROUP_SCREENSHOTS, { recursive: true })
      await page.screenshot({ path: `${process.env.SSH_GROUP_SCREENSHOTS}/group-mounts-${width}-hover.png`, fullPage: true })
      await page.mouse.move(0, 0)
      await page.screenshot({ path: `${process.env.SSH_GROUP_SCREENSHOTS}/group-mounts-${width}.png`, fullPage: true })
    }
    assert.ok(dimensions.document <= dimensions.window && dimensions.headers.every(el => el.scroll <= el.width), `Group actions overflow at ${width}px: ${JSON.stringify(dimensions)}`)
    assert.deepEqual(errors, [])
    console.log(`Group mounts passed at ${width}px: complete search scope, one-write batches, rollback, draft cancel/confirm, inherited/no-session guards, English layout, hover/focus visibility and right-aligned counts.`)
    await page.close()
    await browser.close()
  }
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
