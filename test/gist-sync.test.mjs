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
  parsePortableSnapshot,
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
  await assert.rejects(decryptPortableSecrets(snapshot, 'wrong encryption password'), /无法解密/)
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
  assert.match(view.lastError, /状态损坏，已安全重置/)
  assert.equal((await readdir(fixture.directory)).some(name => name.startsWith('gist.json.corrupt.')), true)
})

test('confirmed invalid authorization is retained and automatic sync pause survives restart', async t => {
  const fixture = await createFixture(t, 'invalid-github-authorization')
  const metadataPath = join(fixture.directory, 'gist.json')
  let valid = false
  const unauthorized = async () => valid ? json({ login: 'recovered' }) : json({ message: 'Bad credentials' }, 401)
  const service = await GistSyncService.open(
    fixture.store, fixture.credentials, new GistTokenVault(fixture.provider), metadataPath,
    token => new GitHubGistClient(token, unauthorized),
  )
  t.after(() => service.close())
  await service.configure({
    settings: { autoSync: false, strategy: 'smart', backupRetention: 2, gistId: '' },
    token: 'github-token-value-for-tests', encryptionPassphrase: 'portable secret phrase',
  })

  await assert.rejects(service.sync(), /授权复核返回 HTTP 401/)
  const view = await service.view()
  assert.equal(view.tokenConfigured, true)
  assert.equal(view.authPaused, true)
  assert.ok(view.lastErrorAt > 0)
  await service.sync(true)
  assert.equal((await service.view()).lastErrorAt, view.lastErrorAt, 'automatic attempts must leave paused diagnosis intact')
  assert.equal(view.encryptionConfigured, true)
  assert.equal(view.githubLogin, undefined)
  assert.match(view.lastError, /凭据已保留/)
  const persisted = JSON.parse(await readFile(metadataPath, 'utf8'))
  assert.equal(persisted.lastError, view.lastError)
  const reopened = await GistSyncService.open(fixture.store, fixture.credentials, new GistTokenVault(fixture.provider), metadataPath)
  t.after(() => reopened.close())
  assert.equal((await reopened.view()).authPaused, true)
  assert.equal((await reopened.view()).lastErrorAt, view.lastErrorAt)
  valid = true
  await service.testConnection()
  assert.equal((await service.view()).authPaused, false)
  assert.equal((await service.view()).lastError, undefined)
})

test('a transient 401 is verified without deleting token and manual retry recovers', async t => {
  const fixture = await createFixture(t, 'transient-401')
  let first = true
  const service = await GistSyncService.open(fixture.store, fixture.credentials, new GistTokenVault(fixture.provider), join(fixture.directory, 'gist.json'), token => new GitHubGistClient(token, async () => {
    if (first) { first = false; return json({ message: 'Bad credentials' }, 401) }
    return json({ login: 'tester' })
  }))
  t.after(() => service.close())
  await service.configure({ settings: { autoSync: false, strategy: 'smart', backupRetention: 2 }, token: 'github-token-value-for-tests' })
  await assert.rejects(service.testConnection(), /账号授权复核有效/)
  assert.equal((await service.view()).tokenConfigured, true)
  assert.equal((await service.view()).authPaused, false)
  await service.testConnection()
  assert.equal((await service.view()).lastError, undefined)
  assert.equal((await service.view()).lastErrorAt, undefined)
})

test('an old failing request cannot overwrite newly saved authorization', async t => {
  const fixture = await createFixture(t, 'stale-401')
  let release
  let started
  const pending = new Promise(resolve => { started = resolve })
  const service = await GistSyncService.open(fixture.store, fixture.credentials, new GistTokenVault(fixture.provider), join(fixture.directory, 'gist.json'), token => new GitHubGistClient(token, async () => {
    if (token === 'github-old-token-value-tests') { started(); return new Promise(resolve => { release = () => resolve(json({ message: 'Bad credentials' }, 401)) }) }
    return json({ login: 'new-account' })
  }))
  t.after(() => service.close())
  const settings = { autoSync: false, strategy: 'smart', backupRetention: 2 }
  await service.configure({ settings, token: 'github-old-token-value-tests' })
  const attempt = assert.rejects(service.testConnection(), /Bad credentials/)
  await pending
  await service.configure({ settings, token: 'github-new-token-value-tests' })
  await service.testConnection()
  release()
  await attempt
  const view = await service.view()
  assert.equal(view.tokenConfigured, true)
  assert.equal(view.githubLogin, 'new-account')
  assert.equal(view.lastError, undefined)
  assert.equal(view.authPaused, false)
})

test('network failure during 401 verification preserves token without declaring expiration', async t => {
  const fixture = await createFixture(t, 'verification-network')
  let first = true
  const service = await GistSyncService.open(fixture.store, fixture.credentials, new GistTokenVault(fixture.provider), join(fixture.directory, 'gist.json'), token => new GitHubGistClient(token, async () => {
    if (first) { first = false; return json({ message: 'Bad credentials' }, 401) }
    throw new Error('network timeout')
  }))
  t.after(() => service.close())
  await service.configure({ settings: { autoSync: false, strategy: 'smart', backupRetention: 2 }, token: 'github-token-value-for-tests' })
  await assert.rejects(service.testConnection(), /授权复核未完成/)
  assert.equal((await service.view()).tokenConfigured, true)
  assert.equal((await service.view()).authPaused, false)
  await assert.rejects(service.testConnection(), /network timeout/)
  assert.equal((await service.view()).tokenConfigured, true)
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
  await assert.rejects(client.get('abcdef1234567890abcdef1234567890'), /只支持私有 Gist/)
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

test('commands round-trip, smart-merge edits and deletions, and reject malformed remote commands', () => {
  const state = emptyState()
  state.commands = [{ id: 'cmd-one', name: '状态', command: 'pwd\nls', createdAt: 10, updatedAt: 10 }]
  const local = createPortableSnapshot(state, 'device-local', undefined, 100)
  assert.deepEqual(parsePortableSnapshot(JSON.stringify(local)).collections.commands, state.commands)
  const remote = structuredClone(local)
  remote.collections.commands[0].command = 'ls -la'; remote.collections.commands[0].updatedAt = 20
  assert.equal(mergePortableSnapshots(local, remote, 'device-merge').collections.commands[0].command, 'ls -la')
  local.tombstones.commands['cmd-one'] = 30
  assert.deepEqual(mergePortableSnapshots(local, remote, 'device-merge').collections.commands, [])
  remote.collections.commands[0].command = '\x1b[2J'
  assert.throws(() => parsePortableSnapshot(JSON.stringify(remote)), /命令/)
})

test('legacy cloud snapshots preserve local commands and migrate them into cloud even with cloud-first', async t => {
  const target = await createFixture(t, 'legacy-commands')
  const command = { id: 'local-command', name: '本地命令', command: 'pwd', createdAt: 10, updatedAt: 10 }
  await target.store.update(state => { state.commands = [command] })
  const legacy = createPortableSnapshot(emptyState(), 'old-device', undefined, 100)
  delete legacy.collections.commands; delete legacy.tombstones.commands
  const github = new MemoryGistApi()
  github.files['dsh-ssh.config.json'] = JSON.stringify(legacy)
  const service = await GistSyncService.open(target.store, target.credentials, new GistTokenVault(target.provider), join(target.directory, 'gist.json'), token => new GitHubGistClient(token, github.fetch))
  t.after(() => service.close())
  await service.configure({ settings: { autoSync: false, strategy: 'cloud-first', backupRetention: 2, gistId: github.id }, token: 'github-token-value-for-tests', encryptionPassphrase: '123456' })
  await service.sync()
  assert.deepEqual(target.store.commands(), [command])
  assert.deepEqual(JSON.parse(github.files['dsh-ssh.config.json']).collections.commands, [command])
  const remote = JSON.parse(github.files['dsh-ssh.config.json'])
  remote.collections.commands = []; remote.tombstones.commands[command.id] = 200
  github.files['dsh-ssh.config.json'] = JSON.stringify(remote)
  await service.sync()
  assert.deepEqual(target.store.commands(), [], 'explicit new-format deletions still apply')
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

test('account setup can verify a new token before repairing an inaccessible old Gist', async t => {
  const fixture = await createFixture(t, 'account-only')
  const requests = []
  const service = await GistSyncService.open(
    fixture.store, fixture.credentials, new GistTokenVault(fixture.provider), join(fixture.directory, 'gist.json'),
    token => new GitHubGistClient(token, async url => {
      requests.push(String(url))
      if (String(url).endsWith('/user')) return new Response(JSON.stringify({ login: 'new-account' }), { status: 200 })
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
    }),
  )
  t.after(() => service.close())
  await service.configure({ settings: { autoSync: false, strategy: 'smart', backupRetention: 5, gistId: 'abcdef123' }, token: 'github-token-value-for-tests' })
  assert.deepEqual(await service.testConnection(true), { login: 'new-account' })
  assert.equal(requests.length, 1, 'account setup must not read or decrypt old storage')
  assert.equal((await service.view()).githubLogin, 'new-account')
  assert.equal((await service.view()).gistId, 'abcdef123', 'account setup preserves the stored destination')
  await assert.rejects(service.testConnection(), /Not Found/, 'full connection test still checks storage')
})

test('encrypted file backup previews, imports independent copies and preserves local-only state', async t => {
  const { exportConfiguration, previewConfiguration, importConfiguration } = await import('../lib/config-backup.js')
  const { groupProxyId } = await import('../lib/group-proxy.js')
  const fixture = await createFixture(t, 'file-backup')
  await seedPortableConfiguration(fixture.store, fixture.credentials)
  await fixture.store.update(state => {
    state.profiles[0].group = 'Production'
    state.profiles.push({ ...profile('jump-host', 'Jump', 100), proxy: { type: 'jump', profileIds: ['host-one'] }, group: 'Production' })
    state.groupProxies = [{ id: groupProxyId('Production'), name: 'Production', proxyId: 'proxy-one', createdAt: 100, updatedAt: 100 }]
    state.commands = [{ id: 'command-one', name: 'Status', command: 'pwd', createdAt: 100, updatedAt: 100 }]
  })
  await fixture.credentials.replace('jump-host', { password: 'direct-password' })
  const before = fixture.store.snapshot()
  const content = await exportConfiguration(fixture.store, fixture.credentials, 'backup-password')
  assert.doesNotMatch(content, /vault-password|PRIVATE KEY|host-one|proxy.internal|direct-password/)
  assert.deepEqual(await previewConfiguration(content, 'backup-password'), { profiles: 2, ftpProfiles: 1, remoteProjects: 1, credentialEntries: 2, proxyEntries: 1, commands: 1, groupProxies: 1 })
  await assert.rejects(importConfiguration(fixture.store, fixture.credentials, content, 'wrong-password'), /密码/)
  const damaged = JSON.parse(content); damaged.ciphertext = 'AAAA' + damaged.ciphertext.slice(4)
  await assert.rejects(importConfiguration(fixture.store, fixture.credentials, JSON.stringify(damaged), 'backup-password'), /损坏/)
  assert.deepEqual(fixture.store.snapshot(), before)
  await importConfiguration(fixture.store, fixture.credentials, content, 'backup-password')
  const after = fixture.store.snapshot(), host = after.profiles.find(p => p.id !== 'host-one' && p.name === 'Host one')
  assert.equal(after.profiles.length, 4)
  assert.deepEqual(after.profiles.slice(0, 2), before.profiles)
  assert.deepEqual(after.settings, before.settings)
  assert.deepEqual(after.injections, before.injections)
  assert.deepEqual(after.forwardRules, before.forwardRules)
  assert.equal((await fixture.credentials.readEntry(host.credentialId)).password, 'vault-password')
  assert.equal((await fixture.credentials.readProxyEntry(host.proxy.proxyId)).proxyPassword, 'proxy-password')
  const jump = after.profiles.find(p => p.id !== 'jump-host' && p.name === 'Jump')
  assert.deepEqual(jump.proxy.profileIds, [host.id])
  assert.equal((await fixture.credentials.read(jump.id)).password, 'direct-password')
  assert.equal(jump.group, host.group)
  assert.notEqual(host.group, 'Production')
  assert.equal(after.groupProxies[1].id, groupProxyId(host.group))
  assert.equal(after.groupProxies[1].proxyId, host.proxy.proxyId)
  assert.equal(after.remoteProjects[1].profileId, host.id)
  assert.equal(after.ftpProfiles[1].credentialId, host.credentialId)
  // A future backup and cold load must accept remapped identifiers and groups.
  await previewConfiguration(await exportConfiguration(fixture.store, fixture.credentials, 'backup-password'), 'backup-password')
  const reopened = await SshStore.open(join(fixture.directory, 'state.json'), before.settings)
  for (const key of ['profiles', 'ftpProfiles', 'remoteProjects', 'credentialEntries', 'proxyEntries', 'commands', 'groupProxies']) assert.deepEqual(reopened.snapshot()[key], after[key])
})

test('file import publishes no configuration and cleans new secrets when persistence fails', async t => {
  const { exportConfiguration, importConfiguration } = await import('../lib/config-backup.js')
  const source = await createFixture(t, 'backup-source'), target = await createFixture(t, 'backup-failed')
  await seedPortableConfiguration(source.store, source.credentials)
  const content = await exportConfiguration(source.store, source.credentials, 'backup-password')
  const before = target.store.snapshot(), written = []
  const replace = target.credentials.replaceEntry.bind(target.credentials)
  target.credentials.replaceEntry = async (id, value) => { written.push(id); await replace(id, value) }
  target.store.update = async () => { throw new Error('disk full') }
  await assert.rejects(importConfiguration(target.store, target.credentials, content, 'backup-password'), /disk full/)
  assert.deepEqual(target.store.snapshot(), before)
  assert.ok(written.length)
  for (const id of written) assert.deepEqual(await target.credentials.readEntry(id), {})
})

test('file transfer shares cloud sync queue and recovers after a failed transfer', async t => {
  const fixture = await createFixture(t, 'transfer-queue')
  const service = await GistSyncService.open(fixture.store, fixture.credentials, new GistTokenVault(fixture.provider), join(fixture.directory, 'gist.json'))
  t.after(() => service.close())
  const events = []
  let release
  const first = service.withConfigurationTransfer(async () => { events.push('import'); await new Promise(resolve => { release = resolve }); events.push('done') })
  await new Promise(resolve => setImmediate(resolve))
  service.performSync = async () => { events.push('sync'); return {} }
  const sync = service.sync()
  const second = service.withConfigurationTransfer(async () => { events.push('export'); throw new Error('failed export') })
  assert.deepEqual(events, ['import'])
  release(); await first; await sync; await assert.rejects(second, /failed export/)
  await service.withConfigurationTransfer(async () => { events.push('retry') })
  assert.deepEqual(events, ['import', 'done', 'sync', 'export', 'retry'])
})

test('backup HTTP routes require management header and round-trip without a GitHub account', async t => {
  const { createServer } = await import('node:http')
  const { registerSshApi } = await import('../lib/api.js')
  const fixture = await createFixture(t, 'backup-api')
  await seedPortableConfiguration(fixture.store, fixture.credentials)
  const service = await GistSyncService.open(fixture.store, fixture.credentials, new GistTokenVault(fixture.provider), join(fixture.directory, 'gist.json'))
  t.after(() => service.close())
  let route
  registerSshApi({ register(value) { route = value; return () => {} } }, '/ssh-local/v1', { ...fixture, gistSync: service })
  const server = createServer((req, res) => { void route.handler(req, res) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const request = (action, body, headers = { 'X-DSH-SSH-Request': '1' }) => fetch(`http://127.0.0.1:${server.address().port}/ssh-local/v1/config-backup/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const passphrase = 'api-backup-password'
  for (const action of ['export', 'preview', 'import']) assert.equal((await request(action, { passphrase }, {})).status, 403)
  assert.equal((await request('export', { passphrase: 'short' })).status, 400)
  const exported = await request('export', { passphrase })
  assert.equal(exported.status, 200)
  assert.equal(exported.headers.get('cache-control'), 'no-store')
  const { content } = await exported.json()
  assert.equal((await request('preview', { content, passphrase: 'wrong-password' })).status, 400)
  assert.equal((await request('preview', { content, passphrase })).status, 200)
  assert.equal((await request('import', { content, passphrase })).status, 200)
  assert.equal(fixture.store.profiles().length, 2)
  assert.equal((await service.view()).tokenConfigured, false)
  // Drain background metadata writes before the fixture's earlier cleanup hook.
  await service.close()
})
