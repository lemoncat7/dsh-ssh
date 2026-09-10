import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import test from 'node:test'

// A subprocess makes an unhandled error a hard test failure, not a suppressed exception.
const script = `
import net from 'node:net'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { SshConnector } from './lib/connector.js'
const sockets = new Set()
const proxy = process.argv[1] === 'socks5'
const server = net.createServer(socket => {
  sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {})
  let stage = 0
  socket.on('data', () => {
    if (!proxy) return
    if (stage++ === 0) socket.write(Buffer.from([5, 0]))
    else if (stage === 2) socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 22]))
    // Deliberately never return an SSH banner.
  })
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
try {
  const port = server.address().port
  const connector = new SshConnector({}, {})
  const profile = { id: 'silent', name: 'Silent SSH', host: '127.0.0.1', port,
    username: 'test', authType: 'password', keepAliveIntervalMs: 0, connectTimeoutMs: 100,
    proxy: proxy ? { type: 'socks5', host: '127.0.0.1', port } : { type: 'none' } }
  for (let i = 0; i < 3; i++) {
    await assert.rejects(connector.connectDraft(profile, { password: 'test' }), /Timed out while waiting for handshake/)
    await delay(30)
  }
  const controller = new AbortController()
  const pending = connector.connectDraft({ ...profile, connectTimeoutMs: 1000 }, { password: 'test' }, controller.signal)
  setTimeout(() => controller.abort(new Error('cancelled by test')), 20)
  await assert.rejects(pending, /cancelled by test/)
  await delay(80)
  assert.equal(sockets.size, 0, 'failed sockets must be released')
  console.log('survived timeout and abort')
} finally {
  for (const socket of sockets) socket.destroy()
  await new Promise(resolve => server.close(resolve))
}
`

for (const route of ['direct', 'socks5']) {
  test(`SSH ${route} handshake timeout and abort never crash the host process`, async () => {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, route], {
      cwd: new URL('../', import.meta.url), timeout: 10000,
    })
    assert.match(stdout, /survived timeout and abort/)
    assert.doesNotMatch(stderr, /Unhandled|uncaught/i)
  })
}
