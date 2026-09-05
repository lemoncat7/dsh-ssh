import { tx } from './i18n.js'
import { randomBytes } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { CredentialEntry, ForwardRule, FtpProfile, ProxyEntry, RemoteProject, SessionInjection, SshProfile, SshSettings, SshState } from './domain.js'

export class SshStore {
  private state: SshState
  private queue: Promise<unknown> = Promise.resolve()
  private readonly listeners = new Set<(previous: SshState, next: SshState) => void>()

  private constructor(private readonly path: string, initial: SshState) {
    this.state = initial
  }

  static async open(path: string, defaults: SshSettings): Promise<SshStore> {
    await mkdir(dirname(path), { recursive: true })
    let initial: SshState = { schemaVersion: 5, profiles: [], ftpProfiles: [], remoteProjects: [], credentialEntries: [], proxyEntries: [], forwardRules: [], injections: [], settings: defaults }
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
      initial = parseState(parsed, defaults)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const store = new SshStore(path, initial)
    if (!(await fileExists(path))) await store.persist(initial)
    return store
  }

  snapshot(): SshState { return structuredClone(this.state) }
  profiles(): SshProfile[] { return structuredClone(this.state.profiles) }
  profile(id: string): SshProfile | undefined { return structuredClone(this.state.profiles.find(profile => profile.id === id)) }
  ftpProfiles(): FtpProfile[] { return structuredClone(this.state.ftpProfiles) }
  ftpProfile(id: string): FtpProfile | undefined { return structuredClone(this.state.ftpProfiles.find(profile => profile.id === id)) }
  remoteProjects(profileId?: string): RemoteProject[] { return structuredClone(profileId === undefined ? this.state.remoteProjects : this.state.remoteProjects.filter(project => project.profileId === profileId)) }
  remoteProject(id: string): RemoteProject | undefined { return structuredClone(this.state.remoteProjects.find(project => project.id === id)) }
  credentialEntries(): CredentialEntry[] { return structuredClone(this.state.credentialEntries) }
  credentialEntry(id: string): CredentialEntry | undefined { return structuredClone(this.state.credentialEntries.find(entry => entry.id === id)) }
  proxyEntries(): ProxyEntry[] { return structuredClone(this.state.proxyEntries) }
  proxyEntry(id: string): ProxyEntry | undefined { return structuredClone(this.state.proxyEntries.find(entry => entry.id === id)) }
  forwards(): ForwardRule[] { return structuredClone(this.state.forwardRules) }
  forward(id: string): ForwardRule | undefined { return structuredClone(this.state.forwardRules.find(rule => rule.id === id)) }
  injection(sessionId: string): SessionInjection | undefined { return structuredClone(this.state.injections.find(item => item.sessionId === sessionId)) }
  settings(): SshSettings { return structuredClone(this.state.settings) }

  /** Copy durable access from a parent conversation into a newly forked conversation. */
  async inheritInjection(parentSessionId: string, childSessionId: string): Promise<boolean> {
    if (parentSessionId === childSessionId || this.injection(childSessionId) !== undefined || this.injection(parentSessionId) === undefined) return false
    let inherited = false
    await this.update(state => {
      if (state.injections.some(item => item.sessionId === childSessionId)) return
      const parent = state.injections.find(item => item.sessionId === parentSessionId)
      if (parent === undefined) return
      state.injections.push({ ...structuredClone(parent), sessionId: childSessionId, updatedAt: Date.now() })
      inherited = true
    })
    return inherited
  }

  subscribe(listener: (previous: SshState, next: SshState) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  update(mutator: (draft: SshState) => void): Promise<SshState> {
    const operation = this.queue.then(async () => {
      const previous = this.snapshot()
      const draft = structuredClone(this.state)
      mutator(draft)
      validateReferences(draft)
      await this.persist(draft)
      this.state = draft
      const next = this.snapshot()
      for (const listener of this.listeners) {
        try { listener(previous, next) } catch { /* State is already durable; observers must not roll back updates. */ }
      }
      return next
    })
    this.queue = operation.catch(() => {})
    return operation
  }

  private async persist(state: SshState): Promise<void> {
    const directory = dirname(this.path)
    const temporary = tx`${this.path}.${process.pid}.${randomBytes(5).toString('hex')}.tmp`
    const handle = await open(temporary, 'w', 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await rename(temporary, this.path)
    } catch (error) {
      if (process.platform !== 'win32') throw error
      await rm(this.path, { force: true })
      await rename(temporary, this.path)
    } finally {
      await rm(temporary, { force: true }).catch(() => {})
    }
    if (process.platform !== 'win32') {
      const directoryHandle = await open(directory, 'r')
      try { await directoryHandle.sync() } finally { await directoryHandle.close() }
    }
  }
}

function parseState(value: unknown, defaults: SshSettings): SshState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('dsh-ssh state must be an object')
  const state = value as Omit<Partial<SshState>, 'schemaVersion'> & { schemaVersion?: unknown }
  if (state.schemaVersion !== 1 && state.schemaVersion !== 2 && state.schemaVersion !== 3 && state.schemaVersion !== 4 && state.schemaVersion !== 5) throw new Error(`unsupported dsh-ssh state version ${String(state.schemaVersion)}`)
  return {
    schemaVersion: 5,
    profiles: Array.isArray(state.profiles) ? state.profiles.map(normalizeStoredProfile) : [],
    ftpProfiles: Array.isArray(state.ftpProfiles) ? state.ftpProfiles.map(normalizeStoredFtpProfile).filter((profile): profile is FtpProfile => profile !== undefined) : [],
    remoteProjects: Array.isArray(state.remoteProjects) ? state.remoteProjects.filter(isStoredRemoteProject) : [],
    credentialEntries: Array.isArray(state.credentialEntries) ? state.credentialEntries : [],
    proxyEntries: Array.isArray(state.proxyEntries) ? state.proxyEntries : [],
    forwardRules: Array.isArray(state.forwardRules) ? state.forwardRules : [],
    injections: Array.isArray(state.injections) ? state.injections.map(injection => ({
      ...injection,
      fileEndpointIds: normalizeFileEndpointIds(injection),
      filePermission: normalizeFilePermission(injection),
      requireFileApproval: normalizeRequireFileApproval(injection),
      workingDirectories: normalizeWorkingDirectories(injection),
      workingProjectIds: normalizeWorkingProjectIds(injection),
    })) : [],
    settings: typeof state.settings === 'object' && state.settings !== null ? { ...defaults, ...state.settings } : defaults,
  }
}

function validateReferences(state: SshState): void {
  const ids = new Set(state.profiles.map(profile => profile.id))
  const ftpIds = new Set(state.ftpProfiles.map(profile => profile.id))
  const credentialIds = new Set(state.credentialEntries.map(entry => entry.id))
  const proxyIds = new Set(state.proxyEntries.map(entry => entry.id))
  if (ids.size !== state.profiles.length) throw new Error('duplicate SSH profile id')
  if (ftpIds.size !== state.ftpProfiles.length) throw new Error('duplicate FTP profile id')
  if (credentialIds.size !== state.credentialEntries.length) throw new Error('duplicate SSH credential entry id')
  if (proxyIds.size !== state.proxyEntries.length) throw new Error('duplicate SSH proxy entry id')
  for (const profile of state.profiles) {
    if (profile.credentialId !== undefined && !credentialIds.has(profile.credentialId)) throw Object.assign(new Error('SSH profile references a missing credential entry'), { status: 400 })
    if (profile.proxy.type === 'saved' && !proxyIds.has(profile.proxy.proxyId)) throw Object.assign(new Error('SSH profile references a missing proxy entry'), { status: 400 })
    if (profile.proxy.type === 'jump' && (profile.proxy.profileIds.length === 0 || profile.proxy.profileIds.some(id => !ids.has(id) || id === profile.id) || new Set(profile.proxy.profileIds).size !== profile.proxy.profileIds.length)) {
      throw Object.assign(new Error('jump proxy chain must reference unique existing profiles other than itself'), { status: 400 })
    }
  }
  for (const profile of state.ftpProfiles) {
    if (profile.credentialId !== undefined) {
      const credential = state.credentialEntries.find(entry => entry.id === profile.credentialId)
      if (credential === undefined || credential.authType !== 'password') throw Object.assign(new Error('FTP profile requires an existing password credential entry'), { status: 400 })
    }
    if (profile.proxy.type === 'saved' && !proxyIds.has(profile.proxy.proxyId)) throw Object.assign(new Error('FTP profile references a missing proxy entry'), { status: 400 })
  }
  for (const rule of state.forwardRules) if (!ids.has(rule.profileId)) throw new Error(`forward rule references missing profile ${rule.profileId}`)
  const projectIds = new Set(state.remoteProjects.map(project => project.id))
  const projects = new Map(state.remoteProjects.map(project => [project.id, project]))
  if (projectIds.size !== state.remoteProjects.length) throw new Error('duplicate remote project id')
  for (const project of state.remoteProjects) if (!ids.has(project.profileId)) throw new Error(`remote project references missing profile ${project.profileId}`)
  for (const injection of state.injections) {
    injection.profileIds = [...new Set(injection.profileIds.filter(id => ids.has(id)))]
    injection.workingDirectories = Object.fromEntries(Object.entries(injection.workingDirectories).filter(([profileId]) => injection.profileIds.includes(profileId)))
    injection.workingProjectIds = Object.fromEntries(Object.entries(injection.workingProjectIds ?? {}).filter(([profileId, projectId]) => {
      const project = projects.get(projectId)
      return injection.profileIds.includes(profileId) && project?.profileId === profileId
    }))
    injection.fileEndpointIds = [...new Set((injection.fileEndpointIds ?? []).filter(endpointId => {
      const [kind, id] = endpointId.split(':', 2)
      return kind === 'sftp' ? ids.has(id ?? '') : kind === 'ftp' && ftpIds.has(id ?? '')
    }))]
  }
}

function isStoredFtpProfile(value: unknown): value is FtpProfile {
  if (typeof value !== 'object' || value === null) return false
  const profile = value as Partial<FtpProfile>
  const proxy = profile.proxy
  return typeof profile.id === 'string' && typeof profile.name === 'string' &&
    (profile.protocol === 'ftp' || profile.protocol === 'ftps-explicit' || profile.protocol === 'ftps-implicit') &&
    typeof profile.host === 'string' && Number.isInteger(profile.port) && profile.port! >= 1 && profile.port! <= 65_535 && typeof profile.username === 'string' &&
    typeof profile.initialPath === 'string' && Number.isInteger(profile.connectTimeoutMs) && profile.connectTimeoutMs! >= 1000 && profile.connectTimeoutMs! <= 120_000 &&
    typeof profile.createdAt === 'number' && typeof profile.updatedAt === 'number' &&
    typeof proxy === 'object' && proxy !== null && (proxy.type === 'none' || proxy.type === 'saved' && typeof proxy.proxyId === 'string')
}

function normalizeStoredFtpProfile(value: unknown): FtpProfile | undefined {
  if (!isStoredFtpProfile(value)) return undefined
  const rawTags = (value as { tags?: unknown }).tags
  const tags = Array.isArray(rawTags) ? rawTags.filter((tag): tag is string => typeof tag === 'string') : []
  const uniqueTags = new Map<string, string>()
  for (const rawTag of tags) {
    const tag = rawTag.trim()
    if (tag.length < 1 || tag.length > 32 || uniqueTags.size >= 20) continue
    const key = tag.toLocaleLowerCase('zh-CN')
    if (!uniqueTags.has(key)) uniqueTags.set(key, tag)
  }
  return { ...value, tags: [...uniqueTags.values()] }
}

function isStoredRemoteProject(value: unknown): value is RemoteProject {
  if (typeof value !== 'object' || value === null) return false
  const project = value as Partial<RemoteProject>
  return typeof project.id === 'string' && typeof project.profileId === 'string' && typeof project.name === 'string' && typeof project.path === 'string' && typeof project.createdAt === 'number' && typeof project.updatedAt === 'number'
}

function normalizeStoredProfile(profile: SshProfile): SshProfile {
  const proxy = profile.proxy as SshProfile['proxy'] & { profileId?: unknown; profileIds?: unknown }
  if (proxy.type !== 'jump') return profile
  const profileIds = Array.isArray(proxy.profileIds)
    ? proxy.profileIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : typeof proxy.profileId === 'string' && proxy.profileId.length > 0 ? [proxy.profileId] : []
  return { ...profile, proxy: { type: 'jump', profileIds: [...new Set(profileIds)] } }
}

function normalizeWorkingDirectories(injection: unknown): Record<string, string> {
  if (typeof injection !== 'object' || injection === null) return {}
  const value = (injection as { workingDirectories?: unknown }).workingDirectories
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => {
    const [profileId, cwd] = entry
    return profileId.length > 0 && profileId.length <= 100 && typeof cwd === 'string' && cwd.trim().length > 0 && cwd.length <= 4096 && !/[\0\r\n]/.test(cwd)
  }).map(([profileId, cwd]) => [profileId, cwd.trim()]))
}

function normalizeWorkingProjectIds(injection: unknown): Record<string, string> {
  if (typeof injection !== 'object' || injection === null) return {}
  const value = (injection as { workingProjectIds?: unknown }).workingProjectIds
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => {
    const [profileId, projectId] = entry
    return profileId.length > 0 && profileId.length <= 100 && typeof projectId === 'string' && projectId.length > 0 && projectId.length <= 100
  }))
}

function normalizeFileEndpointIds(injection: unknown): string[] {
  if (typeof injection !== 'object' || injection === null) return []
  const value = (injection as { fileEndpointIds?: unknown }).fileEndpointIds
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && /^(?:sftp|ftp):[^:\s]{1,100}$/.test(id)))]
}

function normalizeFilePermission(injection: unknown): SessionInjection['filePermission'] {
  return typeof injection === 'object' && injection !== null && (injection as { filePermission?: unknown }).filePermission === 'transfer' ? 'transfer' : 'browse'
}

function normalizeRequireFileApproval(injection: unknown): boolean {
  return !(typeof injection === 'object' && injection !== null && (injection as { requireFileApproval?: unknown }).requireFileApproval === false)
}

async function fileExists(path: string): Promise<boolean> {
  try { await readFile(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}
