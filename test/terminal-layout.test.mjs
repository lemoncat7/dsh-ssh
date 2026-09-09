import test from 'node:test'
import assert from 'node:assert/strict'
import { selectTerminal, splitTerminal, closeTerminal, nextTerminalNumber } from '../lib/terminal-layout.js'

test('terminal labels reuse gaps and restart at one when empty', () => {
  assert.equal(nextTerminalNumber([]), 1)
  assert.equal(nextTerminalNumber([1, 3, 4]), 2)
  assert.equal(nextTerminalNumber([2, 3]), 1)
})

test('visible tabs change focus without swapping panes', () => {
  const layout = { panes: [1, 2], focused: 1 }
  assert.deepEqual(selectTerminal(layout, 2), { panes: [1, 2], focused: 2 })
  assert.deepEqual(layout.panes, [1, 2])
})
test('hidden and new tabs replace only the focused pane', () => {
  assert.deepEqual(selectTerminal({ panes: [1, 2, 3, 4], focused: 3 }, 5), { panes: [1, 2, 5, 4], focused: 5 })
})
test('splits are unique and limited to four', () => {
  let layout = { panes: [1], focused: 1 }
  for (const id of [2, 3, 4, 5, 4]) layout = splitTerminal(layout, id)
  assert.deepEqual(layout, { panes: [1, 2, 3, 4], focused: 4 })
})
test('closing a pane keeps other shells in place and uses a hidden tab', () => {
  assert.deepEqual(closeTerminal({ panes: [1, 2, 3, 4], focused: 2 }, 2, [1, 3, 4, 5]), { panes: [1, 5, 3, 4], focused: 5 })
  assert.deepEqual(closeTerminal({ panes: [1, 2], focused: 1 }, 2, [1]), { panes: [1], focused: 1 })
})
test('closing last tab and reopening produces a single pane', () => {
  const closed = closeTerminal({ panes: [1], focused: 1 }, 1, [])
  assert.deepEqual(closed, { panes: [], focused: 0 })
  assert.deepEqual(selectTerminal(closed, 2), { panes: [2], focused: 2 })
})
