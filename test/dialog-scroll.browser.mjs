// Real React + host Modal, with all network access replaced by synthetic data.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
const { chromium } = await import(process.env.DSH_PLAYWRIGHT_MODULE ?? 'playwright')
const repo = fileURLToPath(new URL('../', import.meta.url))
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-dialog-scroll-'))
const report = process.env.DSH_DIALOG_REPORT
const exportsByFile = {
  'client.tsx': ['installStyles', 'ForwardEditor', 'VaultEditor', 'ProxyEditor'],
  'commands-panel.tsx': ['CommandEditor'], 'file-transfer-workspace.tsx': ['FileAccessDialog'],
  'remote-workspace-tree.tsx': ['RemoteProjectDialog'], 'terminal-desk.tsx': ['LayoutReductionDialog', 'NewDeskTerminal'],
  'sync-panel.tsx': ['SyncSetupDialog'], 'config-backup-panel.tsx': ['BackupDialog'],
}
let browser, server
try {
  await build({ stdin: { resolveDir: repo, loader: 'tsx', contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {installStyles,ForwardEditor,VaultEditor,ProxyEditor} from './src/client.tsx';
import {ProfileEditor,ProfileDeleteDialog} from './src/profile-editor.tsx';
import {FtpConnectionsDialog} from './src/ftp-profile-editor.tsx';
import {GroupProxyEditor} from './src/group-proxy-editor.tsx';
import {CommandEditor} from './src/commands-panel.tsx';
import {RemoteProjectDialog} from './src/remote-workspace-tree.tsx';
import {FileAccessDialog} from './src/file-transfer-workspace.tsx';
import {ProjectSessionDialog} from './src/project-session-dialog.tsx';
import {LayoutReductionDialog,NewDeskTerminal} from './src/terminal-desk.tsx';
import {SyncSetupDialog} from './src/sync-panel.tsx';
import {BackupDialog} from './src/config-backup-panel.tsx';
import {VaultPasswordDialog} from './src/vault-password-dialog.tsx';
import {Dialog} from './src/ui-components.tsx';
import {SftpFilePreview,ProfileSftpPane} from './src/sftp-client.tsx';
import {ICON_SYMBOLS,Modal} from '@deepseek-ai/dsh-client-ui-primitives';
import {sshLocale} from './src/i18n.ts';
sshLocale.setLocale('zh');installStyles();
const sprite=document.createElementNS('http://www.w3.org/2000/svg','svg');sprite.style.display='none';for(const[id,markup]of Object.entries(ICON_SYMBOLS)){const svg=new DOMParser().parseFromString(markup,'image/svg+xml').documentElement,symbol=document.createElementNS(sprite.namespaceURI,'symbol');symbol.id=id;for(const a of svg.attributes)if(a.name!=='xmlns')symbol.setAttribute(a.name,a.value);symbol.innerHTML=svg.innerHTML;sprite.append(symbol)}document.body.append(sprite);
const profile={id:'demo',name:'测试主机',host:'192.0.2.8',port:22,username:'admin',tags:['研发','部署'],group:'研发',authType:'password',proxy:{type:'none'},credential:{configured:true,fields:['password'],source:'profile'}};
const profiles=[profile,{...profile,id:'second',name:'部署主机',group:'部署'}];
const ftp={...profile,id:'ftp',protocol:'ftps-explicit',authMode:'password',initialPath:'/'};
const vault={id:'vault',name:'测试凭据',username:'admin',authType:'password',credential:{fields:['password']}};
const project={id:'project',profileId:'demo',name:'项目目录',path:'/srv/project'};
const workspaces=Array.from({length:24},(_,i)=>({workspaceId:'project'+i,name:'工作项目 '+i,title:'工作项目 '+i,path:'/srv/project/'+i}));
const endpoints=Array.from({length:24},(_,i)=>({id:'ftp'+i,name:'文件主机 '+i,address:'admin@192.0.2.8:21',kind:'ftp',protocol:'ftps-explicit'}));
const noop=()=>{};const access={value:{fileEndpointIds:[],filePermission:'browse',requireFileApproval:true},setFileEndpoints:noop,setFilePermission:noop,setRequireFileApproval:noop};
window.calls=[];window.fetch=async(url,init={})=>{const p=String(url);window.calls.push({url:p,method:init.method||'GET'});let json=[];if(p.endsWith('/profiles'))json=init.method?profile:profiles;else if(p.includes('/sftp/directory'))json={path:'/',parent:null,entries:Array.from({length:50},(_,i)=>({name:'directory-'+i,path:'/directory-'+i,kind:'directory',size:0}))};return Response.json(json)};
const text='测试预览内容\\n'.repeat(100);
function App(){const[mode,setMode]=useState('none');window.show=setMode;const close=()=>setMode('none'),done=()=>{window.saved=true;close()};const common={onClose:close,onSaved:done};return <main className="dsh-ssh-workspace" style={{height:'100vh',padding:24}}><h1>SSH 测试</h1><button id="launcher">打开</button><p>画布背景保持微透</p>
{mode==='host-new'&&<ProfileEditor profiles={profiles} vaultEntries={[]} proxyEntries={[]} {...common}/>}
{mode==='host-edit'&&<ProfileEditor profile={{...profile,name:'长主机名称用于检查换行'.repeat(4)}} profiles={profiles} vaultEntries={[]} proxyEntries={[]} {...common}/>}
{mode==='forward'&&<ForwardEditor profiles={profiles} profile={profile} {...common}/>}
{mode==='vault'&&<VaultEditor value={{...vault,authType:'private-key',credential:{fields:['privateKey']}}} {...common}/>}
{mode==='proxy'&&<ProxyEditor {...common}/>}
{mode==='group'&&<GroupProxyEditor name="研发分组" proxies={[]} {...common}/>}
{mode==='command'&&<CommandEditor {...common}/>}
{mode==='project'&&<RemoteProjectDialog profile={profile} {...common}/>}
{mode==='ftp'&&<FtpConnectionsDialog profiles={[ftp]} vaultEntries={[]} proxyEntries={[]} onClose={close} onChanged={done}/>}
{mode==='access'&&<FileAccessDialog endpoints={endpoints} access={access} onClose={close} uploadConcurrency={4} downloadConcurrency={4} onUploadConcurrency={noop} onDownloadConcurrency={noop}/>}
{mode==='session'&&<ProjectSessionDialog profile={profile} project={project} workspaces={workspaces} returnFocus={document.getElementById('launcher')} onClose={close} onCreate={async()=>done()}/>}
{mode==='confirm'&&<ProfileDeleteDialog profile={profile} dependents={profiles.slice(1)} onClose={close} onDeleted={done}/>}
{mode==='long-confirm'&&<Dialog variant="confirmation" title="删除确认" subtitle={'确认信息很长，需要滚动查看。'.repeat(80)} onClose={close}><div className="dsh-ssh-dialog-actions"><button onClick={close}>取消</button><button onClick={done}>确认</button></div></Dialog>}
{mode==='layout'&&<LayoutReductionDialog tab={{layout:{direction:'horizontal',first:{direction:'vertical',first:1,second:2},second:{direction:'vertical',first:3,second:4}},focused:1,panes:[1,2,3,4].map(id=>({id,path:'/srv/project',phase:'ready'}))}} count={1} busy={false} onClose={close} onConfirm={done}/>}
{mode==='terminal'&&<NewDeskTerminal profiles={profiles} onOpen={done} onTemporary={done} onClose={close}/>}
{mode==='sync'&&<SyncSetupDialog initial={{tokenConfigured:false,encryptionConfigured:false,autoSync:false}} onClose={close} onUpdated={done}/>}
{mode==='backup'&&<BackupDialog mode="export" onClose={close} onDone={done}/>}
{mode==='password'&&<VaultPasswordDialog entry={vault} onClose={close}/>}
{mode==='preview'&&<SftpFilePreview entry={{name:'README.txt',path:'/README.txt',kind:'file',size:1000}} loadPreview={async()=>({kind:'text',text,mimeType:'text/plain',size:1000})} loadPathEntry={async()=>({})} fileUrl={()=>'/fixture-file'} onBack={close}/>}
{mode==='directory'&&<ProfileSftpPane profile={profile}/>}
{mode==='foreign'&&<Modal open headless className="unrelated-native-modal" title="其他插件" onClose={close}>其他弹窗</Modal>}
</main>};createRoot(document.getElementById('root')).render(<App/>);` },
    outfile: path.join(temp, 'fixture.js'), bundle: true, platform: 'browser', jsx: 'automatic',
    loader: { '.css': 'text', '.module.css': 'local-css' },
    nodePaths: (process.env.DSH_BROWSER_NODE_PATH ?? '').split(path.delimiter).filter(Boolean),
    alias: { react: path.join(repo, 'node_modules/react'), 'react-dom': path.join(repo, 'node_modules/react-dom') },
    plugins: [{ name: 'expose-dialogs', setup(b) { b.onLoad({ filter: /\/src\/[^/]+\.tsx$/ }, async ({ path: file }) => {
      const names = exportsByFile[path.basename(file)]
      if (names) return { contents: await fs.readFile(file, 'utf8') + '\nexport {' + names.join(',') + '};', loader: 'tsx' }
    }) } }],
  })
  const [bundle, styles] = await Promise.all(['fixture.js', 'fixture.css'].map(f => fs.readFile(path.join(temp, f))))
  server = createServer((req, res) => {
    res.setHeader('content-type', req.url === '/fixture.js' ? 'text/javascript' : req.url === '/fixture.css' ? 'text/css' : 'text/html;charset=utf-8')
    res.end(req.url === '/fixture.js' ? bundle : req.url === '/fixture.css' ? styles : '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>*{box-sizing:border-box}:root{--dsw-alias-bg-mask-1:rgba(0,0,0,.35);--dsw-mask-blur:blur(4px)}body{margin:0;background:#ebebeb}body[data-ds-dark-theme]{background:#101719}</style><div id="root"></div><script src="/fixture.js"></script>')
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  browser = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
  const errors = [], results = []
  const modes = ['host-new','host-edit','forward','vault','proxy','group','command','project','ftp','access','session','confirm','long-confirm','layout','terminal','sync','backup','password','preview','directory']
  for (const viewport of [{width:1280,height:560},{width:390,height:500},{width:844,height:390}]) for (const dark of [false,true]) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' })
    page.on('pageerror', e => {errors.push(e.message);console.error(e.stack)})
    await page.goto('http://127.0.0.1:' + server.address().port)
    await page.waitForFunction(() => typeof window.show === 'function')
    await page.evaluate(dark => document.body.toggleAttribute('data-ds-dark-theme', dark), dark)
    for (const mode of modes) {
      const context = JSON.stringify({mode,viewport,dark}); console.log('Checking',context)
      await page.evaluate(mode => { window.saved=false; window.show(mode) }, mode)
      if (mode === 'ftp') await page.locator('.dsh-ssh-ftp-profile-main').click()
      if (mode === 'preview') await page.locator('.dsh-ssh-file-preview-actions button').filter({has:page.locator('svg')}).last().click()
      if (mode === 'directory') await page.getByRole('button', {name:'展开目录',exact:true}).click()
      const shell = page.locator('.dsh-ssh-dialog, .dsh-ssh-session-create-shell, .dsh-ssh-preview-modal-shell').last()
      await shell.waitFor({timeout:5000})
      await page.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.effect?.getTiming().iterations===Infinity?Promise.resolve():a.finished.catch(()=>{})))})
      const header = shell.locator(':scope > header')
      const initial = await header.boundingBox()
      assert.ok(initial && initial.y >= 0, 'header fits: '+context)
      const geometry = await shell.evaluate(e => {
        const head=e.querySelector(':scope > header'), h=head.getBoundingClientRect(), box=e.getBoundingClientRect()
        const scrolls=[...e.querySelectorAll('*')].filter(n => /auto|scroll/.test(getComputedStyle(n).overflowY) && n.scrollHeight>n.clientHeight+1 && n.clientHeight>0)
        const areas=scrolls.map(n=>{const r=n.getBoundingClientRect();return {className:n.className,top:r.top,bottom:r.bottom,height:r.height,scrollRange:n.scrollHeight-n.clientHeight}})
        for(const fraction of [0,.5,1]) {
          for(const n of scrolls)n.scrollTop=(n.scrollHeight-n.clientHeight)*fraction
          const r=head.getBoundingClientRect()
          if(Math.abs(r.top-h.top)>1 || !head.contains(document.elementFromPoint(r.left+r.width/2,r.bottom-3))) throw Error('Scrolling overlaps dialog title')
        }
        e.scrollTop=100
        return {shellTop:box.top,shellBottom:box.bottom,shellScroll:e.scrollTop,overflow:e.scrollWidth>e.clientWidth,headerBottom:h.bottom,areas,glass:getComputedStyle(e.closest('[role=dialog]').matches('.dsh-ssh-preview-modal,.dsh-ssh-session-create-modal')?e.closest('[role=dialog]'):e).backdropFilter}
      })
      assert.equal(geometry.shellScroll,0,'shell must not scroll: '+context)
      assert.equal(geometry.overflow,false,'no horizontal clipping: '+context)
      assert.ok(geometry.shellBottom<=viewport.height+1,'dialog fits height: '+context+JSON.stringify(geometry))
      assert.ok(geometry.glass.includes('32px'),'glass preserved: '+context)
      for (const area of geometry.areas) assert.ok(area.top>=geometry.headerBottom-1,'scroll pane below header: '+context+JSON.stringify(area))
      const after=await header.boundingBox()
      assert.ok(Math.abs(after.y-initial.y)<1 && Math.abs(after.height-initial.height)<1,'header stays fixed: '+context+JSON.stringify({initial,after}))
      assert.equal(await header.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.left+r.width/2,r.bottom-3))}),true,'content must never paint in header: '+context)
      const control=shell.locator('button:enabled,input:enabled:not([type=hidden]),textarea:enabled,select:enabled,a[href]').last()
      if(await control.count()) {
        await control.focus()
        const rect=await control.boundingBox()
        const inHeader=await control.evaluate(e=>e.closest('header')===e.closest('.dsh-ssh-preview-modal-shell')?.querySelector(':scope > header'))
        assert.ok(rect && (inHeader || rect.y>=geometry.headerBottom-1) && rect.y+rect.height<=viewport.height+1,'last control reachable: '+context+JSON.stringify(rect))
        await page.keyboard.press('Tab')
        assert.ok(await page.locator('[role=dialog]').last().evaluate(e=>e.contains(document.activeElement)),'Tab stays in modal: '+context)
        await page.keyboard.press('Shift+Tab')
      }
      const mask=page.locator('body > [role=presentation]:has(> [role=dialog])').last().locator(':scope > [aria-hidden=true]')
      assert.equal(await mask.evaluate(e=>getComputedStyle(e,'::after').backgroundColor),'rgba(0, 0, 0, 0)','no backdrop dim: '+context)
      assert.equal(await mask.evaluate(e=>getComputedStyle(e).backdropFilter),'none','no backdrop blur: '+context)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'page fits: '+context)
      if (report && ['host-new','access','ftp','session','preview'].includes(mode)) await page.screenshot({path:path.join(report,mode+'-'+viewport.width+'-'+(dark?'dark':'light')+'.png'),animations:'disabled'})
      results.push({mode,viewport,dark,...geometry})
      await page.evaluate(()=>window.show('none'))
      await page.locator('[role=dialog]').waitFor({state:'detached'})
    }
    // A group dropdown remains interactive in the clipped content viewport.
    await page.evaluate(()=>window.show('host-new'))
    const group=page.getByRole('combobox',{name:'主机分组',exact:true})
    await group.click();await page.getByRole('option',{name:'部署',exact:true}).click()
    assert.equal(await group.inputValue(),'部署')
    await page.keyboard.press('Escape');await page.locator('[role=dialog]').waitFor({state:'detached'})
    // Reparenting the form preserves native validation and Save submission.
    await page.evaluate(()=>window.show('host-new'))
    await page.locator('.dsh-ssh-dialog-body .dsh-ssh-field input').first().fill('浏览器回归')
    await page.getByPlaceholder('server.example.com').fill('192.0.2.99')
    await page.locator('input[autocomplete=username]').fill('fixture')
    await page.locator('input[type=password]').fill('synthetic-test-only')
    await page.getByRole('button',{name:'保存连接',exact:true}).click()
    await page.waitForFunction(()=>window.saved===true)
    const writes=await page.evaluate(()=>window.calls.filter(c=>c.method!=='GET'))
    assert.equal(writes.length,1,'only explicit Save writes')
    assert.ok(writes[0].url.endsWith('/profiles') && writes[0].method==='POST')
    await page.evaluate(()=>window.calls=[])
    // Unrelated host masks and reduced-transparency fallback remain unchanged.
    await page.evaluate(()=>window.show('foreign'))
    assert.equal(await page.locator('body > [role=presentation]:has(> .unrelated-native-modal) > [aria-hidden=true]').evaluate(e=>getComputedStyle(e,'::after').backgroundColor),'rgba(0, 0, 0, 0.35)')
    await page.evaluate(()=>window.show('none'))
    const cdp=await page.context().newCDPSession(page)
    await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'},{name:'prefers-reduced-motion',value:'reduce'}]})
    await page.evaluate(()=>window.show('host-new'))
    assert.equal(await page.locator('.dsh-ssh-dialog').evaluate(e=>getComputedStyle(e).backdropFilter),'none')
    assert.deepEqual(await page.evaluate(()=>window.calls.filter(c=>c.method!=='GET')),[],'inspection must not write or connect')
    await page.close()
  }
  assert.deepEqual(errors,[])
  if(report)await fs.writeFile(path.join(report,'browser-results.json'),JSON.stringify({results,pageErrors:errors,hostPrimitives:true,apiStubbed:true},null,2))
  console.log('PASS: '+results.length+' real dialog cases; fixed headers, clipped independent content, reachable controls, keyboard focus, desktop/mobile/landscape, light/dark, glass and undimmed backdrop')
} finally {
  await browser?.close()
  if(server){server.closeAllConnections();await new Promise(r=>server.close(r))}
  await fs.rm(temp,{recursive:true,force:true})
}
