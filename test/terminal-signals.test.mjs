import assert from 'node:assert/strict'
import test from 'node:test'
import { PassThrough } from 'node:stream'
import { SshTerminalSession } from '../lib/terminal.js'
import { terminalControlByte } from '../lib/terminal-control.js'

function fixture(t) {
  const channel = new PassThrough()
  channel.stderr = new PassThrough()
  channel.signal = () => assert.fail('SSH session-leader signal must not be used')
  const session = new SshTerminalSession({ close() {} }, channel, 'test')
  t.after(() => { channel.destroy(); channel.stderr.destroy() })
  return { session, channel }
}
test('INT/QUIT/TSTP use PTY control bytes and never claim PGID delivery', async t => {
  const { session } = fixture(t)
  for (const [signal, byte] of [['SIGINT','\x03'],['SIGQUIT','\x1c'],['SIGTSTP','\x1a']]) {
    assert.equal(terminalControlByte(signal), byte)
    const receipt = await session.sendControlSignal(signal)
    assert.deepEqual(receipt, { inputWritten: true, mechanism: 'pty-control-byte', signal })
  }
  assert.equal(session.readOutput(0).data, '\x03\x1c\x1a')
})
test('unsupported signals and host PGID contract fail closed without writing or killing shell', async t => {
  const { session } = fixture(t)
  for (const signal of ['SIGTERM','SIGKILL','SIGHUP','TSTP','__proto__','SIGINT; id'])
    await assert.rejects(session.sendControlSignal(signal), /cannot verify/)
  await assert.rejects(session.signal('SIGINT'), /verified foreground process group/)
  assert.equal(session.readOutput(0).data, '')
})
test('exited channels and failed writes do not return success', async t => {
  const { session, channel } = fixture(t)
  channel.write = (_byte, callback) => { callback(new Error('write failed')); return false }
  await assert.rejects(session.sendControlSignal('SIGINT'), /write failed/)
  channel.emit('exit', 0)
  await assert.rejects(session.sendControlSignal('SIGTSTP'), /exited/)
})
