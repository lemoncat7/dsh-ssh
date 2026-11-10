import test from 'node:test'
import assert from 'node:assert/strict'
import { BrowserTerminalHandle, terminalWorkspaceState, readWorkbenchState, writeWorkbenchState } from '../lib/terminal-workspace-state.js'

test('a pending connection survives navigation and is shared with the returning view', async () => {
  let finish, count = 0
  const handle = new BrowserTerminalHandle(undefined, () => count++)
  const removed = []
  const first = handle.open(() => new Promise(resolve => { finish = resolve }), async id => removed.push(id))
  const second = handle.open(() => { throw Error('duplicate create') }, async id => removed.push(id))
  finish('remote-1')
  assert.equal(await first, 'remote-1'); assert.equal(await second, 'remote-1')
  assert.equal(handle.id, 'remote-1'); assert.equal(count, 1); assert.deepEqual(removed, [])
  await handle.close(async id => removed.push(id))
  assert.deepEqual(removed, ['remote-1']); assert.equal(handle.id, undefined)
})

test('explicit close during creation cleans up the late channel', async () => {
  let finish
  const handle = new BrowserTerminalHandle(undefined, () => {})
  const removed = []
  const opening = handle.open(() => new Promise(resolve => { finish = resolve }), async id => removed.push(id))
  const rejected = assert.rejects(opening, /closed while connecting/)
  const closing = handle.close(async id => removed.push(id))
  finish('late-channel'); await closing; await rejected
  assert.deepEqual(removed, ['late-channel']); assert.equal(handle.id, undefined)
})

test('failed explicit delete retains the channel for retry', async () => {
  const handle = new BrowserTerminalHandle('existing', () => {})
  await assert.rejects(handle.close(async () => { throw Error('offline') }), /offline/)
  assert.equal(handle.id, 'existing')
  await handle.close(async () => {}); assert.equal(handle.id, undefined)
})

test('layout survives navigation and scopes hosts and conversations separately', () => {
  const a = terminalWorkspaceState('session-a', 'host-a', '/initial')
  a.tabs.push({ id: 2, number: 2, path: '/other', handle: new BrowserTerminalHandle('remote-2', a.save) })
  a.view = { panes: [1, 2], focused: 2 }; a.direction = 'vertical'; a.save()
  assert.equal(terminalWorkspaceState('session-a', 'host-a', '/ignored'), a)
  assert.deepEqual(a.view, { panes: [1, 2], focused: 2 })
  assert.notEqual(terminalWorkspaceState('session-b', 'host-a', '/initial'), a)
  assert.notEqual(terminalWorkspaceState('session-a', 'host-b', '/initial'), a)
  writeWorkbenchState('session-a', ['host-a'], { profileId: 'host-a', path: '/other' })
  assert.deepEqual(readWorkbenchState('session-a'), { hosts: ['host-a'], target: { profileId: 'host-a', path: '/other' } })
  assert.deepEqual(readWorkbenchState('session-b'), { hosts: [], target: null })
})

test('fresh module restores browser storage and normalizes invalid layout', async () => {
  const data = new Map()
  const old = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) } })
  try {
    const key = 'dsh-ssh:terminals:v1:' + JSON.stringify(['refresh', 'host'])
    data.set(key, JSON.stringify({ tabs: [{ id: 2, number: 1, path: '/work', terminalId: 'retained' }, { id: 2, number: 1, path: '/duplicate' }], view: { panes: [2, 2, 999], focused: 999 }, direction: 'vertical' }))
    const { terminalWorkspaceState: load } = await import('../lib/terminal-workspace-state.js?refresh')
    const restored = load('refresh', 'host', '~')
    assert.equal(restored.tabs.length, 1); assert.equal(restored.tabs[0].handle.id, 'retained')
    assert.deepEqual(restored.view, { panes: [2], focused: 2 }); assert.equal(restored.direction, 'vertical')
    restored.tabs = []; restored.view = { panes: [], focused: 0 }; restored.save()
    const fresh = await import('../lib/terminal-workspace-state.js?closed')
    assert.equal(fresh.terminalWorkspaceState('refresh', 'host', '~').tabs.length, 0)
  } finally { if (old) Object.defineProperty(globalThis, 'sessionStorage', old); else delete globalThis.sessionStorage }
})
