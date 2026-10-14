import test from 'node:test'
import assert from 'node:assert/strict'
import { registerMainPanel } from '../lib/main-panel-compat.js'

test('legacy host keeps conversation priority registration', () => {
  const render = () => null
  const dispose = () => {}
  const ctx = { layout: {}, slots: { register(options, body) {
    assert.deepEqual(options, { name: 'conversation', priority: -2 })
    assert.equal(body, render)
    return dispose
  } } }
  assert.equal(registerMainPanel(ctx, 'plugin', -2, render), dispose)
})

test('new host uses the conversation seat to preserve session highlight and never resets another panel on close', () => {
  const calls = []
  const ctx = {
    layout: { selectPanel: id => calls.push(['select', id]) },
    slots: { inject: (name, fn) => { calls.push(['inject', name]); return fn() }, register: options => { calls.push(['register', options]); return () => calls.push(['dispose']) } },
  }
  const dispose = registerMainPanel(ctx, 'plugin', -2, () => null)
  dispose()
  assert.deepEqual(calls, [
    ['inject', 'main.conversation'], ['register', { name: 'main.conversation', priority: -2 }], ['select', null], ['dispose'],
  ])
})

test('failed navigation rolls registration back', () => {
  let removed = 0
  const ctx = {
    layout: { selectPanel() { throw new Error('navigation failed') } },
    slots: { inject: (_name, fn) => fn(), register: () => () => { removed++ } },
  }
  assert.throws(() => registerMainPanel(ctx, 'plugin', -2, () => null), /navigation failed/)
  assert.equal(removed, 1)
})
