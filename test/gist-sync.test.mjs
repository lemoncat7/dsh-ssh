import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { SshCredentialVault } from '../lib/credentials.js'
import {
  createEncryptedPortableSnapshot,
  createPortableSnapshot,
  decryptPortableSecrets,
  GistSyncService,
  GistTokenVault,
  GitHubGistClient,
  mergePortableSnapshots,
  resolveSyncDecision,
  snapshotDigest,
} from '../lib/gist-sync.js'
import { SshStore } from '../lib/store.js'

test('encrypts portable SSH, FTP, proxy and vault configuration without leaking local-only state', async t => {
  const fixture = await createFixture(t)
  await seedPortableConfiguration(fixture.store, fixture.credentials)
  const snapshot = await createEncryptedPortableSnapshot(
    fixture.store.snapshot(), 'device-encryption-test', emptyTombstones(), fixture.credentials, '123456', 100,
  )
  const serialized = JSON.stringify(snapshot)

  assert.equal(snapshot.collections.profiles.length, 1)
  assert.equal(snapshot.collections.ftpProfiles.length, 1)
  assert.deepEqual(snapshot.collections.ftpProfiles[0].tags, ['files', 'production'])
  assert.equal(snapshot.collections.proxyEntries.length, 1)
  assert.equal(snapshot.collections.credentialEntries.length, 2)
  assert.equal(snapshot.collections.remoteProjects.length, 1)
  assert.equal('injections' in snapshot.collections, false)
  assert.equal('forwardRules' in snapshot.collections, false)
  assert.equal('settings' in snapshot.collections, false)
  assert.doesNotMatch(serialized, /vault-password|PRIVATE KEY MATERIAL|proxy-password/)

  const secrets = await decryptPortableSecrets(snapshot, '123456')
  assert.equal(secrets['vault-entry:credential-password'].password, 'vault-password')
  assert.equal(secrets['vault-entry:credential-key'].privateKey, 'PRIVATE KEY MATERIAL')
  assert.equal(secrets['proxy-entry:proxy-one'].proxyPassword, 'proxy-password')
  await assert.rejects(decryptPortableSecrets(snapshot, 'wrong encryption password'), /Cannot decrypt/)
})

test('uses a three-way decision and tombstone-aware deterministic smart merge', () => {
  const state = emptyState()
  state.profiles.push(profile('host-one', 'Original', 10), profile('host-two', 'Delete me', 10))
  const base = createPortableSnapshot(state, 'device-base', emptyTombstones(), 10)
  const local = structuredClone(base)
  local.collections.profiles[0] = profile('host-one', 'Local edit', 30)
  local.tombstones.profiles['host-two'] = 40
  local.collections.profiles = local.collections.profiles.filter(item => item.id !== 'host-two')
  const remote = structuredClone(base)
  remote.collections.profiles[0] = profile('host-one', 'Remote edit', 20)

  const merged = mergePortableSnapshots(local, remote, 'device-merge', 50)
  assert.equal(merged.collections.profiles.find(item => item.id === 'host-one')?.name, 'Local edit')
  assert.equal(merged.collections.profiles.some(item => item.id === 'host-two'), false)
  assert.equal(resolveSyncDecision(snapshotDigest(local), snapshotDigest(base), snapshotDigest(base), 'cloud-first'), 'local')
  assert.equal(resolveSyncDecision(snapshotDigest(local), snapshotDigest(remote), snapshotDigest(base), 'smart'), 'merge')
})

test('creates a private Gist, rotates explicit backups, and restores encrypted credentials on another device', async t => {
  const source = await createFixture(t, 'source')
  await seedPortableConfiguration(source.store, source.credentials)
  const github = new MemoryGistApi()
  const service = await GistSyncService.open(
    source.store, source.credentials, new GistTokenVault(source.provider), join(source.directory, 'gist.json'),
    token => new GitHubGistClient(token, github.fetch),
  )
  t.after(() => service.close())
  await service.configure({
    settings: { autoSync: false, strategy: 'smart', backupRetention: 2, gistId: '' },
    token: 'github-token-value-for-tests', encryptionPassphrase: 'portable secret phrase',
  })
  const created = await service.sync()
  assert.equal(created.lastResult, 'uploaded')
  assert.equal(created.gistId, github.id)
  assert.equal(created.cloudVersion, github.revision())

  for (let index = 1; index <= 3; index += 1) {
    await source.store.update(state => {
      const item = state.profiles.find(profile => profile.id === 'host-one')
      item.name = `Host revision ${index}`
      item.updatedAt = 1_000 + index
    })
    await service.sync()
  }
  assert.equal(Object.keys(github.files).filter(name => name.startsWith('dsh-ssh.backup.')).length, 2)
  assert.doesNotMatch(github.files['dsh-ssh.config.json'], /vault-password|PRIVATE KEY MATERIAL|proxy-password/)

  const target = await createFixture(t, 'target')
  const targetService = await GistSyncService.open(
    target.store, target.credentials, new GistTokenVault(target.provider), join(target.directory, 'gist.json'),
    token => new GitHubGistClient(token, github.fetch),
  )
  t.after(() => targetService.close())
  await targetService.configure({
    settings: { autoSync: false, strategy: 'cloud-first', backupRetention: 2, gistId: github.id },
    token: 'github-token-value-for-tests', encryptionPassphrase: 'portable secret phrase',
  })
  const restored = await targetService.sync()
  assert.equal(restored.lastResult, 'downloaded')
  assert.equal(restored.cloudVersion, github.revision())
  assert.equal(target.store.profile('host-one')?.name, 'Host revision 3')
  assert.deepEqual(target.store.ftpProfile('ftp-one')?.tags, ['files', 'production'])
  assert.equal((await target.credentials.readEntry('credential-password')).password, 'vault-password')
  assert.equal((await target.credentials.readEntry('credential-key')).privateKey, 'PRIVATE KEY MATERIAL')
  assert.equal((await target.credentials.readProxyEntry('proxy-one')).proxyPassword, 'proxy-password')
  assert.equal(target.store.snapshot().injections.length, 0)
  assert.equal(target.store.snapshot().forwardRules.length, 0)

  const persisted = JSON.parse(await readFile(join(target.directory, 'gist.json'), 'utf8'))
  assert.equal('token' in persisted, false)
  assert.equal('encryptionPassphrase' in persisted, false)
})

test('bootstraps an empty device from cloud even with local-first strategy and removes backups at zero retention', async t => {
  const source = await createFixture(t, 'bootstrap-source')
  await seedPortableConfiguration(source.store, source.credentials)
  const github = new MemoryGistApi()
  const sourceService = await GistSyncService.open(
    source.store, source.credentials, new GistTokenVault(source.provider), join(source.directory, 'gist.json'),
    token => new GitHubGistClient(token, github.fetch),
  )
  t.after(() => sourceService.close())
  await sourceService.configure({
    settings: { autoSync: false, strategy: 'smart', backupRetention: 2, gistId: '' },
    token: 'github-token-value-for-tests', encryptionPassphrase: 'portable secret phrase',
  })
  await sourceService.sync()
  await source.store.update(state => { state.profiles[0].name = 'Cloud host'; state.profiles[0].updatedAt += 1 })
  await sourceService.sync()
  assert.equal(Object.keys(github.files).filter(name => name.startsWith('dsh-ssh.backup.')).length, 1)

  const target = await createFixture(t, 'bootstrap-target')
  const targetService = await GistSyncService.open(
    target.store, target.credentials, new GistTokenVault(target.provider), join(target.directory, 'gist.json'),
    token => new GitHubGistClient(token, github.fetch),
  )
  t.after(() => targetService.close())
  await targetService.configure({
    settings: { autoSync: false, strategy: 'local-first', backupRetention: 0, gistId: github.id },
    token: 'github-token-value-for-tests', encryptionPassphrase: 'portable secret phrase',
  })
  const restored = await targetService.sync()
  assert.equal(restored.lastResult, 'downloaded')
  assert.equal(target.store.profile('host-one')?.name, 'Cloud host')
  assert.equal(Object.keys(github.files).filter(name => name.startsWith('dsh-ssh.backup.')).length, 0)
})

test('recovers from damaged local sync metadata without preventing SSH startup', async t => {
  const fixture = await createFixture(t, 'damaged-metadata')
  const metadataPath = join(fixture.directory, 'gist.json')
  await writeFile(metadataPath, '{ damaged json', 'utf8')
  const service = await GistSyncService.open(
    fixture.store, fixture.credentials, new GistTokenVault(fixture.provider), metadataPath,
  )
  t.after(() => service.close())
  const view = await service.view()
  assert.equal(view.autoSync, false)
  assert.match(view.lastError, /corrupted and has been safely reset/)
  assert.equal((await readdir(fixture.directory)).some(name => name.startsWith('gist.json.corrupt.')), true)
})

test('loads legacy FTP profiles without tags and persists the normalized metadata', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-ssh-legacy-ftp-tags-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const statePath = join(directory, 'state.json')
  const state = emptyState()
  state.ftpProfiles.push({
    id: 'ftp-legacy', name: 'Legacy FTP', protocol: 'ftps-explicit', host: 'ftp.internal', port: 21,
    username: 'root', proxy: { type: 'none' }, initialPath: '/', connectTimeoutMs: 15_000,
    createdAt: 10, updatedAt: 10,
  })
  await writeFile(statePath, `${JSON.stringify(state)}\n`, 'utf8')

  const store = await SshStore.open(statePath, state.settings)
  assert.deepEqual(store.ftpProfile('ftp-legacy')?.tags, [])
  await store.update(() => {})
  const persisted = JSON.parse(await readFile(statePath, 'utf8'))
  assert.deepEqual(persisted.ftpProfiles[0].tags, [])
})

test('refuses a public Gist before any SSH configuration can be uploaded', async () => {
  const request = async () => json({
    id: 'abcdef1234567890abcdef1234567890',
    html_url: 'https://gist.github.com/abcdef1234567890abcdef1234567890',
    public: true,
    files: {},
  })
  const client = new GitHubGistClient('github-token-value-for-tests', request)
  await assert.rejects(client.get('abcdef1234567890abcdef1234567890'), /private Gists only/)
})

async function createFixture(t, label = 'encryption') {
  const directory = await mkdtemp(join(tmpdir(), `dsh-ssh-gist-${label}-`))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const provider = new MemoryCredentialProvider()
  const store = await SshStore.open(join(directory, 'state.json'), { allowPublicBind: false, defaultCommandTimeoutMs: 30_000, maxOutputChars: 32_000 })
  const credentials = new SshCredentialVault(provider)
  return { directory, provider, store, credentials }
}

async function seedPortableConfiguration(store, credentials) {
  const now = 100
  await store.update(state => {
    state.credentialEntries.push(
      { id: 'credential-password', name: 'Shared password', username: 'root', authType: 'password', createdAt: now, updatedAt: now },
      { id: 'credential-key', name: 'Shared key', username: 'deploy', authType: 'private-key', createdAt: now, updatedAt: now },
    )
    state.proxyEntries.push({ id: 'proxy-one', name: 'Office proxy', proxyType: 'socks5', host: 'proxy.internal', port: 1080, username: 'proxy-user', createdAt: now, updatedAt: now })
    state.profiles.push({ ...profile('host-one', 'Host one', now), credentialId: 'credential-password', proxy: { type: 'saved', proxyId: 'proxy-one' } })
    state.ftpProfiles.push({ id: 'ftp-one', name: 'FTP one', protocol: 'ftps-explicit', host: 'ftp.internal', port: 21, username: 'root', credentialId: 'credential-password', proxy: { type: 'saved', proxyId: 'proxy-one' }, initialPath: '/', connectTimeoutMs: 15_000, tags: ['files', 'production'], createdAt: now, updatedAt: now })
    state.remoteProjects.push({ id: 'project-one', profileId: 'host-one', name: 'Application', path: '/srv/app', createdAt: now, updatedAt: now })
    state.forwardRules.push({ id: 'forward-local', profileId: 'host-one', name: 'Local only', kind: 'local', bindHost: '127.0.0.1', bindPort: 8080, targetHost: '127.0.0.1', targetPort: 80, autoStart: false, createdAt: now, updatedAt: now })
    state.injections.push({ sessionId: 'session-local', profileIds: ['host-one'], fileEndpointIds: ['sftp:host-one'], filePermission: 'transfer', requireFileApproval: true, permission: 'exec', requireCommandApproval: true, workingDirectories: { 'host-one': '/srv/app' }, workingProjectIds: { 'host-one': 'project-one' }, updatedAt: now })
    state.settings.allowPublicBind = true
  })
  await credentials.replaceEntry('credential-password', { password: 'vault-password' })
  await credentials.replaceEntry('credential-key', { privateKey: 'PRIVATE KEY MATERIAL', passphrase: 'key-passphrase' })
  await credentials.replaceProxyEntry('proxy-one', { proxyPassword: 'proxy-password' })
}

function profile(id, name, updatedAt) {
  return { id, name, host: `${id}.internal`, port: 22, username: 'root', authType: 'password', proxy: { type: 'none' }, keepAliveIntervalMs: 15_000, connectTimeoutMs: 15_000, terminalType: 'xterm-256color', tags: [], createdAt: 10, updatedAt }
}

function emptyState() {
  return { schemaVersion: 5, profiles: [], ftpProfiles: [], remoteProjects: [], credentialEntries: [], proxyEntries: [], forwardRules: [], injections: [], settings: { allowPublicBind: false, defaultCommandTimeoutMs: 30_000, maxOutputChars: 32_000 } }
}

function emptyTombstones() { return { profiles: {}, ftpProfiles: {}, remoteProjects: {}, credentialEntries: {}, proxyEntries: {} } }

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

class MemoryGistApi {
  id = 'abcdef1234567890abcdef1234567890'
  files = {}
  revisionNumber = 0
  fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET'
    if (url === 'https://api.github.com/user') return json({ login: 'gist-test-user' })
    if (url === 'https://api.github.com/gists' && method === 'POST') {
      const body = JSON.parse(init.body)
      this.files = Object.fromEntries(Object.entries(body.files).map(([name, file]) => [name, file.content]))
      this.revisionNumber += 1
      return json(this.document(), 201)
    }
    if (url === `https://api.github.com/gists/${this.id}` && method === 'GET') return json(this.document())
    if (url === `https://api.github.com/gists/${this.id}` && method === 'PATCH') {
      const body = JSON.parse(init.body)
      for (const [name, file] of Object.entries(body.files)) {
        if (file === null) delete this.files[name]
        else this.files[name] = file.content
      }
      this.revisionNumber += 1
      return json(this.document())
    }
    return json({ message: 'Not Found' }, 404)
  }
  document() {
    return { id: this.id, html_url: `https://gist.github.com/${this.id}`, public: false, history: [{ version: this.revision() }], files: Object.fromEntries(Object.entries(this.files).map(([name, content]) => [name, { filename: name, content, truncated: false }])) }
  }
  revision() { return this.revisionNumber.toString(16).padStart(40, '0') }
}

function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }) }
