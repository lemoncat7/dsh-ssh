import test from 'node:test'
import assert from 'node:assert/strict'
import { currentSession } from '../lib/current-session.js'

test('main-view retention, not background usage, selects the SSH mount scope', () => {
  const state = { current: 'old', byId: { a: { retainedBy: { background: 1 } }, b: { retainedBy: { mainView: 1 } } } }
  assert.equal(currentSession(state), 'b')
  state.byId.b.retainedBy.mainView = 0
  delete state.current
  assert.equal(currentSession(state), undefined)
  assert.equal(currentSession({ current: 'legacy' }), 'legacy')
})
