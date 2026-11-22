import assert from 'node:assert/strict'
import test from 'node:test'
import { dismissWorkbenchSidebar } from '../lib/workbench-layout.js'

test('workbench opening dismisses only an expanded drawer', () => {
  let toggles = 0
  for (const collapsed of [false, true]) {
    const drawer = { hasAttribute: name => name === 'data-sidebar-collapsed' && collapsed }
    dismissWorkbenchSidebar({ closest: selector => selector === '[data-sidebar-drawer]' ? drawer : null }, () => toggles++)
  }
  assert.equal(toggles, 1)
})

test('legacy workbench dismisses a floating sidebar without toggling the docked sidebar', context => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle')
  Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: element => ({ position: element.position }) })
  context.after(() => {
    if (original) Object.defineProperty(globalThis, 'getComputedStyle', original)
    else delete globalThis.getComputedStyle
  })
  let toggles = 0
  const frame = { position: 'relative', querySelector: () => ({}) }
  const sidebar = { position: 'static', querySelector: () => null }
  const trigger = { closest: selector => selector === '[data-slot="sidebar"]' ? sidebar : null }
  for (const position of ['fixed', 'static']) {
    sidebar.parentElement = { position, querySelector: () => null, parentElement: frame }
    dismissWorkbenchSidebar(trigger, () => toggles++)
  }
  assert.equal(toggles, 1)
})
