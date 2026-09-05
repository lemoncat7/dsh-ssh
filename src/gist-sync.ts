import { t, tx } from './i18n.js'
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { credentialKey, type CredentialProvider, type GrantRecord } from '@deepseek-ai/dsh-credentials'
import {
  normalizeCredentialEntryDraft,
  normalizeFtpProfileDraft,
  normalizeProfileDraft,
  normalizeProxyEntryDraft,
  normalizeRemoteProjectDraft,
  type CredentialEntry,
  type FtpProfile,
  type ProxyEntry,
  type RemoteProject,
  type SshProfile,
  type SshCredentialPayload,
  type SshState,
} from './domain.js'
import { SshCredentialVault } from './credentials.js'
import { GitHubDeviceAuthService, type GitHubDeviceFlowStart, type GitHubDeviceFlowStatus } from './github-device-auth.js'
import { createGitHubHttpTransport, type GitHubHttpTransport } from './github-http.js'
import { SshStore } from './store.js'

const MAIN_FILE = 'dsh-ssh.config.json'
const BACKUP_PREFIX = 'dsh-ssh.backup.'
const MAX_GIST_BYTES = 1_048_576
const AUTO_SYNC_DELAY_MS = 3_000
const AUTO_PULL_INTERVAL_MS = 5 * 60_000
const GIST_CREDENTIAL_SCOPE = 'dsh-ssh-gist-sync'
const COLLECTION_NAMES = ['profiles', 'ftpProfiles', 'remoteProjects', 'credentialEntries', 'proxyEntries'] as const

export type GistSyncStrategy = 'smart' | 'local-first' | 'cloud-first'
type CollectionName = typeof COLLECTION_NAMES[number]
type PortableItem = SshProfile | FtpProfile | RemoteProject | CredentialEntry | ProxyEntry
type SecretScope = 'ssh-profile' | 'ftp-profile' | 'vault-entry' | 'proxy-entry'

export interface GistSyncSettings {
  autoSync: boolean
  strategy: GistSyncStrategy
  backupRetention: number
  gistId?: string
  oauthClientId?: string
}

export interface GistSyncView extends GistSyncSettings {
  tokenConfigured: boolean
  encryptionConfigured: boolean
  running: boolean
  lastSyncAt?: number
  lastResult?: 'uploaded' | 'downloaded' | 'merged' | 'unchanged'
  lastError?: string
  gistUrl?: string
  githubLogin?: string
  cloudVersion?: string
  oauthAvailable: boolean
}

export interface PortableSshSnapshot {
  schemaVersion: 1
  exportedAt: number
  sourceDeviceId: string
  collections: {
    profiles: SshProfile[]
    ftpProfiles: FtpProfile[]
    remoteProjects: RemoteProject[]
    credentialEntries: CredentialEntry[]
    proxyEntries: ProxyEntry[]
  }
  tombstones: Record<CollectionName, Record<string, number>>
  secrets: EncryptedSecretRecord[]
}

export interface EncryptedSecretRecord {
  scope: SecretScope
  id: string
  updatedAt: number
  contentHash: string
  salt: string
  iv: string
  authTag: string
  ciphertext: string
}

interface SyncMetadata {
  schemaVersion: 1
  deviceId: string
  settings: GistSyncSettings
  tombstones: PortableSshSnapshot['tombstones']
  lastSyncedDigest?: string
  lastSyncAt?: number
  lastResult?: GistSyncView['lastResult']
  lastError?: string
  githubLogin?: string
  lastCloudVersion?: string
}

interface GistFile { filename: string; content?: string; raw_url?: string; truncated?: boolean }
interface GistDocument { id: string; html_url: string; public: false; version?: string; files: Record<string, GistFile> }

export class GitHubApiError extends Error {
  constructor(readonly status: number, readonly detail: string) {
    super(tx`GitHub Gist request failed: ${detail}`)
    this.name = 'GitHubApiError'
  }
}

export class GistTokenVault {
  constructor(private readonly provider: CredentialProvider) {}

  async configured(): Promise<{ token: boolean; encryption: boolean }> {
    const record = await this.readRecord()
    return { token: record.token !== undefined, encryption: record.encryptionPassphrase !== undefined }
  }

  async readToken(): Promise<string | undefined> { return (await this.readRecord()).token }
  async readEncryptionPassphrase(): Promise<string | undefined> { return (await this.readRecord()).encryptionPassphrase }

  private async readRecord(): Promise<{ token?: string; encryptionPassphrase?: string }> {
    const record = await this.provider.readRecord(credentialKey(GIST_CREDENTIAL_SCOPE, 'default'))
    if (record === undefined) return {}
    if (record.kind !== 'grant') throw new Error(t("Invalid Gist sync credential format."))
    return parseGistCredentialPayload(record.payload)
  }

  async write(value: { token?: string; encryptionPassphrase?: string }): Promise<void> {
    await this.provider.modifyRecord(credentialKey(GIST_CREDENTIAL_SCOPE, 'default'), async current => {
      if (current !== undefined && current.kind !== 'grant') throw new Error(t("Invalid Gist sync credential format."))
      const previous = current === undefined ? {} : parseGistCredentialPayload(current.payload)
      const payload = {
        ...previous,
        ...(value.token === undefined ? {} : { token: normalizeToken(value.token) }),
        ...(value.encryptionPassphrase === undefined ? {} : { encryptionPassphrase: normalizeEncryptionPassphrase(value.encryptionPassphrase) }),
      }
      return { kind: 'grant', payload } satisfies GrantRecord
    })
  }

  async delete(): Promise<void> {
    await this.provider.deleteRecord(credentialKey(GIST_CREDENTIAL_SCOPE, 'default'))
  }

  async clearToken(): Promise<void> {
    const key = credentialKey(GIST_CREDENTIAL_SCOPE, 'default')
    const current = await this.provider.readRecord(key)
    if (current === undefined) return
    if (current.kind !== 'grant') throw new Error(t("Invalid Gist sync credential format."))
    const previous = parseGistCredentialPayload(current.payload)
    if (previous.encryptionPassphrase === undefined) {
      await this.provider.deleteRecord(key)
      return
    }
    await this.provider.modifyRecord(key, async () => ({
      kind: 'grant', payload: { encryptionPassphrase: previous.encryptionPassphrase },
    }))
  }
}

export class GitHubGistClient {
  constructor(private readonly token: string, private readonly request: typeof fetch = fetch) {}

  async identify(): Promise<{ login: string }> {
    const value = await this.json('https://api.github.com/user') as Record<string, unknown>
    if (typeof value.login !== 'string') throw new Error(t("GitHub did not return a valid account."))
    return { login: value.login }
  }

  async get(id: string): Promise<GistDocument> {
    return parseGist(await this.json(`https://api.github.com/gists/${normalizeGistId(id)}`))
  }

  async create(content: string): Promise<GistDocument> {
    return parseGist(await this.json('https://api.github.com/gists', {
      method: 'POST',
      body: JSON.stringify({ description: 'DSH SSH portable configuration', public: false, files: { [MAIN_FILE]: { content } } }),
    }))
  }

  async update(id: string, files: Record<string, { content: string } | null>): Promise<GistDocument> {
    return parseGist(await this.json(`https://api.github.com/gists/${normalizeGistId(id)}`, {
      method: 'PATCH', body: JSON.stringify({ files }),
    }))
  }

  async content(gist: GistDocument, filename = MAIN_FILE): Promise<string | undefined> {
    const file = gist.files[filename]
    if (file === undefined) return undefined
    if (file.truncated !== true && typeof file.content === 'string') return boundedContent(file.content)
    if (typeof file.raw_url !== 'string' || !file.raw_url.startsWith('https://gist.githubusercontent.com/')) {
      throw new Error(tx`Gist file ${filename} has no trusted download URL.`)
    }
    const response = await this.request(file.raw_url, { headers: this.headers(), signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(tx`Failed to read Gist file (HTTP ${response.status})`)
    return boundedContent(await response.text())
  }

  private async json(url: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.request(url, {
      ...init,
      headers: { ...this.headers(), ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...init.headers },
      signal: AbortSignal.timeout(15_000),
    })
    const value = await response.json().catch(() => undefined) as unknown
    if (!response.ok) {
      const detail = typeof value === 'object' && value !== null && typeof (value as { message?: unknown }).message === 'string'
        ? (value as { message: string }).message
        : `HTTP ${response.status}`
      throw new GitHubApiError(response.status, detail)
    }
    return value
  }

  private headers(): Record<string, string> {
    return {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${this.token}`,
      'user-agent': 'dsh-ssh-gist-sync',
      'x-github-api-version': '2022-11-28',
    }
  }
}

export class GistSyncService {
  private metadata: SyncMetadata
  private persistQueue: Promise<void> = Promise.resolve()
  private syncQueue: Promise<GistSyncView> = Promise.resolve(undefined as never)
  private unsubscribe: (() => void) | undefined
  private autoTimer: NodeJS.Timeout | undefined
  private pullTimer: NodeJS.Timeout | undefined
  private applying = false
  private running = false
  private readonly oauth: GitHubDeviceAuthService

  private constructor(
    private readonly store: SshStore,
    private readonly credentials: SshCredentialVault,
    private readonly vault: GistTokenVault,
    private readonly metadataPath: string,
    metadata: SyncMetadata,
    private readonly clientFactory: (token: string) => GitHubGistClient,
    private readonly githubHttp: GitHubHttpTransport,
  ) {
    this.metadata = metadata
    this.oauth = new GitHubDeviceAuthService(
      () => this.metadata.settings.oauthClientId,
      async token => {
        const identity = await this.clientFactory(token).identify()
        await this.vault.write({ token })
        this.metadata.githubLogin = identity.login
        delete this.metadata.lastError
        await this.persist()
        return identity
      },
      githubHttp.request,
    )
  }

  static async open(
    store: SshStore,
    credentials: SshCredentialVault,
    vault: GistTokenVault,
    metadataPath: string,
    clientFactory?: (token: string) => GitHubGistClient,
  ): Promise<GistSyncService> {
    const metadata = await readMetadata(metadataPath)
    const githubHttp = createGitHubHttpTransport(() => store.settings().githubProxy)
    const factory = clientFactory ?? (token => new GitHubGistClient(token, githubHttp.request))
    const service = new GistSyncService(store, credentials, vault, metadataPath, metadata, factory, githubHttp)
    service.unsubscribe = store.subscribe((previous, next) => { service.onStoreChanged(previous, next) })
    service.configureAutomaticSync()
    if (metadata.settings.autoSync) service.scheduleAutoSync(1_500)
    return service
  }

  async close(): Promise<void> {
    this.oauth.close()
    this.unsubscribe?.()
    this.unsubscribe = undefined
    if (this.autoTimer !== undefined) clearTimeout(this.autoTimer)
    if (this.pullTimer !== undefined) clearInterval(this.pullTimer)
    await this.persistQueue
    await this.syncQueue.catch(() => {})
    await this.githubHttp.close()
  }

  async testNetwork(): Promise<{ route: 'direct' | 'proxy' }> {
    const response = await this.githubHttp.request('https://api.github.com/meta', {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-ssh-github-network-test' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(tx`GitHub network test failed (HTTP ${response.status})`)
    await response.body?.cancel()
    return { route: this.githubHttp.route() }
  }

  async view(): Promise<GistSyncView> {
    const settings = this.metadata.settings
    const configured = await this.vault.configured()
    return {
      ...settings,
      tokenConfigured: configured.token,
      encryptionConfigured: configured.encryption,
      running: this.running,
      ...(this.metadata.lastSyncAt === undefined ? {} : { lastSyncAt: this.metadata.lastSyncAt }),
      ...(this.metadata.lastResult === undefined ? {} : { lastResult: this.metadata.lastResult }),
      ...(this.metadata.lastError === undefined ? {} : { lastError: this.metadata.lastError }),
      ...(settings.gistId === undefined ? {} : { gistUrl: `https://gist.github.com/${settings.gistId}` }),
      ...(this.metadata.githubLogin === undefined ? {} : { githubLogin: this.metadata.githubLogin }),
      ...(this.metadata.lastCloudVersion === undefined ? {} : { cloudVersion: this.metadata.lastCloudVersion }),
      oauthAvailable: settings.oauthClientId !== undefined,
    }
  }

  async configure(value: unknown): Promise<GistSyncView> {
    const input = asRecord(value, t("Gist sync settings"))
    const previousGistId = this.metadata.settings.gistId
    const settings = normalizeSettings(input.settings ?? input)
    const credentialUpdate: { token?: string; encryptionPassphrase?: string } = {}
    if (typeof input.token === 'string' && input.token.trim().length > 0) credentialUpdate.token = input.token
    if (typeof input.encryptionPassphrase === 'string' && input.encryptionPassphrase.length > 0) credentialUpdate.encryptionPassphrase = input.encryptionPassphrase
    if (Object.keys(credentialUpdate).length > 0) {
      await this.vault.write(credentialUpdate)
      if (credentialUpdate.token !== undefined) delete this.metadata.githubLogin
    }
    if (input.clearToken === true) {
      await this.vault.clearToken()
      delete this.metadata.githubLogin
    }
    this.metadata.settings = settings
    if (previousGistId !== settings.gistId) delete this.metadata.lastSyncedDigest
    delete this.metadata.lastError
    await this.persist()
    this.configureAutomaticSync()
    if (settings.autoSync) this.scheduleAutoSync(500)
    return this.view()
  }

  async testConnection(): Promise<{ login: string; gistId?: string }> {
    try {
      const client = await this.client()
      const identity = await client.identify()
      const gistId = this.metadata.settings.gistId
      if (gistId !== undefined) {
        const gist = await client.get(gistId)
        if (gist.version !== undefined) this.metadata.lastCloudVersion = gist.version
        const content = await client.content(gist)
        if (content !== undefined) {
          const snapshot = parsePortableSnapshot(content)
          await decryptSecretRecords(snapshot.secrets, await this.encryptionPassphrase())
        }
      }
      this.metadata.githubLogin = identity.login
      delete this.metadata.lastError
      await this.persist()
      return { login: identity.login, ...(gistId === undefined ? {} : { gistId }) }
    } catch (error) {
      throw await this.recordFailure(error)
    }
  }

  startOAuth(): Promise<GitHubDeviceFlowStart> { return this.oauth.start() }

  pollOAuth(id: string): Promise<GitHubDeviceFlowStatus> { return this.oauth.poll(id) }

  async disconnectGitHub(): Promise<GistSyncView> {
    await this.vault.clearToken()
    delete this.metadata.githubLogin
    delete this.metadata.lastError
    await this.persist()
    return this.view()
  }

  sync(): Promise<GistSyncView> {
    const operation = this.syncQueue.catch(() => undefined as never).then(() => this.performSync())
    this.syncQueue = operation
    return operation
  }

  private async performSync(): Promise<GistSyncView> {
    this.running = true
    delete this.metadata.lastError
    try {
      await this.persistQueue
      const client = await this.client()
      const passphrase = await this.encryptionPassphrase()
      const local = await createEncryptedPortableSnapshot(this.store.snapshot(), this.metadata.deviceId, this.metadata.tombstones, this.credentials, passphrase)
      const localDigest = snapshotDigest(local)
      const gistId = this.metadata.settings.gistId
      if (gistId === undefined) {
        const created = await client.create(serializeSnapshot(local))
        this.metadata.settings = { ...this.metadata.settings, gistId: created.id }
        this.complete(local, localDigest, 'uploaded', created.version)
        await this.persist()
        return this.view()
      }

      let gist = await client.get(gistId)
      const content = await client.content(gist)
      if (content === undefined) {
        gist = await client.update(gistId, { [MAIN_FILE]: { content: serializeSnapshot(local) } })
        this.complete(local, localDigest, 'uploaded', gist.version)
        await this.persist()
        return this.view()
      }

      const remote = parsePortableSnapshot(content)
      const remoteDigest = snapshotDigest(remote)
      const isFreshEmptyDevice = this.metadata.lastSyncedDigest === undefined
        && !snapshotHasPortableData(local)
        && snapshotHasPortableData(remote)
      const decision = isFreshEmptyDevice
        ? 'remote'
        : resolveSyncDecision(localDigest, remoteDigest, this.metadata.lastSyncedDigest, this.metadata.settings.strategy)
      if (decision === 'unchanged') {
        this.complete(remote, remoteDigest, 'unchanged', gist.version)
      } else if (decision === 'remote') {
        if (localDigest !== remoteDigest) gist = await this.writeBackup(client, gist, local)
        await this.apply(remote, passphrase)
        this.complete(remote, remoteDigest, 'downloaded', gist.version)
      } else {
        const result = decision === 'merge' ? mergePortableSnapshots(local, remote, this.metadata.deviceId) : local
        const resultDigest = snapshotDigest(result)
        if (remoteDigest !== resultDigest) {
          gist = await this.writeMain(client, gist, result, remote)
        }
        if (localDigest !== resultDigest) await this.apply(result, passphrase)
        this.complete(result, resultDigest, decision === 'merge' ? 'merged' : 'uploaded', gist.version)
      }
      await this.persist()
      return this.view()
    } catch (error) {
      throw await this.recordFailure(error)
    } finally {
      this.running = false
    }
  }

  private async client(): Promise<GitHubGistClient> {
    const token = await this.vault.readToken()
    if (token === undefined) throw new Error(t("GitHub is not connected; reauthorize or save a valid Token first"))
    return this.clientFactory(token)
  }

  private async recordFailure(error: unknown): Promise<Error> {
    const authenticationFailure = error instanceof GitHubApiError && error.status === 401
    const failure = authenticationFailure
      ? new Error(t("GitHub authorization expired; reconnect GitHub"), { cause: error })
      : error instanceof Error ? error : new Error(String(error))
    if (authenticationFailure) {
      await this.vault.clearToken().catch(() => {})
      delete this.metadata.githubLogin
    }
    this.metadata.lastError = failure.message
    await this.persist().catch(() => {})
    return failure
  }

  private async encryptionPassphrase(): Promise<string> {
    const passphrase = await this.vault.readEncryptionPassphrase()
    if (passphrase === undefined) throw new Error(t("Save the sync encryption passphrase in Settings first."))
    return passphrase
  }

  private async writeMain(client: GitHubGistClient, gist: GistDocument, result: PortableSshSnapshot, previousRemote: PortableSshSnapshot): Promise<GistDocument> {
    const files: Record<string, { content: string } | null> = { [MAIN_FILE]: { content: serializeSnapshot(result) } }
    this.addBackupFiles(files, gist, previousRemote)
    return client.update(gist.id, files)
  }

  private async writeBackup(client: GitHubGistClient, gist: GistDocument, snapshot: PortableSshSnapshot): Promise<GistDocument> {
    const files: Record<string, { content: string } | null> = {}
    this.addBackupFiles(files, gist, snapshot)
    return Object.keys(files).length === 0 ? gist : client.update(gist.id, files)
  }

  private addBackupFiles(files: Record<string, { content: string } | null>, gist: GistDocument, snapshot: PortableSshSnapshot): void {
    const retention = this.metadata.settings.backupRetention
    const existing = Object.keys(gist.files).filter(name => name.startsWith(BACKUP_PREFIX)).sort().reverse()
    if (retention > 0) {
      const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '')
      const filename = tx`${BACKUP_PREFIX}${stamp}.${this.metadata.deviceId.slice(0, 8)}.${randomBytes(3).toString('hex')}.json`
      files[filename] = { content: serializeSnapshot(snapshot) }
      for (const stale of existing.slice(Math.max(0, retention - 1))) files[stale] = null
    } else {
      for (const stale of existing) files[stale] = null
    }
  }

  private async apply(snapshot: PortableSshSnapshot, passphrase: string): Promise<void> {
    const secrets = await decryptSecretRecords(snapshot.secrets, passphrase)
    const previous = this.store.snapshot()
    this.applying = true
    try {
      await this.store.update(state => {
        state.profiles = structuredClone(snapshot.collections.profiles)
        state.ftpProfiles = structuredClone(snapshot.collections.ftpProfiles)
        state.remoteProjects = structuredClone(snapshot.collections.remoteProjects)
        state.credentialEntries = structuredClone(snapshot.collections.credentialEntries)
        state.proxyEntries = structuredClone(snapshot.collections.proxyEntries)
      })
      await this.replaceSecrets(previous, snapshot, secrets)
    } finally {
      this.applying = false
    }
  }

  private async replaceSecrets(previous: SshState, snapshot: PortableSshSnapshot, secrets: Map<string, SshCredentialPayload>): Promise<void> {
    for (const id of uniqueIds(previous.profiles, snapshot.collections.profiles)) {
      const profile = snapshot.collections.profiles.find(item => item.id === id)
      const value = profile?.credentialId === undefined ? secrets.get(secretKey('ssh-profile', id)) : undefined
      if (value === undefined) await this.credentials.delete(id)
      else await this.credentials.replace(id, value)
    }
    for (const id of uniqueIds(previous.ftpProfiles, snapshot.collections.ftpProfiles)) {
      const profile = snapshot.collections.ftpProfiles.find(item => item.id === id)
      const value = profile?.credentialId === undefined ? secrets.get(secretKey('ftp-profile', id)) : undefined
      if (value === undefined) await this.credentials.deleteFtp(id)
      else await this.credentials.replaceFtp(id, value)
    }
    for (const id of uniqueIds(previous.credentialEntries, snapshot.collections.credentialEntries)) {
      const value = secrets.get(secretKey('vault-entry', id))
      if (value === undefined) await this.credentials.deleteEntry(id)
      else await this.credentials.replaceEntry(id, value)
    }
    for (const id of uniqueIds(previous.proxyEntries, snapshot.collections.proxyEntries)) {
      const value = secrets.get(secretKey('proxy-entry', id))
      if (value === undefined) await this.credentials.deleteProxyEntry(id)
      else await this.credentials.replaceProxyEntry(id, value)
    }
  }

  private complete(snapshot: PortableSshSnapshot, digest: string, result: NonNullable<GistSyncView['lastResult']>, cloudVersion?: string): void {
    this.metadata.tombstones = structuredClone(snapshot.tombstones)
    this.metadata.lastSyncedDigest = digest
    this.metadata.lastSyncAt = Date.now()
    this.metadata.lastResult = result
    if (cloudVersion !== undefined) this.metadata.lastCloudVersion = cloudVersion
    delete this.metadata.lastError
  }

  private onStoreChanged(previous: SshState, next: SshState): void {
    if (this.applying) return
    let changed = false
    const now = Date.now()
    for (const name of COLLECTION_NAMES) {
      const previousIds = new Set(previous[name].map(item => item.id))
      const nextIds = new Set(next[name].map(item => item.id))
      for (const id of previousIds) if (!nextIds.has(id)) {
        this.metadata.tombstones[name][id] = now
        changed = true
      }
      if (!changed && snapshotCollectionDigest(previous[name]) !== snapshotCollectionDigest(next[name])) changed = true
    }
    if (!changed) return
    void this.persist()
    if (this.metadata.settings.autoSync) this.scheduleAutoSync()
  }

  private scheduleAutoSync(delay = AUTO_SYNC_DELAY_MS): void {
    if (!this.metadata.settings.autoSync) return
    if (this.autoTimer !== undefined) clearTimeout(this.autoTimer)
    this.autoTimer = setTimeout(() => {
      this.autoTimer = undefined
      void this.runAutomaticSync().catch(() => {})
    }, delay)
    this.autoTimer.unref?.()
  }

  private configureAutomaticSync(): void {
    if (this.pullTimer !== undefined) clearInterval(this.pullTimer)
    this.pullTimer = undefined
    if (!this.metadata.settings.autoSync) return
    this.pullTimer = setInterval(() => { void this.runAutomaticSync().catch(() => {}) }, AUTO_PULL_INTERVAL_MS)
    this.pullTimer.unref?.()
  }

  private async runAutomaticSync(): Promise<void> {
    const configured = await this.vault.configured()
    if (!configured.token || !configured.encryption) return
    await this.sync()
  }

  private persist(): Promise<void> {
    const value = structuredClone(this.metadata)
    const operation = this.persistQueue.then(() => writeMetadata(this.metadataPath, value))
    this.persistQueue = operation.catch(() => {})
    return operation
  }
}

export function createPortableSnapshot(
  state: SshState,
  deviceId: string,
  tombstones: PortableSshSnapshot['tombstones'] = emptyTombstones(),
  exportedAt = Date.now(),
): PortableSshSnapshot {
  return {
    schemaVersion: 1,
    exportedAt,
    sourceDeviceId: deviceId,
    collections: {
      profiles: sortItems(state.profiles),
      ftpProfiles: sortItems(state.ftpProfiles),
      remoteProjects: sortItems(state.remoteProjects),
      credentialEntries: sortItems(state.credentialEntries),
      proxyEntries: sortItems(state.proxyEntries),
    },
    tombstones: cloneTombstones(tombstones),
    secrets: [],
  }
}

export async function createEncryptedPortableSnapshot(
  state: SshState,
  deviceId: string,
  tombstones: PortableSshSnapshot['tombstones'],
  credentials: SshCredentialVault,
  passphrase: string,
  exportedAt = Date.now(),
): Promise<PortableSshSnapshot> {
  const snapshot = createPortableSnapshot(state, deviceId, tombstones, exportedAt)
  const records: Array<{ scope: SecretScope; id: string; updatedAt: number; value: SshCredentialPayload }> = []
  for (const profile of state.profiles) if (profile.credentialId === undefined) {
    records.push({ scope: 'ssh-profile', id: profile.id, updatedAt: profile.updatedAt, value: await credentials.read(profile.id) })
  }
  for (const profile of state.ftpProfiles) if (profile.credentialId === undefined) {
    records.push({ scope: 'ftp-profile', id: profile.id, updatedAt: profile.updatedAt, value: await credentials.readFtp(profile.id) })
  }
  for (const entry of state.credentialEntries) records.push({ scope: 'vault-entry', id: entry.id, updatedAt: entry.updatedAt, value: await credentials.readEntry(entry.id) })
  for (const entry of state.proxyEntries) records.push({ scope: 'proxy-entry', id: entry.id, updatedAt: entry.updatedAt, value: await credentials.readProxyEntry(entry.id) })
  const salt = randomBytes(16)
  const key = await deriveEncryptionKey(passphrase, salt)
  snapshot.secrets = (await Promise.all(records.filter(item => Object.keys(item.value).length > 0).map(item => encryptSecretRecord(item, salt, key))))
    .sort((left, right) => secretKey(left.scope, left.id).localeCompare(secretKey(right.scope, right.id)))
  return snapshot
}

export function parsePortableSnapshot(content: string): PortableSshSnapshot {
  const value = JSON.parse(boundedContent(content)) as unknown
  const input = asRecord(value, t("Gist config"))
  if (input.schemaVersion !== 1) throw new Error(tx`Unsupported Gist config version: ${String(input.schemaVersion)}`)
  const collections = asRecord(input.collections, t("Gist config collection"))
  const result: PortableSshSnapshot = {
    schemaVersion: 1,
    exportedAt: timestamp(input.exportedAt, 'exportedAt'),
    sourceDeviceId: text(input.sourceDeviceId, 'sourceDeviceId', 8, 100),
    collections: {
      profiles: array(collections.profiles, 'profiles').map(parseProfile),
      ftpProfiles: array(collections.ftpProfiles, 'ftpProfiles').map(parseFtpProfile),
      remoteProjects: array(collections.remoteProjects, 'remoteProjects').map(parseRemoteProject),
      credentialEntries: array(collections.credentialEntries, 'credentialEntries').map(parseCredentialEntry),
      proxyEntries: array(collections.proxyEntries, 'proxyEntries').map(parseProxyEntry),
    },
    tombstones: parseTombstones(input.tombstones),
    secrets: input.secrets === undefined ? [] : array(input.secrets, 'secrets').map(parseEncryptedSecretRecord).sort((a, b) => secretKey(a.scope, a.id).localeCompare(secretKey(b.scope, b.id))),
  }
  assertUniqueIds(result)
  assertPortableReferences(result.collections)
  return result
}

export function mergePortableSnapshots(local: PortableSshSnapshot, remote: PortableSshSnapshot, deviceId: string, now = Date.now()): PortableSshSnapshot {
  const tombstones = emptyTombstones()
  const collections = {} as PortableSshSnapshot['collections']
  for (const name of COLLECTION_NAMES) {
    const localItems = new Map(local.collections[name].map(item => [item.id, item] as const))
    const remoteItems = new Map(remote.collections[name].map(item => [item.id, item] as const))
    const deleted = { ...local.tombstones[name] }
    for (const [id, deletedAt] of Object.entries(remote.tombstones[name])) deleted[id] = Math.max(deleted[id] ?? 0, deletedAt)
    tombstones[name] = deleted
    const ids = new Set([...localItems.keys(), ...remoteItems.keys(), ...Object.keys(deleted)])
    const merged: PortableItem[] = []
    for (const id of ids) {
      const left = localItems.get(id)
      const right = remoteItems.get(id)
      const selected = selectNewest(left, right)
      if (selected !== undefined && selected.updatedAt > (deleted[id] ?? 0)) merged.push(structuredClone(selected))
    }
    ;(collections[name] as PortableItem[]) = sortItems(merged)
  }
  const result: PortableSshSnapshot = { schemaVersion: 1, exportedAt: now, sourceDeviceId: deviceId, collections, tombstones, secrets: [] }
  result.secrets = mergeSecretRecords(local.secrets, remote.secrets, result)
  repairReferences(result, now)
  result.secrets = result.secrets.filter(record => secretOwnerExists(record, result.collections))
  return result
}

export function snapshotDigest(snapshot: PortableSshSnapshot): string {
  const secrets = snapshot.secrets.map(record => ({ scope: record.scope, id: record.id, updatedAt: record.updatedAt, contentHash: record.contentHash }))
  return createHash('sha256').update(stableJson({ collections: snapshot.collections, tombstones: snapshot.tombstones, secrets })).digest('hex')
}

export function resolveSyncDecision(
  localDigest: string,
  remoteDigest: string,
  baseDigest: string | undefined,
  strategy: GistSyncStrategy,
): 'local' | 'remote' | 'merge' | 'unchanged' {
  if (localDigest === remoteDigest) return 'unchanged'
  if (baseDigest !== undefined) {
    const localChanged = localDigest !== baseDigest
    const remoteChanged = remoteDigest !== baseDigest
    if (localChanged && !remoteChanged) return 'local'
    if (!localChanged && remoteChanged) return 'remote'
  }
  return strategy === 'local-first' ? 'local' : strategy === 'cloud-first' ? 'remote' : 'merge'
}

function normalizeSettings(value: unknown): GistSyncSettings {
  const input = asRecord(value, t("Gist sync settings"))
  const strategy = input.strategy
  if (strategy !== 'smart' && strategy !== 'local-first' && strategy !== 'cloud-first') throw new Error(t("Invalid sync policy."))
  const backupRetention = input.backupRetention
  if (!Number.isSafeInteger(backupRetention) || (backupRetention as number) < 0 || (backupRetention as number) > 50) {
    throw new Error(t("Backup retention must be between 0 and 50."))
  }
  const gistId = input.gistId === undefined || input.gistId === null || input.gistId === '' ? undefined : normalizeGistId(input.gistId)
  const oauthClientId = input.oauthClientId === undefined || input.oauthClientId === null || input.oauthClientId === '' ? undefined : normalizeOAuthClientId(input.oauthClientId)
  return {
    autoSync: input.autoSync === true, strategy, backupRetention: backupRetention as number,
    ...(gistId === undefined ? {} : { gistId }),
    ...(oauthClientId === undefined ? {} : { oauthClientId }),
  }
}

function defaultSettings(): GistSyncSettings { return { autoSync: false, strategy: 'smart', backupRetention: 5 } }
function emptyTombstones(): PortableSshSnapshot['tombstones'] {
  return { profiles: {}, ftpProfiles: {}, remoteProjects: {}, credentialEntries: {}, proxyEntries: {} }
}
function cloneTombstones(value: PortableSshSnapshot['tombstones']): PortableSshSnapshot['tombstones'] {
  return Object.fromEntries(COLLECTION_NAMES.map(name => [name, { ...value[name] }])) as PortableSshSnapshot['tombstones']
}

async function readMetadata(path: string): Promise<SyncMetadata> {
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultMetadata()
    throw error
  }
  try {
    const input = asRecord(JSON.parse(content) as unknown, t("Gist sync status"))
    if (input.schemaVersion !== 1) throw new Error(tx`Unsupported Gist sync state version: ${String(input.schemaVersion)}`)
    return {
      schemaVersion: 1,
      deviceId: text(input.deviceId, 'deviceId', 8, 100),
      settings: normalizeSettings(input.settings),
      tombstones: parseTombstones(input.tombstones),
      ...(typeof input.lastSyncedDigest === 'string' ? { lastSyncedDigest: input.lastSyncedDigest } : {}),
      ...(typeof input.lastSyncAt === 'number' ? { lastSyncAt: input.lastSyncAt } : {}),
      ...(input.lastResult === 'uploaded' || input.lastResult === 'downloaded' || input.lastResult === 'merged' || input.lastResult === 'unchanged' ? { lastResult: input.lastResult } : {}),
      ...(typeof input.lastError === 'string' ? { lastError: input.lastError } : {}),
      ...(typeof input.githubLogin === 'string' ? { githubLogin: text(input.githubLogin, 'githubLogin', 1, 100) } : {}),
      ...(typeof input.lastCloudVersion === 'string' ? { lastCloudVersion: revision(input.lastCloudVersion) } : {}),
    }
  } catch (error) {
    const backupPath = `${path}.corrupt.${Date.now()}`
    const preserved = await rename(path, backupPath).then(() => true, () => false)
    const reason = error instanceof Error ? error.message : String(error)
    return defaultMetadata(tx`Local Gist sync state was corrupted and has been safely reset${preserved ? t(" and keep the original file") : ''}: ${reason}`)
  }
}

function defaultMetadata(lastError?: string): SyncMetadata {
  return {
    schemaVersion: 1,
    deviceId: randomBytes(16).toString('hex'),
    settings: defaultSettings(),
    tombstones: emptyTombstones(),
    ...(lastError === undefined ? {} : { lastError }),
  }
}

async function writeMetadata(path: string, value: SyncMetadata): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = tx`${path}.${process.pid}.${randomBytes(5).toString('hex')}.tmp`
  const handle = await open(temporary, 'w', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally { await handle.close() }
  try {
    await rename(temporary, path)
  } catch (error) {
    if (process.platform !== 'win32') throw error
    await rm(path, { force: true })
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }).catch(() => {}) }
}

function serializeSnapshot(value: PortableSshSnapshot): string {
  const content = `${JSON.stringify(value, null, 2)}\n`
  return boundedContent(content)
}

function boundedContent(content: string): string {
  if (Buffer.byteLength(content, 'utf8') > MAX_GIST_BYTES) throw new Error(t("Gist config exceeds the 1 MB limit."))
  return content
}

function parseGist(value: unknown): GistDocument {
  const input = asRecord(value, 'GitHub Gist')
  if (typeof input.public !== 'boolean') throw new Error(t("GitHub did not return the Gist visibility."))
  if (input.public) throw new Error(t("To avoid exposing host configs, SSH sync supports private Gists only."))
  const files = asRecord(input.files, 'GitHub Gist files')
  const parsedFiles: Record<string, GistFile> = {}
  for (const [name, raw] of Object.entries(files)) {
    const file = asRecord(raw, tx`Gist file ${name}`)
    parsedFiles[name] = {
      filename: typeof file.filename === 'string' ? file.filename : name,
      ...(typeof file.content === 'string' ? { content: file.content } : {}),
      ...(typeof file.raw_url === 'string' ? { raw_url: file.raw_url } : {}),
      ...(file.truncated === true ? { truncated: true } : {}),
    }
  }
  return {
    id: normalizeGistId(input.id),
    html_url: typeof input.html_url === 'string' ? input.html_url : `https://gist.github.com/${String(input.id)}`,
    public: false,
    ...parseGistVersion(input),
    files: parsedFiles,
  }
}

function parseProfile(value: unknown): SshProfile {
  const input = asRecord(value, 'SSH profile')
  const draft = normalizeProfileDraft(input)
  return {
    id: text(input.id, 'profile.id', 1, 100), name: draft.name, ...(draft.group === undefined ? {} : { group: draft.group }), host: draft.host,
    port: draft.port ?? 22, username: draft.username, authType: draft.authType, ...(draft.credentialId === undefined ? {} : { credentialId: draft.credentialId }),
    ...(draft.hostFingerprint === undefined ? {} : { hostFingerprint: draft.hostFingerprint }), proxy: draft.proxy ?? { type: 'none' },
    keepAliveIntervalMs: draft.keepAliveIntervalMs ?? 15_000, connectTimeoutMs: draft.connectTimeoutMs ?? 15_000,
    terminalType: draft.terminalType ?? 'xterm-256color', tags: draft.tags ?? [], createdAt: timestamp(input.createdAt, 'createdAt'), updatedAt: timestamp(input.updatedAt, 'updatedAt'),
  }
}

function parseFtpProfile(value: unknown): FtpProfile {
  const input = asRecord(value, 'FTP profile')
  const draft = normalizeFtpProfileDraft(input)
  return {
    id: text(input.id, 'ftpProfile.id', 1, 100), name: draft.name, ...(draft.group === undefined ? {} : { group: draft.group }), protocol: draft.protocol,
    host: draft.host, port: draft.port ?? (draft.protocol === 'ftps-implicit' ? 990 : 21), username: draft.username,
    ...(draft.credentialId === undefined ? {} : { credentialId: draft.credentialId }), proxy: draft.proxy ?? { type: 'none' }, initialPath: draft.initialPath ?? '/',
    connectTimeoutMs: draft.connectTimeoutMs ?? 15_000, ...(draft.tlsServerName === undefined ? {} : { tlsServerName: draft.tlsServerName }), tags: draft.tags ?? [],
    createdAt: timestamp(input.createdAt, 'createdAt'), updatedAt: timestamp(input.updatedAt, 'updatedAt'),
  }
}

function parseRemoteProject(value: unknown): RemoteProject {
  const input = asRecord(value, 'remote project')
  const draft = normalizeRemoteProjectDraft(input)
  return { id: text(input.id, 'project.id', 1, 100), profileId: text(input.profileId, 'project.profileId', 1, 100), ...draft, createdAt: timestamp(input.createdAt, 'createdAt'), updatedAt: timestamp(input.updatedAt, 'updatedAt') }
}

function parseCredentialEntry(value: unknown): CredentialEntry {
  const input = asRecord(value, 'credential entry')
  const draft = normalizeCredentialEntryDraft(input)
  return { id: text(input.id, 'credential.id', 1, 100), ...draft, createdAt: timestamp(input.createdAt, 'createdAt'), updatedAt: timestamp(input.updatedAt, 'updatedAt') }
}

function parseProxyEntry(value: unknown): ProxyEntry {
  const input = asRecord(value, 'proxy entry')
  const draft = normalizeProxyEntryDraft(input)
  return { id: text(input.id, 'proxy.id', 1, 100), ...draft, createdAt: timestamp(input.createdAt, 'createdAt'), updatedAt: timestamp(input.updatedAt, 'updatedAt') }
}

function parseEncryptedSecretRecord(value: unknown): EncryptedSecretRecord {
  const input = asRecord(value, 'encrypted secret')
  const scope = input.scope
  if (scope !== 'ssh-profile' && scope !== 'ftp-profile' && scope !== 'vault-entry' && scope !== 'proxy-entry') throw new Error(t("Invalid encrypted credential scope."))
  const record = {
    scope,
    id: text(input.id, 'secret.id', 1, 100),
    updatedAt: timestamp(input.updatedAt, 'secret.updatedAt'),
    contentHash: hexDigest(input.contentHash, 'secret.contentHash'),
    salt: base64(input.salt, 'secret.salt', 16),
    iv: base64(input.iv, 'secret.iv', 12),
    authTag: base64(input.authTag, 'secret.authTag', 16),
    ciphertext: base64(input.ciphertext, 'secret.ciphertext', undefined, 700_000),
  } satisfies EncryptedSecretRecord
  return record
}

async function encryptSecretRecord(
  item: { scope: SecretScope; id: string; updatedAt: number; value: SshCredentialPayload },
  salt: Buffer,
  key: Buffer,
): Promise<EncryptedSecretRecord> {
  const plaintext = Buffer.from(stableJson(parseSecretPayload(item.value)), 'utf8')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(`${item.scope}:${item.id}:${item.updatedAt}`, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return {
    scope: item.scope,
    id: item.id,
    updatedAt: item.updatedAt,
    contentHash: createHash('sha256').update(plaintext).digest('hex'),
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

async function decryptSecretRecords(records: EncryptedSecretRecord[], passphrase: string): Promise<Map<string, SshCredentialPayload>> {
  const output = new Map<string, SshCredentialPayload>()
  const keys = new Map<string, Promise<Buffer>>()
  for (const record of records) {
    const salt = Buffer.from(record.salt, 'base64')
    const iv = Buffer.from(record.iv, 'base64')
    let keyPromise = keys.get(record.salt)
    if (keyPromise === undefined) { keyPromise = deriveEncryptionKey(passphrase, salt); keys.set(record.salt, keyPromise) }
    const key = await keyPromise
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(Buffer.from(`${record.scope}:${record.id}:${record.updatedAt}`, 'utf8'))
    decipher.setAuthTag(Buffer.from(record.authTag, 'base64'))
    let plaintext: Buffer
    try { plaintext = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]) }
    catch { throw new Error(t("Cannot decrypt the Gist key data. Check the sync encryption passphrase.")) }
    if (createHash('sha256').update(plaintext).digest('hex') !== record.contentHash) throw new Error(t("Gist key data integrity check failed."))
    let value: unknown
    try { value = JSON.parse(plaintext.toString('utf8')) as unknown } catch { throw new Error(t("Gist key data is not valid JSON.")) }
    output.set(secretKey(record.scope, record.id), parseSecretPayload(value))
  }
  return output
}

export async function decryptPortableSecrets(snapshot: PortableSshSnapshot, passphrase: string): Promise<Record<string, SshCredentialPayload>> {
  return Object.fromEntries(await decryptSecretRecords(snapshot.secrets, passphrase))
}

function mergeSecretRecords(left: EncryptedSecretRecord[], right: EncryptedSecretRecord[], snapshot: PortableSshSnapshot): EncryptedSecretRecord[] {
  const records = new Map<string, EncryptedSecretRecord>()
  for (const candidate of [...left, ...right]) {
    if (!secretOwnerExists(candidate, snapshot.collections)) continue
    const key = secretKey(candidate.scope, candidate.id)
    const previous = records.get(key)
    if (previous === undefined || candidate.updatedAt > previous.updatedAt || candidate.updatedAt === previous.updatedAt && candidate.contentHash > previous.contentHash) {
      records.set(key, structuredClone(candidate))
    }
  }
  return [...records.values()].sort((a, b) => secretKey(a.scope, a.id).localeCompare(secretKey(b.scope, b.id)))
}

function secretOwnerExists(record: EncryptedSecretRecord, collections: PortableSshSnapshot['collections']): boolean {
  if (record.scope === 'ssh-profile') return collections.profiles.some(item => item.id === record.id && item.credentialId === undefined)
  if (record.scope === 'ftp-profile') return collections.ftpProfiles.some(item => item.id === record.id && item.credentialId === undefined)
  if (record.scope === 'vault-entry') return collections.credentialEntries.some(item => item.id === record.id)
  return collections.proxyEntries.some(item => item.id === record.id)
}

function secretKey(scope: SecretScope, id: string): string { return `${scope}:${id}` }

function deriveEncryptionKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  const normalized = normalizeEncryptionPassphrase(passphrase)
  return new Promise((resolve, reject) => {
    scrypt(normalized, salt, 32, (error, key) => { if (error !== null) reject(error); else resolve(key as Buffer) })
  })
}

function parseSecretPayload(value: unknown): SshCredentialPayload {
  const input = asRecord(value, 'credential payload')
  const output: SshCredentialPayload = {}
  for (const field of ['password', 'privateKey', 'passphrase', 'proxyPassword'] as const) {
    const candidate = input[field]
    if (candidate === undefined) continue
    if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > (field === 'privateKey' ? 512_000 : 16_384)) throw new Error(tx`Credential field ${field} is invalid.`)
    output[field] = candidate
  }
  return output
}

function parseTombstones(value: unknown): PortableSshSnapshot['tombstones'] {
  const input = value === undefined ? {} : asRecord(value, 'tombstones')
  const result = emptyTombstones()
  for (const name of COLLECTION_NAMES) {
    const entries = input[name] === undefined ? {} : asRecord(input[name], `tombstones.${name}`)
    for (const [id, raw] of Object.entries(entries)) result[name][text(id, 'tombstone id', 1, 100)] = timestamp(raw, 'deletedAt')
  }
  return result
}

function assertUniqueIds(snapshot: PortableSshSnapshot): void {
  for (const name of COLLECTION_NAMES) {
    const ids = snapshot.collections[name].map(item => item.id)
    if (new Set(ids).size !== ids.length) throw new Error(tx`Gist config contains duplicate ${name} ID`)
  }
  const secretIds = snapshot.secrets.map(item => secretKey(item.scope, item.id))
  if (new Set(secretIds).size !== secretIds.length) throw new Error(t("Gist config contains duplicate encrypted credentials."))
  if (snapshot.secrets.some(item => !secretOwnerExists(item, snapshot.collections))) throw new Error(t("Gist config contains encrypted credentials with no owner."))
}

function assertPortableReferences(collections: PortableSshSnapshot['collections']): void {
  const profiles = new Set(collections.profiles.map(item => item.id))
  const credentials = new Set(collections.credentialEntries.map(item => item.id))
  const proxies = new Set(collections.proxyEntries.map(item => item.id))
  for (const profile of collections.profiles) {
    if (profile.credentialId !== undefined && !credentials.has(profile.credentialId)) throw new Error(tx`Host ${profile.name} references a missing credential entry.`)
    if (profile.proxy.type === 'saved' && !proxies.has(profile.proxy.proxyId)) throw new Error(tx`Host ${profile.name} references a missing proxy.`)
    if (profile.proxy.type === 'jump' && profile.proxy.profileIds.some(id => !profiles.has(id) || id === profile.id)) throw new Error(tx`Host ${profile.name} has an invalid jump host chain.`)
  }
  for (const profile of collections.ftpProfiles) {
    if (profile.credentialId !== undefined && !credentials.has(profile.credentialId)) throw new Error(tx`FTP ${profile.name} references a missing credential entry.`)
    if (profile.proxy.type === 'saved' && !proxies.has(profile.proxy.proxyId)) throw new Error(tx`FTP ${profile.name} references a missing proxy.`)
  }
  for (const project of collections.remoteProjects) if (!profiles.has(project.profileId)) throw new Error(tx`Remote project ${project.name} references a missing host.`)
}

function repairReferences(snapshot: PortableSshSnapshot, deletedAt: number): void {
  const profiles = new Set(snapshot.collections.profiles.map(item => item.id))
  const credentials = new Set(snapshot.collections.credentialEntries.map(item => item.id))
  const proxies = new Set(snapshot.collections.proxyEntries.map(item => item.id))
  const invalidProfiles = new Set(snapshot.collections.profiles.filter(profile =>
    profile.credentialId !== undefined && !credentials.has(profile.credentialId)
    || profile.proxy.type === 'saved' && !proxies.has(profile.proxy.proxyId)
    || profile.proxy.type === 'jump' && profile.proxy.profileIds.some(id => !profiles.has(id) || id === profile.id),
  ).map(item => item.id))
  for (const id of invalidProfiles) snapshot.tombstones.profiles[id] = Math.max(snapshot.tombstones.profiles[id] ?? 0, deletedAt)
  snapshot.collections.profiles = snapshot.collections.profiles.filter(item => !invalidProfiles.has(item.id))
  const survivingProfiles = new Set(snapshot.collections.profiles.map(item => item.id))
  const invalidFtp = new Set(snapshot.collections.ftpProfiles.filter(profile =>
    profile.credentialId !== undefined && !credentials.has(profile.credentialId)
    || profile.proxy.type === 'saved' && !proxies.has(profile.proxy.proxyId),
  ).map(item => item.id))
  for (const id of invalidFtp) snapshot.tombstones.ftpProfiles[id] = Math.max(snapshot.tombstones.ftpProfiles[id] ?? 0, deletedAt)
  snapshot.collections.ftpProfiles = snapshot.collections.ftpProfiles.filter(item => !invalidFtp.has(item.id))
  const invalidProjects = new Set(snapshot.collections.remoteProjects.filter(project => !survivingProfiles.has(project.profileId)).map(item => item.id))
  for (const id of invalidProjects) snapshot.tombstones.remoteProjects[id] = Math.max(snapshot.tombstones.remoteProjects[id] ?? 0, deletedAt)
  snapshot.collections.remoteProjects = snapshot.collections.remoteProjects.filter(item => !invalidProjects.has(item.id))
}

function selectNewest<T extends PortableItem>(left: T | undefined, right: T | undefined): T | undefined {
  if (left === undefined) return right
  if (right === undefined) return left
  if (left.updatedAt !== right.updatedAt) return left.updatedAt > right.updatedAt ? left : right
  return stableJson(left) >= stableJson(right) ? left : right
}

function sortItems<T extends PortableItem>(items: T[]): T[] { return structuredClone(items).sort((a, b) => a.id.localeCompare(b.id)) }
function uniqueIds(...groups: Array<Array<{ id: string }>>): string[] { return [...new Set(groups.flatMap(group => group.map(item => item.id)))] }
function snapshotCollectionDigest(items: PortableItem[]): string { return createHash('sha256').update(stableJson(sortItems(items))).digest('hex') }
function snapshotHasPortableData(snapshot: PortableSshSnapshot): boolean {
  return COLLECTION_NAMES.some(name => snapshot.collections[name].length > 0 || Object.keys(snapshot.tombstones[name]).length > 0)
    || snapshot.secrets.length > 0
}
function stableJson(value: unknown): string { return JSON.stringify(stableValue(value)) }
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableValue(item)]))
}

function normalizeToken(value: string): string {
  const token = value.trim()
  if (token.length < 20 || token.length > 512 || /\s/.test(token)) throw new Error(t("Invalid GitHub Token format."))
  return token
}
function normalizeEncryptionPassphrase(value: string): string {
  if (value.length < 6 || value.length > 512) throw new Error(t("The sync encryption passphrase must be 6 to 512 characters."))
  return value
}
function parseGistCredentialPayload(value: unknown): { token?: string; encryptionPassphrase?: string } {
  const payload = asRecord(value, t("Gist sync credentials"))
  const token = payload.token
  const encryptionPassphrase = payload.encryptionPassphrase
  if (token !== undefined && (typeof token !== 'string' || token.length < 20 || token.length > 512)) throw new Error(t("Invalid Gist Token format."))
  if (encryptionPassphrase !== undefined && (typeof encryptionPassphrase !== 'string' || encryptionPassphrase.length < 6 || encryptionPassphrase.length > 512)) throw new Error(t("Invalid sync encryption passphrase format."))
  return {
    ...(typeof token === 'string' ? { token } : {}),
    ...(typeof encryptionPassphrase === 'string' ? { encryptionPassphrase } : {}),
  }
}
function normalizeGistId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{5,64}$/.test(value.trim())) throw new Error(t("Invalid Gist ID format."))
  return value.trim().toLowerCase()
}
function normalizeOAuthClientId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{10,128}$/.test(value.trim())) throw new Error(t("Invalid GitHub OAuth Client ID format."))
  return value.trim()
}
function parseGistVersion(input: Record<string, unknown>): { version?: string } {
  if (!Array.isArray(input.history) || input.history.length === 0) return {}
  const latest = input.history[0]
  if (typeof latest !== 'object' || latest === null || Array.isArray(latest)) return {}
  const value = (latest as Record<string, unknown>).version
  return typeof value === 'string' ? { version: revision(value) } : {}
}
function revision(value: string): string {
  if (!/^[a-fA-F0-9]{7,64}$/.test(value)) throw new Error(t("Invalid Gist cloud version format."))
  return value.toLowerCase()
}
function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(tx`${label} must be an object`)
  return value as Record<string, unknown>
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > 10_000) throw new Error(tx`${label} must be a valid array`)
  return value
}
function text(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== 'string' || value.length < min || value.length > max) throw new Error(tx`${label} has an invalid format`)
  return value
}
function timestamp(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(tx`${label} has an invalid format`)
  return value
}
function hexDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(tx`${label} has an invalid format`)
  return value
}
function base64(value: unknown, label: string, exactBytes?: number, maxBytes = exactBytes): string {
  if (typeof value !== 'string' || value.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error(tx`${label} has an invalid format`)
  const decoded = Buffer.from(value, 'base64')
  if (exactBytes !== undefined && decoded.length !== exactBytes) throw new Error(tx`${label} has an invalid length`)
  if (maxBytes !== undefined && decoded.length > maxBytes) throw new Error(tx`${label} exceeds the size limit`)
  if (decoded.toString('base64') !== value) throw new Error(tx`${label} has invalid encoding`)
  return value
}
