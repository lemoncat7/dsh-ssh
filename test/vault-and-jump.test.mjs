import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import ssh2 from 'ssh2'
import { HostKeyRequiredError, SshConnector } from '../lib/connector.js'
import { SshCredentialVault } from '../lib/credentials.js'
import { executeSshCommand } from '../lib/exec.js'
import { SshStore } from '../lib/store.js'

test('uses a vault credential without copying it into the SSH profile', async t => {
  const fixture = await createFixture(t)
  const target = await createServer(t, { username: 'vault-user', password: 'vault-password', label: 'vault-target' })
  await fixture.store.update(state => {
    state.credentialEntries.push({ id: 'credential-shared', name: 'Shared', username: 'vault-user', authType: 'password', createdAt: Date.now(), updatedAt: Date.now() })
    state.profiles.push(profile('host-vault', target.port, { credentialId: 'credential-shared', username: 'ignored-user' }))
  })
  await fixture.vault.replaceEntry('credential-shared', { password: 'vault-password' })
  await pin(fixture.store, fixture.connector, 'host-vault')

  const result = await executeSshCommand(fixture.connector, 'host-vault', 'whoami', 5000, 1000)
  assert.equal(result.exitCode, 0)
  assert.match(result.stdout, /^vault-target:/)
  assert.deepEqual(await fixture.vault.read('host-vault'), {})
})

test('tests an unsaved SSH profile without persisting credentials', async t => {
  const fixture = await createFixture(t)
  const target = await createServer(t, { username: 'draft-user', password: 'draft-password', label: 'draft-target' })
  const draft = profile('preview-draft', target.port, { username: 'draft-user' })
  let firstSeen
  try { await fixture.connector.connectDraft(draft, { password: 'draft-password' }) } catch (reason) { firstSeen = reason }
  assert(firstSeen instanceof HostKeyRequiredError)

  const connection = await fixture.connector.connectDraft({ ...draft, hostFingerprint: firstSeen.fingerprint }, { password: 'draft-password' })
  connection.close()
  assert.equal(fixture.store.profile('preview-draft'), undefined)
  assert.deepEqual(await fixture.vault.read('preview-draft'), {})
})

test('reuses a saved SOCKS5 proxy and keeps its password outside SSH profiles', async t => {
  const fixture = await createFixture(t)
  const target = await createServer(t, { username: 'proxy-user', password: 'target-password', label: 'proxy-target' })
  const proxy = await createSocksProxy(t, { username: 'shared-proxy', password: 'proxy-password' })
  const now = Date.now()
  await fixture.store.update(state => {
    state.proxyEntries.push({ id: 'proxy-shared', name: 'Shared SOCKS', proxyType: 'socks5', host: '127.0.0.1', port: proxy.port, username: 'shared-proxy', createdAt: now, updatedAt: now })
    state.profiles.push(profile('host-proxy', target.port, { username: 'proxy-user', proxy: { type: 'saved', proxyId: 'proxy-shared' } }))
  })
  await fixture.vault.replace('host-proxy', { password: 'target-password' })
  await fixture.vault.replaceProxyEntry('proxy-shared', { proxyPassword: 'proxy-password' })
  await pin(fixture.store, fixture.connector, 'host-proxy')

  const result = await executeSshCommand(fixture.connector, 'host-proxy', 'hostname', 5000, 1000)
  assert.equal(result.exitCode, 0)
  assert.match(result.stdout, /^proxy-target:/)
  assert.deepEqual(await fixture.vault.read('host-proxy'), { password: 'target-password' })
  assert.deepEqual(await fixture.vault.readProxyEntry('proxy-shared'), { proxyPassword: 'proxy-password' })
  await assert.rejects(fixture.store.update(state => { state.proxyEntries = [] }), /missing proxy entry/)
})

test('connects through an ordered two-host SSH jump chain', async t => {
  const fixture = await createFixture(t)
  const jumpOne = await createServer(t, { username: 'jump-one', password: 'one-password', label: 'jump-one', forward: true })
  const jumpTwo = await createServer(t, { username: 'jump-two', password: 'two-password', label: 'jump-two', forward: true })
  const target = await createServer(t, { username: 'target', password: 'target-password', label: 'target' })
  await fixture.store.update(state => {
    state.profiles.push(
      profile('host-jump-one', jumpOne.port, { username: 'jump-one' }),
      profile('host-jump-two', jumpTwo.port, { username: 'jump-two' }),
      profile('host-target', target.port, { username: 'target' }),
    )
  })
  await fixture.vault.replace('host-jump-one', { password: 'one-password' })
  await fixture.vault.replace('host-jump-two', { password: 'two-password' })
  await fixture.vault.replace('host-target', { password: 'target-password' })
  await pin(fixture.store, fixture.connector, 'host-jump-one')
  await pin(fixture.store, fixture.connector, 'host-jump-two')
  await pin(fixture.store, fixture.connector, 'host-target')
  await fixture.store.update(state => {
    const targetProfile = state.profiles.find(item => item.id === 'host-target')
    targetProfile.proxy = { type: 'jump', profileIds: ['host-jump-one', 'host-jump-two'] }
  })

  const result = await executeSshCommand(fixture.connector, 'host-target', 'hostname', 5000, 1000)
  assert.equal(result.exitCode, 0)
  assert.match(result.stdout, /^target:/)
})

async function createFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-ssh-chain-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = await SshStore.open(join(directory, 'state.json'), { allowPublicBind: false, defaultCommandTimeoutMs: 30_000, maxOutputChars: 32_000 })
  const vault = new SshCredentialVault(new MemoryCredentialProvider())
  return { store, vault, connector: new SshConnector(store, vault) }
}

async function createServer(t, options) {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  })
  const server = new ssh2.Server({ hostKeys: [privateKey] }, client => {
    client.on('error', () => {})
    client.on('authentication', context => {
      if (context.method === 'password' && context.username === options.username && context.password === options.password) context.accept()
      else context.reject()
    })
    client.on('ready', () => {
      client.on('session', accept => {
        const session = accept()
        session.on('exec', (acceptExec, _reject, info) => {
          const channel = acceptExec()
          channel.write(`${options.label}:${info.command}\n`)
          channel.exit(0)
          channel.end()
        })
      })
      if (options.forward) client.on('tcpip', (accept, reject, info) => {
        const socket = createConnection({ host: info.destIP, port: info.destPort })
        socket.once('connect', () => {
          const channel = accept()
          channel.pipe(socket).pipe(channel)
        })
        socket.once('error', () => reject())
      })
    })
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  t.after(() => new Promise(resolve => server.close(resolve)))
  const address = server.address()
  assert(address && typeof address !== 'string')
  return { port: address.port }
}

async function createSocksProxy(t, options) {
  const sockets = new Set()
  const server = (await import('node:net')).createServer(socket => {
    socket.on('error', () => {})
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    let state = 'greeting'
    let buffered = Buffer.alloc(0)
    const consume = () => {
      if (state === 'greeting') {
        if (buffered.length < 2) return
        const length = 2 + buffered[1]
        if (buffered.length < length) return
        buffered = buffered.subarray(length)
        state = 'auth'
        socket.write(Buffer.from([5, 2]))
      }
      if (state === 'auth') {
        if (buffered.length < 2) return
        const usernameLength = buffered[1]
        if (buffered.length < 2 + usernameLength + 1) return
        const passwordLength = buffered[2 + usernameLength]
        const length = 3 + usernameLength + passwordLength
        if (buffered.length < length) return
        const username = buffered.subarray(2, 2 + usernameLength).toString()
        const password = buffered.subarray(3 + usernameLength, length).toString()
        buffered = buffered.subarray(length)
        if (username !== options.username || password !== options.password) return socket.end(Buffer.from([1, 1]))
        state = 'request'
        socket.write(Buffer.from([1, 0]))
      }
      if (state === 'request') {
        if (buffered.length < 4) return
        const addressType = buffered[3]
        const addressLength = addressType === 1 ? 4 : addressType === 4 ? 16 : addressType === 3 && buffered.length >= 5 ? 1 + buffered[4] : 0
        const headerLength = 4 + addressLength + 2
        if (addressLength === 0 || buffered.length < headerLength) return
        const host = addressType === 1
          ? [...buffered.subarray(4, 8)].join('.')
          : addressType === 3 ? buffered.subarray(5, 4 + addressLength).toString() : '::1'
        const port = buffered.readUInt16BE(4 + addressLength)
        buffered = buffered.subarray(headerLength)
        state = 'tunnel'
        const upstream = createConnection({ host, port })
        sockets.add(upstream)
        upstream.once('close', () => sockets.delete(upstream))
        upstream.once('connect', () => {
          socket.off('data', onData)
          socket.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
          if (buffered.length > 0) upstream.write(buffered)
          socket.pipe(upstream).pipe(socket)
        })
        upstream.once('error', () => socket.destroy())
      }
    }
    const onData = chunk => { buffered = Buffer.concat([buffered, chunk]); consume() }
    socket.on('data', onData)
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  t.after(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => server.close(resolve))
  })
  const address = server.address()
  assert(address && typeof address !== 'string')
  return { port: address.port }
}

function profile(id, port, overrides = {}) {
  const now = Date.now()
  return {
    id, name: id, host: '127.0.0.1', port, username: 'tester', authType: 'password', proxy: { type: 'none' },
    keepAliveIntervalMs: 0, connectTimeoutMs: 5000, terminalType: 'xterm-256color', tags: [], createdAt: now, updatedAt: now,
    ...overrides,
  }
}

async function pin(store, connector, profileId) {
  let error
  try { await connector.connect(profileId) } catch (reason) { error = reason }
  assert(error instanceof HostKeyRequiredError)
  await store.update(state => { state.profiles.find(item => item.id === profileId).hostFingerprint = error.fingerprint })
}

class MemoryCredentialProvider {
  records = new Map()
  async readRecord(key) { return this.records.get(String(key)) }
  async describeRecord(key) { const record = this.records.get(String(key)); return { configured: record !== undefined, kind: record?.kind, writable: true } }
  async modifyRecord(key, mutate) { const current = this.records.get(String(key)); const next = await mutate(current); if (next !== undefined) this.records.set(String(key), next); return next ?? current }
  async deleteRecord(key) { this.records.delete(String(key)) }
  async listRecords() { return [] }
  async resolve() { return undefined }
  async describe() { return { configured: false, writable: true } }
  async set() {}
  async unset() {}
}
