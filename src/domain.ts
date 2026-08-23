export type SshAuthType = 'password' | 'private-key' | 'agent'
export type ProxyConfig =
  | { type: 'none' }
  | { type: 'http'; host: string; port: number; username?: string }
  | { type: 'socks5'; host: string; port: number; username?: string }
  | { type: 'jump'; profileIds: string[] }

export interface SshProfile {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: SshAuthType
  credentialId?: string
  hostFingerprint?: string
  proxy: ProxyConfig
  keepAliveIntervalMs: number
  connectTimeoutMs: number
  terminalType: string
  tags: string[]
  createdAt: number
  updatedAt: number
}

export interface CredentialEntry {
  id: string
  name: string
  username: string
  authType: Exclude<SshAuthType, 'agent'>
  createdAt: number
  updatedAt: number
}

export interface SshCredentialPayload {
  password?: string
  privateKey?: string
  passphrase?: string
  proxyPassword?: string
}

export type ForwardKind = 'local' | 'remote' | 'dynamic'

export interface ForwardRule {
  id: string
  profileId: string
  name: string
  kind: ForwardKind
  bindHost: string
  bindPort: number
  targetHost?: string
  targetPort?: number
  autoStart: boolean
  createdAt: number
  updatedAt: number
}

export interface SessionInjection {
  sessionId: string
  profileIds: string[]
  permission: 'exec' | 'terminal'
  requireCommandApproval: boolean
  workingDirectories: Record<string, string>
  updatedAt: number
}

export interface SshSettings {
  allowPublicBind: boolean
  defaultCommandTimeoutMs: number
  maxOutputChars: number
}

export interface SshState {
  schemaVersion: 1
  profiles: SshProfile[]
  credentialEntries: CredentialEntry[]
  forwardRules: ForwardRule[]
  injections: SessionInjection[]
  settings: SshSettings
}

export interface ProfileDraft {
  name: string
  host: string
  port?: number
  username: string
  authType: SshAuthType
  credentialId?: string
  hostFingerprint?: string
  proxy?: ProxyConfig
  keepAliveIntervalMs?: number
  connectTimeoutMs?: number
  terminalType?: string
  tags?: string[]
}

export interface CredentialEntryDraft {
  name: string
  username: string
  authType: Exclude<SshAuthType, 'agent'>
}

export interface ForwardDraft {
  profileId: string
  name: string
  kind: ForwardKind
  bindHost?: string
  bindPort: number
  targetHost?: string
  targetPort?: number
  autoStart?: boolean
}

export function normalizeProfileDraft(value: unknown): ProfileDraft {
  const input = record(value, 'profile')
  const authType = input.authType
  if (authType !== 'password' && authType !== 'private-key' && authType !== 'agent') throw bad('authType must be password, private-key, or agent')
  const proxy = normalizeProxy(input.proxy)
  return {
    name: text(input.name, 'name', 1, 80),
    host: text(input.host, 'host', 1, 253),
    port: integer(input.port ?? 22, 'port', 1, 65_535),
    username: text(input.username, 'username', 1, 128),
    authType,
    ...optionalText(input.credentialId, 'credentialId', 1, 100),
    ...optionalText(input.hostFingerprint, 'hostFingerprint', 8, 256),
    proxy,
    keepAliveIntervalMs: integer(input.keepAliveIntervalMs ?? 15_000, 'keepAliveIntervalMs', 0, 120_000),
    connectTimeoutMs: integer(input.connectTimeoutMs ?? 15_000, 'connectTimeoutMs', 1000, 120_000),
    terminalType: text(input.terminalType ?? 'xterm-256color', 'terminalType', 1, 64),
    tags: stringArray(input.tags, 'tags', 20, 32),
  }
}

export function normalizeCredentialEntryDraft(value: unknown): CredentialEntryDraft {
  const input = record(value, 'credential entry')
  if (input.authType !== 'password' && input.authType !== 'private-key') throw bad('credential authType must be password or private-key')
  return {
    name: text(input.name, 'name', 1, 80),
    username: text(input.username, 'username', 1, 128),
    authType: input.authType,
  }
}

export function normalizeForwardDraft(value: unknown): ForwardDraft {
  const input = record(value, 'forward rule')
  const kind = input.kind
  if (kind !== 'local' && kind !== 'remote' && kind !== 'dynamic') throw bad('kind must be local, remote, or dynamic')
  const targetRequired = kind !== 'dynamic'
  return {
    profileId: text(input.profileId, 'profileId', 1, 100),
    name: text(input.name, 'name', 1, 80),
    kind,
    bindHost: text(input.bindHost ?? (kind === 'remote' ? '127.0.0.1' : '127.0.0.1'), 'bindHost', 1, 253),
    bindPort: integer(input.bindPort, 'bindPort', 0, 65_535),
    ...targetRequired ? {
      targetHost: text(input.targetHost, 'targetHost', 1, 253),
      targetPort: integer(input.targetPort, 'targetPort', 1, 65_535),
    } : {},
    autoStart: input.autoStart === true,
  }
}

export function normalizeSecrets(value: unknown): SshCredentialPayload {
  const input = value === undefined ? {} : record(value, 'secrets')
  const password = secret(input.password, 'password')
  const privateKey = secret(input.privateKey, 'privateKey', 512_000)
  const passphrase = secret(input.passphrase, 'passphrase')
  const proxyPassword = secret(input.proxyPassword, 'proxyPassword')
  return compactSecrets({
    ...(password === undefined ? {} : { password }),
    ...(privateKey === undefined ? {} : { privateKey }),
    ...(passphrase === undefined ? {} : { passphrase }),
    ...(proxyPassword === undefined ? {} : { proxyPassword }),
  })
}

export function compactSecrets(value: SshCredentialPayload): SshCredentialPayload {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0))
}

export function isLoopbackHost(host: string): boolean {
  const value = host.trim().toLowerCase().replace(/^\[|\]$/g, '')
  return value === 'localhost' || value === '::1' || value.startsWith('127.')
}

function normalizeProxy(value: unknown): ProxyConfig {
  if (value === undefined || value === null) return { type: 'none' }
  const input = record(value, 'proxy')
  if (input.type === 'none') return { type: 'none' }
  if (input.type === 'jump') {
    const profileIds = input.profileIds === undefined
      ? [text(input.profileId, 'proxy.profileId', 1, 100)]
      : stringArray(input.profileIds, 'proxy.profileIds', 8, 100)
    if (profileIds.length === 0) throw bad('proxy.profileIds must contain at least one jump host')
    return { type: 'jump', profileIds }
  }
  if (input.type === 'http' || input.type === 'socks5') {
    return {
      type: input.type,
      host: text(input.host, 'proxy.host', 1, 253),
      port: integer(input.port, 'proxy.port', 1, 65_535),
      ...optionalText(input.username, 'proxy.username', 1, 128),
    }
  }
  throw bad('proxy.type must be none, http, socks5, or jump')
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw bad(`${label} must be an object`)
  return value as Record<string, unknown>
}

function text(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== 'string') throw bad(`${label} must be a string`)
  const result = value.trim()
  if (result.length < min || result.length > max) throw bad(`${label} must contain ${min}-${max} characters`)
  return result
}

function optionalText(value: unknown, label: string, min: number, max: number): { [key: string]: string } {
  if (value === undefined || value === null || value === '') return {}
  return { [label.split('.').at(-1) ?? label]: text(value, label, min, max) }
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw bad(`${label} must be an integer between ${min} and ${max}`)
  return value
}

function stringArray(value: unknown, label: string, maxItems: number, maxLength: number): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maxItems) throw bad(`${label} must be an array with at most ${maxItems} items`)
  return [...new Set(value.map((item, index) => text(item, `${label}[${index}]`, 1, maxLength)))]
}

function secret(value: unknown, label: string, max = 65_536): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length > max) throw bad(`${label} is invalid`)
  return value
}

function bad(message: string): Error {
  return Object.assign(new Error(message), { status: 400 })
}
