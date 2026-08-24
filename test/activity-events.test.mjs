import assert from 'node:assert/strict'
import test from 'node:test'
import { ActivityEventBus } from '../lib/activity-events.js'

test('activity events notify only the owning session and replay reconnect gaps', () => {
  const events = new ActivityEventBus()
  const old = events.publish({ type: 'terminal-opened', sessionId: 'session-a', terminalId: 'old', profileId: 'host-a', createdAt: 1 })
  const received = []
  const stop = events.subscribe('session-a', events.currentId(), event => received.push(event))

  events.publish({ type: 'terminal-opened', sessionId: 'session-b', terminalId: 'other', profileId: 'host-b', createdAt: 2 })
  const current = events.publish({ type: 'terminal-opened', sessionId: 'session-a', terminalId: 'current', profileId: 'host-a', createdAt: 3 })
  assert.deepEqual(received.map(item => item.event.terminalId), ['current'])
  stop()

  const replayed = []
  events.subscribe('session-a', old.id, event => replayed.push(event))()
  assert.deepEqual(replayed.map(item => item.id), [current.id])
})
