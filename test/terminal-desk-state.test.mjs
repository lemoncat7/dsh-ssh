import test from 'node:test'
import assert from 'node:assert/strict'
import { TerminalDeskState } from '../lib/terminal-desk-state.js'
import { writeTerminalStorage } from '../lib/terminal-workspace-state.js'

test('global desk migrates host tabs once without creating remote connections', () => {
  const scope = 'migration'
  writeTerminalStorage('dsh-ssh:workbench:v1:' + scope, { hosts: ['a', 'b'] })
  for (const host of ['a','b']) writeTerminalStorage('dsh-ssh:terminals:v1:' + JSON.stringify([scope, host]), { tabs: [{ id: 1, path: '/work', terminalId: 'remote-'+host }] })
  const state = new TerminalDeskState(scope)
  assert.deepEqual(state.tabs.map(tab => tab.profileId), ['a','b'])
  assert.equal(new Set(state.tabs.map(tab => tab.id)).size, 2)
  assert.deepEqual(state.tabs.map(tab => tab.handle.id), ['remote-a','remote-b'])
  assert.ok(state.tabs.every(tab => !tab.autoConnect))
  state.tabs=[];state.view={panes:[],focused:0};state.save()
  assert.equal(new TerminalDeskState(scope).tabs.length,0,'closed tabs must not be reimported')
})

test('double opening focuses an existing target; explicit new creates an independent tab', () => {
  const state = new TerminalDeskState('opens')
  const a=state.open({profileId:'a',path:'/project',label:'Project'})
  assert.equal(state.open({profileId:'a',path:'/project'}),a)
  const b=state.open({profileId:'b',path:'/project'})
  assert.notEqual(a.id,b.id)
  const another=state.open({profileId:'a',path:'/project'},true)
  assert.notEqual(another.id,a.id); assert.equal(state.tabs.length,3)
  state.view={panes:[a.id,b.id],focused:a.id};state.focus(b.id)
  assert.deepEqual(state.view,{panes:[a.id,b.id],focused:b.id})
  state.direction='vertical';state.setDirectory(b.id,'/changed');state.save()
  const restored=new TerminalDeskState('opens')
  assert.deepEqual(restored.view,state.view);assert.equal(restored.direction,'vertical')
  assert.equal(restored.tabs.find(tab=>tab.id===b.id).directory,'/changed')
  assert.ok(restored.tabs.every(tab=>!tab.autoConnect),'refresh cannot rerun an unconnected request')
  assert.equal(new TerminalDeskState('another-session').tabs.length,0)
})

test('close-all includes hidden hosts and retains only failed removals', async () => {
  const state=new TerminalDeskState('close-all')
  for (const id of ['a','b','c']) state.open({profileId:id,path:'~'}).handle.id='remote-'+id
  const removed=[]
  const errors=await state.close(state.tabs.map(tab=>tab.id),async id=>{if(id==='remote-b')throw Error('offline');removed.push(id)})
  assert.equal(errors.length,1);assert.deepEqual(removed,['remote-a','remote-c'])
  assert.equal(state.tabs.length,1);assert.equal(state.tabs[0].profileId,'b')
  assert.deepEqual(state.view,{panes:[state.tabs[0].id],focused:state.tabs[0].id})
  assert.equal(new TerminalDeskState('close-all').tabs[0].handle.id,'remote-b')
})

test('file-only target never asks to create a shell', () => {
  const state=new TerminalDeskState('files')
  const tab=state.open({profileId:'a',path:'/files'},true,false)
  assert.equal(tab.autoConnect,false);assert.equal(tab.handle.id,undefined)
})
