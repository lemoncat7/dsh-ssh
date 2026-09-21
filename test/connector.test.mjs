import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import ssh2 from 'ssh2'
import { SshConnector, HostKeyRequiredError } from '../lib/connector.js'
import { SshCredentialVault } from '../lib/credentials.js'
import { executeSshCommand } from '../lib/exec.js'
import { SshStore } from '../lib/store.js'

test('pins a first-seen host key and executes a bounded command', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-ssh-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  })
  const server = new ssh2.Server({ hostKeys: [privateKey] }, client => {
    client.on('error', () => {})
    client.on('authentication', context => {
      if (context.method === 'password' && context.username === 'tester' && context.password === 'correct-horse') context.accept()
      else context.reject()
    })
    client.on('ready', () => client.on('session', accept => {
      const session = accept()
      session.on('exec', (acceptExec, _reject, info) => {
        const channel = acceptExec()
        channel.write(`ran:${info.command}\n`)
        channel.stderr.write('diagnostic\n')
        channel.exit(0)
        channel.end()
      })
    }))
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  t.after(() => new Promise(resolve => server.close(resolve)))
  const address = server.address()
  assert(address && typeof address !== 'string')

  const store = await SshStore.open(join(directory, 'state.json'), { allowPublicBind: false, defaultCommandTimeoutMs: 30_000, maxOutputChars: 32_000 })
  const now = Date.now()
  await store.update(state => state.profiles.push({
    id: 'host-test', name: 'Test Host', host: '127.0.0.1', port: address.port, username: 'tester', authType: 'password',
    proxy: { type: 'none' }, keepAliveIntervalMs: 0, connectTimeoutMs: 5000, terminalType: 'xterm-256color', tags: [], createdAt: now, updatedAt: now,
  }))
  const provider = new MemoryCredentialProvider()
  const vault = new SshCredentialVault(provider)
  await vault.replace('host-test', { password: 'correct-horse' })
  const connector = new SshConnector(store, vault)

  let firstError
  try { await connector.connect('host-test') } catch (error) { firstError = error }
  assert(firstError instanceof HostKeyRequiredError)
  assert.match(firstError.fingerprint, /^SHA256:/)
  await store.update(state => { state.profiles[0].hostFingerprint = firstError.fingerprint })

  const result = await executeSshCommand(connector, 'host-test', 'printf test', 5000, 1000)
  assert.equal(result.exitCode, 0)
  assert.equal(result.command, 'printf test')
  assert.equal(result.cwd, '~')
  assert.equal(result.stdout, 'ran:cd -- "$HOME" && printf test\n')
  assert.equal(result.stderr, 'diagnostic\n')
  assert.equal(result.truncated, false)

  // A reinstalled host remains blocked, but exposes both identities for explicit confirmation.
  const oldFingerprint = 'SHA256:' + '0'.repeat(64)
  await store.update(state => { state.profiles[0].hostFingerprint = oldFingerprint })
  await assert.rejects(connector.connect('host-test'), error => {
    assert(error instanceof HostKeyRequiredError)
    assert.equal(error.profileId, 'host-test')
    assert.equal(error.previousFingerprint, oldFingerprint)
    assert.equal(error.fingerprint, firstError.fingerprint)
    assert.equal(error.details.profileName, 'Test Host')
    return true
  })
  assert.equal(store.profile('host-test').hostFingerprint, oldFingerprint, 'never automatically replace trust')

  // A target reached through this jump host must identify the jump, not the target.
  await store.update(state => state.profiles.push({ ...state.profiles[0], id: 'target', name: 'Target', proxy: { type: 'jump', profileIds: ['host-test'] } }))
  await assert.rejects(connector.connect('target'), error => {
    assert.equal(error.profileId, 'host-test')
    assert.equal(error.previousFingerprint, oldFingerprint)
    return true
  })
  const confirmed = { ...store.profile('host-test'), hostFingerprint: firstError.fingerprint }
  const connection = await connector.connectDraft(confirmed, { password: 'correct-horse' })
  connection.close()
  assert.equal(store.profile('host-test').hostFingerprint, oldFingerprint, 'draft confirmation is not persisted before save')
  await assert.rejects(connector.connectDraft(confirmed, { password: 'wrong' }), error => {
    assert.equal(error instanceof HostKeyRequiredError, false, 'authentication failure is not a fingerprint change')
    return true
  })
})

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
