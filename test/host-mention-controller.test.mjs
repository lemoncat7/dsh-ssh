import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createHostMentionSource, HOST_MENTION_SOURCE } from '../lib/host-mention-source.js'

// Run the shipped DSH controller, not a reimplementation of @ detection or picks.
// Only Cordis/store/React rendering plumbing is stubbed; no live sessions or model requests.
const require = createRequire(import.meta.url)
let host
const code = await readFile(require.resolve('@deepseek-ai/dsh-client-ui-input-trigger/client'), 'utf8')
vm.runInNewContext(code, {
  AbortController, console, setTimeout, clearTimeout,
  window: { __ModuleLoader__: { load({ factory }) {
    host = factory(name => {
      if (name === '@deepseek-ai/cordis') return { Service: class {} }
      if (name === '@deepseek-ai/dsh-client-store') return { createSnapshotStore(initial) {
        let value = initial
        const listeners = new Set()
        return { getSnapshot: () => value, set(next) { value = next; for (const listener of listeners) listener() }, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) } }
      } }
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return {}
      return require(name)
    })
  } } },
})

async function settled(controller) {
  for (let i = 0; i < 100; i++) {
    const state = controller.menu.getSnapshot()
    if (state.open && state.groups.every(g => g.status !== 'pending')) return state
    await delay(10)
  }
  assert.fail('host menu did not settle')
}

test('real native @ pipeline preserves other sources and keyboard-picks the intended same-name host', async t => {
  const inserted = [], requests = []
  const ssh = createHostMentionSource(() => {}, async url => {
    requests.push(url)
    return Response.json({ items: [1, 2].map(i => ({ id: `host-${i}`, name: '生产', host: `10.0.0.${i}`, port: 22, username: 'user' })) })
  })
  const builtIn = { name: 'reference', trigger: '@', candidates: async () => [{ name: 'file.sql', icon: 'file' }, { name: 'session', icon: 'session' }], onPick() {} }
  const notes = { ...builtIn, name: 'knowledge-notes', candidates: async () => [{ name: '部署笔记', icon: 'file' }] }
  const roster = [builtIn, notes, ssh]
  const controller = new host.InputTriggerController({ sessionId: 'session-a', roster: { all: () => roster, sources: () => roster }, actx: { bail(_ctx, event, payload) { inserted.push({ event, payload }); return true } } })
  t.after(() => controller.dispose())
  controller.track('@生', 2, { tier: 'plain' }, 1)
  controller.track('@生产', 3, { tier: 'plain' }, 2)
  const menu = await settled(controller)
  assert.equal(requests.length, 1)
  assert.deepEqual(Array.from(menu.groups, g => g.source), ['reference', 'knowledge-notes', HOST_MENTION_SOURCE])
  assert.equal(menu.groups[2].items.length, 2)
  controller.hover(HOST_MENTION_SOURCE, 0)
  assert.equal(controller.arbitrate('down', false), 'consumed')
  assert.equal(controller.arbitrate('enter', false), 'pick-highlighted')
  assert.equal(inserted[0].event, 'slash/input-insert-reference')
  assert.equal(JSON.parse(inserted[0].payload.reference.ref).id, 'host-2')
  assert.match(inserted[0].payload.reference.label, /10\.0\.0\.2/)
  controller.track('@10.0', 5, { tier: 'plain' }, 3)
  await settled(controller)
  assert.equal(controller.arbitrate('escape', false), 'consumed')
  assert.equal(inserted.length, 1)
  assert.equal(controller.menu.getSnapshot().open, false)
})
