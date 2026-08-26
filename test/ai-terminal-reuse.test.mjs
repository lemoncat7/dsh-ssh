import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { AiTerminalManager } from '../lib/terminal.js'

test('reuses a running AI terminal with the same owner, profile, and directory', async t => {
  const fixture = terminalFixture(t)
  const first = await fixture.manager.create('session-a', 'host-a', '/srv/app')
  const second = await fixture.manager.create('session-a', 'host-a', '/srv/app')

  assert.equal(first.reused, false)
  assert.equal(second.reused, true)
  assert.equal(second.terminalId, first.terminalId)
  assert.equal(fixture.connector.connectCount, 1)
  assert.deepEqual(fixture.opened.map(event => event.terminalId), [first.terminalId, first.terminalId])
})

test('coalesces concurrent opens for the same AI terminal identity', async t => {
  const fixture = terminalFixture(t)
  const [first, second] = await Promise.all([
    fixture.manager.create('session-a', 'host-a', '/srv/app'),
    fixture.manager.create('session-a', 'host-a', '/srv/app'),
  ])

  assert.equal(first.terminalId, second.terminalId)
  assert.deepEqual([first.reused, second.reused], [false, true])
  assert.equal(fixture.connector.connectCount, 1)
  assert.deepEqual(fixture.opened.map(event => event.terminalId), [first.terminalId, first.terminalId])
})

test('removes an exited terminal before opening its replacement', async t => {
  const fixture = terminalFixture(t)
  const first = await fixture.manager.create('session-a', 'host-a', '/srv/app')
  fixture.channels[0].emit('exit', 255, undefined)

  const second = await fixture.manager.create('session-a', 'host-a', '/srv/app')

  assert.notEqual(second.terminalId, first.terminalId)
  assert.equal(second.reused, false)
  assert.equal(fixture.connector.connectCount, 2)
  assert.deepEqual(fixture.manager.activity('session-a').map(item => item.terminalId), [second.terminalId])
})

test('keeps different working directories in separate AI terminals', async t => {
  const fixture = terminalFixture(t)
  const first = await fixture.manager.create('session-a', 'host-a', '/srv/app')
  const second = await fixture.manager.create('session-a', 'host-a', '/srv/worker')

  assert.notEqual(second.terminalId, first.terminalId)
  assert.equal(second.reused, false)
  assert.equal(fixture.connector.connectCount, 2)
})

function terminalFixture(t) {
  const channels = []
  const opened = []
  const connector = {
    connectCount: 0,
    async connect(profileId) {
      this.connectCount += 1
      const channel = terminalChannel()
      channels.push(channel)
      return {
        profile: { id: profileId, name: 'Test host', username: 'tester', host: '127.0.0.1', terminalType: 'xterm-256color' },
        client: { shell(_options, callback) { queueMicrotask(() => callback(null, channel)) } },
        close() {},
      }
    },
  }
  const manager = new AiTerminalManager(connector, event => opened.push(event))
  t.after(() => manager.closeAll())
  return { manager, connector, channels, opened }
}

function terminalChannel() {
  const channel = new PassThrough()
  channel.stderr = new PassThrough()
  channel.setWindow = () => {}
  channel.signal = () => {}
  return channel
}
