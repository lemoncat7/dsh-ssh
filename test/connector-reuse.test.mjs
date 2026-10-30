import assert from 'node:assert/strict'
import { generateKeyPairSync, createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import ssh2 from 'ssh2'
import { SshStore } from '../lib/store.js'
import { SshCredentialVault } from '../lib/credentials.js'
import { SshConnector, HostKeyRequiredError } from '../lib/connector.js'
import { BrowserTerminalManager } from '../lib/terminal.js'

test('real SSH: slow authentication timeout, draft override, multiplexed independent shells and credential invalidation', { timeout: 20000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'ssh-reuse-live-'))
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'pkcs1', format: 'pem' } })
  const fingerprint = 'SHA256:' + createHash('sha256').update(ssh2.utils.parseKey(privateKey).getPublicSSH()).digest('hex')
  let authenticationDelay = 1100, authentications = 0, sockets = 0
  const clients = new Set()
  const server = new ssh2.Server({ hostKeys: [privateKey] }, client => {
    sockets++; clients.add(client)
    client.on('error', () => {})
    client.on('close', () => clients.delete(client))
    client.on('authentication', auth => {
      if (auth.method !== 'password') { auth.reject(); return }
      const timer = setTimeout(() => {
        if (!clients.has(client)) return
        if (auth.password === 'fixture') { authentications++; auth.accept() } else auth.reject()
      }, authenticationDelay)
      client.once('close', () => clearTimeout(timer))
    })
    client.on('ready', () => client.on('session', accept => {
      const session = accept()
      session.on('pty', accept => accept())
      session.on('exec', accept => { const stream = accept(); stream.write('/bin/unknown\n'); stream.exit(0); stream.end() })
      session.on('shell', accept => {
        const stream = accept()
        stream.on('data', bytes => stream.write(bytes))
        stream.on('end', () => { stream.exit(0); stream.end() })
      })
    }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const store = await SshStore.open(join(root, 'state.json'), { allowPublicBind: false, defaultCommandTimeoutMs: 30000, maxOutputChars: 32000, defaultConnectTimeoutMs: 1000, reuseTerminalConnections: true })
  const profile = { id: 'fixture', name: 'Fixture', host: '127.0.0.1', port: server.address().port, username: 'test', authType: 'password', proxy: { type: 'none' }, connectTimeoutMs: 15000, keepAliveIntervalMs: 0, terminalType: 'xterm', hostFingerprint: fingerprint, tags: [], createdAt: 1, updatedAt: 1 }
  await store.update(s => s.profiles.push(profile))
  const records = new Map()
  const vault = new SshCredentialVault({ readRecord: async key => records.get(String(key)), modifyRecord: async (key, f) => { const value = await f(records.get(String(key))); records.set(String(key), value); return value } })
  await vault.replace('fixture', { password: 'fixture' })
  const connector = new SshConnector(store, vault)
  const terminals = new BrowserTerminalManager(connector)
  t.after(async () => {
    await terminals.closeAll(); connector.close()
    for (const client of clients) client.end()
    await new Promise(resolve => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  })
  await assert.rejects(connector.connect('fixture'), error => error.code === 'SSH_CONNECT_TIMEOUT' && error.phase === 'authentication')
  const draft = await connector.connectDraft({ ...profile, connectTimeoutMs: 3000, useDefaultConnectTimeout: false }, { password: 'fixture' })
  draft.close()
  await store.update(s => { s.settings.defaultConnectTimeoutMs = 3000 })
  authenticationDelay = 80
  const before = authentications
  const [a, b] = await Promise.all([terminals.create('fixture', 80, 24), terminals.create('fixture', 80, 24)])
  assert.equal(authentications - before, 1, 'two concurrent terminals authenticate only once')
  terminals.get(a.id).write('FIRST_ONLY\n')
  terminals.get(b.id).write('SECOND_ONLY\n')
  await delay(150)
  assert.match(terminals.get(a.id).read(0).data, /FIRST_ONLY/)
  assert.doesNotMatch(terminals.get(a.id).read(0).data, /SECOND_ONLY/)
  await terminals.get(a.id).close()
  terminals.get(b.id).write('STILL_ALIVE\n'); await delay(100)
  assert.match(terminals.get(b.id).read(0).data, /STILL_ALIVE/)
  const count = sockets
  const c = await terminals.create('fixture', 80, 24)
  assert.equal(sockets, count, 'third terminal reuses the active SSH connection')
  await vault.replace('fixture', { password: 'wrong' })
  await assert.rejects(terminals.create('fixture', 80, 24), /authentication|Authentication/)
  terminals.get(b.id).write('OLD_LEASE_ALIVE\n'); await delay(100)
  assert.match(terminals.get(b.id).read(0).data, /OLD_LEASE_ALIVE/)
  await vault.replace('fixture', { password: 'fixture' })
  await store.update(s => { s.profiles[0].hostFingerprint = 'SHA256:' + '0'.repeat(64) })
  await assert.rejects(terminals.create('fixture', 80, 24), error => error instanceof HostKeyRequiredError)
  await store.update(s => { s.profiles[0].hostFingerprint = fingerprint; s.settings.reuseTerminalConnections = false })
  const disabledBefore = authentications
  const d = await terminals.create('fixture', 80, 24), e = await terminals.create('fixture', 80, 24)
  assert.equal(authentications - disabledBefore, 2, 'disabled means independent authentication')
  await Promise.all([b, c, d, e].map(v => terminals.get(v.id).close()))
})
