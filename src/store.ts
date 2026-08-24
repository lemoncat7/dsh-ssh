import { randomBytes } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { CredentialEntry, ForwardRule, ProxyEntry, SessionInjection, SshProfile, SshSettings, SshState } from './domain.js'

export class SshStore {
  private state: SshState
  private queue: Promise<unknown> = Promise.resolve()

  private constructor(private readonly path: string, initial: SshState) {
    this.state = initial
  }

  static async open(path: string, defaults: SshSettings): Promise<SshStore> {
    await mkdir(dirname(path), { recursive: true })
    let initial: SshState = { schemaVersion: 2, profiles: [], credentialEntries: [], proxyEntries: [], forwardRules: [], injections: [], settings: defaults }
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
  credentialEntries(): CredentialEntry[] { return structuredClone(this.state.credentialEntries) }
  credentialEntry(id: string): CredentialEntry | undefined { return structuredClone(this.state.credentialEntries.find(entry => entry.id === id)) }
  proxyEntries(): ProxyEntry[] { return structuredClone(this.state.proxyEntries) }
  proxyEntry(id: string): ProxyEntry | undefined { return structuredClone(this.state.proxyEntries.find(entry => entry.id === id)) }
  forwards(): ForwardRule[] { return structuredClone(this.state.forwardRules) }
  forward(id: string): ForwardRule | undefined { return structuredClone(this.state.forwardRules.find(rule => rule.id === id)) }
  injection(sessionId: string): SessionInjection | undefined { return structuredClone(this.state.injections.find(item => item.sessionId === sessionId)) }
  settings(): SshSettings { return structuredClone(this.state.settings) }

  update(mutator: (draft: SshState) => void): Promise<SshState> {
    const operation = this.queue.then(async () => {
      const draft = structuredClone(this.state)
      mutator(draft)
      validateReferences(draft)
      await this.persist(draft)
      this.state = draft
      return this.snapshot()
    })
    this.queue = operation.catch(() => {})
    return operation
  }

  private async persist(state: SshState): Promise<void> {
    const directory = dirname(this.path)
    const temporary = `${this.path}.${process.pid}.${randomBytes(5).toString('hex')}.tmp`
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
  if (state.schemaVersion !== 1 && state.schemaVersion !== 2) throw new Error(`unsupported dsh-ssh state version ${String(state.schemaVersion)}`)
  return {
    schemaVersion: 2,
    profiles: Array.isArray(state.profiles) ? state.profiles.map(normalizeStoredProfile) : [],
    credentialEntries: Array.isArray(state.credentialEntries) ? state.credentialEntries : [],
    proxyEntries: Array.isArray(state.proxyEntries) ? state.proxyEntries : [],
    forwardRules: Array.isArray(state.forwardRules) ? state.forwardRules : [],
    injections: Array.isArray(state.injections) ? state.injections.map(injection => ({
      ...injection,
      workingDirectories: normalizeWorkingDirectories(injection),
    })) : [],
    settings: typeof state.settings === 'object' && state.settings !== null ? { ...defaults, ...state.settings } : defaults,
  }
}

function validateReferences(state: SshState): void {
  const ids = new Set(state.profiles.map(profile => profile.id))
  const credentialIds = new Set(state.credentialEntries.map(entry => entry.id))
  const proxyIds = new Set(state.proxyEntries.map(entry => entry.id))
  if (ids.size !== state.profiles.length) throw new Error('duplicate SSH profile id')
  if (credentialIds.size !== state.credentialEntries.length) throw new Error('duplicate SSH credential entry id')
  if (proxyIds.size !== state.proxyEntries.length) throw new Error('duplicate SSH proxy entry id')
  for (const profile of state.profiles) {
    if (profile.credentialId !== undefined && !credentialIds.has(profile.credentialId)) throw Object.assign(new Error('SSH profile references a missing credential entry'), { status: 400 })
    if (profile.proxy.type === 'saved' && !proxyIds.has(profile.proxy.proxyId)) throw Object.assign(new Error('SSH profile references a missing proxy entry'), { status: 400 })
    if (profile.proxy.type === 'jump' && (profile.proxy.profileIds.length === 0 || profile.proxy.profileIds.some(id => !ids.has(id) || id === profile.id) || new Set(profile.proxy.profileIds).size !== profile.proxy.profileIds.length)) {
      throw Object.assign(new Error('jump proxy chain must reference unique existing profiles other than itself'), { status: 400 })
    }
  }
  for (const rule of state.forwardRules) if (!ids.has(rule.profileId)) throw new Error(`forward rule references missing profile ${rule.profileId}`)
  for (const injection of state.injections) {
    injection.profileIds = [...new Set(injection.profileIds.filter(id => ids.has(id)))]
    injection.workingDirectories = Object.fromEntries(Object.entries(injection.workingDirectories).filter(([profileId]) => injection.profileIds.includes(profileId)))
  }
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

async function fileExists(path: string): Promise<boolean> {
  try { await readFile(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}
