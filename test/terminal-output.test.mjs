import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { SshTerminalSession } from '../lib/terminal.js'

test('reads SSH activity terminal output incrementally by cursor', () => {
  const channel = new PassThrough()
  channel.stderr = new PassThrough()
  channel.setWindow = () => {}
  channel.signal = () => {}
  const session = new SshTerminalSession({ close() {} }, channel, 'test')

  channel.write('first')
  const first = session.readOutput(0)
  assert.deepEqual(first, { data: 'first', cursor: 5, truncated: false, closed: false })

  channel.write(' second')
  assert.deepEqual(session.readOutput(first.cursor), { data: ' second', cursor: 12, truncated: false, closed: false })

  channel.emit('exit', 0, undefined)
  assert.equal(session.readOutput(12).closed, true)
  channel.destroy()
  channel.stderr.destroy()
})
