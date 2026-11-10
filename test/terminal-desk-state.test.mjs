import test from 'node:test'
import assert from 'node:assert/strict'
import { TerminalDeskState, deskPaneRects, deskLayoutMode } from '../lib/terminal-desk-state.js'
import { writeTerminalStorage } from '../lib/terminal-workspace-state.js'
const target = (profileId = 'a') => ({profileId,path:'/work',label:'Project'})
const noDelete = async () => { throw Error('Unexpected deletion') }
const ids = tab => tab.panes.map(p=>p.id)

test('legacy host tabs migrate independently once without creating connections', () => {
  const scope='migration'
  writeTerminalStorage('dsh-ssh:workbench:v1:'+scope,{hosts:['a','b']})
  for(const host of ['a','b'])writeTerminalStorage('dsh-ssh:terminals:v1:'+JSON.stringify([scope,host]),{tabs:[{id:1,path:'/work',terminalId:'remote-'+host}]})
  const state=new TerminalDeskState(scope)
  assert.deepEqual(state.tabs.map(t=>t.profileId),['a','b']);assert.equal(new Set(state.tabs.map(t=>t.id)).size,2)
  assert.deepEqual(state.tabs.flatMap(t=>t.panes.map(p=>p.handle.id)),['remote-a','remote-b'])
  assert.ok(state.tabs.every(t=>t.panes.length===1&&!t.panes[0].autoConnect))
  state.tabs=[];state.activeId=0;state.save();assert.equal(new TerminalDeskState(scope).tabs.length,0)
})

test('old global split retains separate tabs and selected tab', async () => {
  writeTerminalStorage('dsh-ssh:terminal-desk:v1:global-split',{tabs:[{id:4,...target(),terminalId:'a'},{id:7,...target('b'),terminalId:'b'}],view:{panes:[4,7],focused:7}})
  const state=new TerminalDeskState('global-split');assert.equal(state.activeId,7);assert.deepEqual(state.tabs.map(t=>t.layout),[4,7])
  await state.applyLayout(7,'horizontal',noDelete);assert.equal(state.tabs.length,2);assert.equal(state.tabs[0].panes.length,1);assert.equal(state.activeTab.panes[1].profileId,'b');assert.ok(state.activeTab.panes[1].id>7)
})

test('presets have exact counts, directions and row-major grid; repeated choices do not create panes', async () => {
  const state=new TerminalDeskState('presets'),a=state.open(target()),b=state.open(target('b'))
  state.focus(a.id);state.setDirectory(state.currentPane.id,'/changed')
  await state.applyLayout(a.id,'horizontal',noDelete)
  const [first,second]=a.panes
  assert.equal(second.path,'/changed');assert.equal(second.profileId,'a');assert.equal(b.panes.length,1)
  assert.deepEqual(deskPaneRects(a.layout),[{id:first.id,left:0,top:0,width:50,height:100},{id:second.id,left:50,top:0,width:50,height:100}])
  await state.applyLayout(a.id,'vertical',noDelete)
  assert.deepEqual(ids(a),[first.id,second.id]);assert.deepEqual(deskPaneRects(a.layout),[{id:first.id,left:0,top:0,width:100,height:50},{id:second.id,left:0,top:50,width:100,height:50}])
  await state.applyLayout(a.id,'grid',noDelete);const four=ids(a)
  assert.equal(four.length,4);assert.deepEqual(deskPaneRects(a.layout).map(({left,top,width,height})=>[left,top,width,height]),[[0,0,50,50],[50,0,50,50],[0,50,50,50],[50,50,50,50]])
  await state.applyLayout(a.id,'grid',noDelete);assert.deepEqual(ids(a),four);assert.equal(state.tabs.length,2)
  state.focus(b.id);state.focus(a.id);assert.deepEqual(ids(a),four);assert.equal(state.open(target()),a)
})

test('reductions require valid explicit retained panes and unchanged snapshot before deleting anything', async () => {
  const state=new TerminalDeskState('guard'),tab=state.open(target());await state.applyLayout(tab.id,'grid',noDelete)
  let deletes=0;const remove=async()=>{deletes++},before=ids(tab)
  for(const [keep,snapshot] of [[undefined,undefined],[[before[0]],before],[[before[0],before[0]],before],[[before[0],999],before],[[before[0],before[1]],before.slice(1)]])await assert.rejects(state.applyLayout(tab.id,'horizontal',remove,keep,snapshot))
  assert.equal(deletes,0);assert.deepEqual(ids(tab),before)
})

test('four to two and two to one keep exactly the chosen connections, preserving focus when retained', async () => {
  const state=new TerminalDeskState('reduce'),tab=state.open(target());await state.applyLayout(tab.id,'grid',noDelete)
  tab.panes.forEach(p=>p.handle.id='remote-'+p.id);const before=ids(tab),removed=[]
  state.focusPane(tab.id,before[3]);await state.applyLayout(tab.id,'vertical',async id=>removed.push(id),[before[1],before[3]],before)
  assert.deepEqual(ids(tab),[before[1],before[3]]);assert.equal(tab.focused,before[3]);assert.deepEqual(removed,['remote-'+before[0],'remote-'+before[2]])
  await state.applyLayout(tab.id,'single',async id=>removed.push(id),[before[1]],ids(tab))
  assert.equal(tab.focused,before[1]);assert.equal(tab.layout,before[1]);assert.equal(tab.panes[0].handle.id,'remote-'+before[1]);assert.equal(removed.length,3)
})

test('partial reduction failures retain failed connections for retry without creating replacements', async () => {
  const state=new TerminalDeskState('failed-reduce'),tab=state.open(target());await state.applyLayout(tab.id,'grid',noDelete)
  tab.panes.forEach(p=>p.handle.id='remote-'+p.id);const before=ids(tab),remove=async id=>{if(id==='remote-'+before[2])throw Error('offline')}
  const errors=await state.applyLayout(tab.id,'horizontal',remove,[before[0],before[3]],before)
  assert.equal(errors.length,1);assert.deepEqual(ids(tab),[before[0],before[2],before[3]])
  assert.deepEqual(deskPaneRects(tab.layout).filter(r=>r.id!==0).map(r=>r.id),ids(tab))
  const restored=new TerminalDeskState('failed-reduce');assert.deepEqual(ids(restored.activeTab),ids(tab));assert.ok(restored.activeTab.panes.every(p=>p.handle.id))
  await state.applyLayout(tab.id,'horizontal',async()=>{},[before[0],before[3]],ids(tab));assert.deepEqual(ids(tab),[before[0],before[3]])
})

test('pending reduction remains tied to its original tab and simultaneous destructive requests are rejected', async () => {
  const state=new TerminalDeskState('scoped'),a=state.open(target());await state.applyLayout(a.id,'horizontal',noDelete)
  a.panes.forEach(p=>p.handle.id='remote-'+p.id);const snapshot=ids(a),b=state.open(target('b'));let finish
  const pending=state.applyLayout(a.id,'single',()=>new Promise(resolve=>{finish=resolve}),[snapshot[0]],snapshot)
  await assert.rejects(state.applyLayout(a.id,'grid',noDelete));assert.equal((await state.close([a.id],noDelete)).length,1)
  finish();await pending;assert.equal(state.activeTab,b);assert.equal(a.panes.length,1);assert.equal(b.panes.length,1)
})

test('refresh restores presets and handles without replay; legacy nested layouts normalize without closing connections', async () => {
  const state=new TerminalDeskState('restore'),tab=state.open(target());await state.applyLayout(tab.id,'grid',noDelete)
  tab.panes.forEach((p,i)=>{p.handle.id='remote-'+i});state.focusPane(tab.id,tab.panes[2].id);state.save()
  const restored=new TerminalDeskState('restore');assert.deepEqual(restored.activeTab.layout,tab.layout);assert.equal(restored.currentPane.id,tab.focused);assert.ok(restored.activeTab.panes.every(p=>!p.autoConnect))
  writeTerminalStorage('dsh-ssh:terminal-desk:v2:nested',{activeId:1,tabs:[{id:1,...target(),focused:3,panes:[1,2,3].map(id=>({id,path:'~',terminalId:'old-'+id})),layout:{direction:'horizontal',first:1,second:{direction:'vertical',first:2,second:3}}}]})
  const migrated=new TerminalDeskState('nested');assert.equal(migrated.activeTab.panes.length,3);assert.equal(deskLayoutMode(migrated.activeTab),'grid');assert.equal(migrated.currentPane.handle.id,'old-3');assert.deepEqual(deskPaneRects(migrated.activeTab.layout).map(r=>r.width),[50,50,50,50])
})

test('close all includes every pane in hidden tabs and retains failed panes', async () => {
  const state=new TerminalDeskState('close-all'),a=state.open(target());await state.applyLayout(a.id,'grid',noDelete);const b=state.open(target('b'));await state.applyLayout(b.id,'horizontal',noDelete)
  state.tabs.flatMap(t=>t.panes).forEach(p=>p.handle.id='remote-'+p.id);const failed=a.panes[2],removed=[]
  const errors=await state.close(state.tabs.map(t=>t.id),async id=>{if(id===failed.handle.id)throw Error('offline');removed.push(id)})
  assert.equal(errors.length,1);assert.equal(removed.length,5);assert.equal(state.tabs.length,1);assert.equal(state.currentPane,failed)
  await state.close([a.id],async()=>{});assert.equal(state.tabs.length,0)
})

test('closing while a connection is pending cleans up its late remote handle', async () => {
  const state=new TerminalDeskState('pending-close'),tab=state.open(target());await state.applyLayout(tab.id,'horizontal',noDelete)
  const pane=tab.panes[1],removed=[];let finish
  const opening=pane.handle.open(()=>new Promise(resolve=>{finish=resolve}),async id=>removed.push(id)).catch(e=>e)
  const closing=state.close([tab.id],async id=>removed.push(id));finish('late');await closing;await opening
  assert.deepEqual(removed,['late']);assert.equal(state.tabs.length,0)
})

test('file-only views remain per tab and added layout panes create only their own connections', async () => {
  const state=new TerminalDeskState('files'),a=state.open(target(),true,false),b=state.open(target('b'))
  await state.applyLayout(a.id,'horizontal',noDelete);assert.equal(a.filesOnly,false);assert.equal(a.panes[0].autoConnect,false);assert.equal(a.panes[1].autoConnect,true);assert.equal(b.panes.length,1)
})
