export type SshAuthType = 'password' | 'private-key' | 'agent'
export type ProxyConfig =
  | { type: 'none' }
  | { type: 'http'; host: string; port: number; username?: string }
  | { type: 'socks5'; host: string; port: number; username?: string }
  | { type: 'saved'; proxyId: string }
  | { type: 'jump'; profileIds: string[] }

export interface SshProfile {
  id: string
  name: string
  group?: string
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

export interface ProxyEntry {
  id: string
  name: string
  proxyType: 'http' | 'socks5'
  host: string
  port: number
  username?: string
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
  fileEndpointIds: string[]
  filePermission: 'browse' | 'transfer'
  requireFileApproval: boolean
  permission: 'exec' | 'terminal'
  requireCommandApproval: boolean
  workingDirectories: Record<string, string>
  workingProjectIds: Record<string, string>
  updatedAt: number
}

export type FtpProtocol = 'ftp' | 'ftps-explicit' | 'ftps-implicit'
export type FtpProxyConfig = { type: 'none' } | { type: 'saved'; proxyId: string }

export interface FtpProfile {
  id: string
  name: string
  group?: string
  protocol: FtpProtocol
  host: string
  port: number
  username: string
  credentialId?: string
  proxy: FtpProxyConfig
  initialPath: string
  connectTimeoutMs: number
  tlsServerName?: string
  createdAt: number
  updatedAt: number
}

export interface FtpProfileDraft {
  name: string
  group?: string
  protocol: FtpProtocol
  host: string
  port?: number
  username: string
  credentialId?: string
  proxy?: FtpProxyConfig
  initialPath?: string
  connectTimeoutMs?: number
  tlsServerName?: string
}

/** A reusable remote project root attached to one SSH profile. */
export interface RemoteProject {
  id: string
  profileId: string
  name: string
  path: string
  createdAt: number
  updatedAt: number
}

export interface SshSettings {
  allowPublicBind: boolean
  defaultCommandTimeoutMs: number
  maxOutputChars: number
}

export interface SshState {
  schemaVersion: 5
  profiles: SshProfile[]
  ftpProfiles: FtpProfile[]
  remoteProjects: RemoteProject[]
  credentialEntries: CredentialEntry[]
  proxyEntries: ProxyEntry[]
  forwardRules: ForwardRule[]
  injections: SessionInjection[]
  settings: SshSettings
}

export function normalizeFtpProfileDraft(value: unknown): FtpProfileDraft {
  const input = record(value, 'FTP profile')
  const protocol = input.protocol
  if (protocol !== 'ftp' && protocol !== 'ftps-explicit' && protocol !== 'ftps-implicit') {
    throw bad('protocol must be ftp, ftps-explicit, or ftps-implicit')
  }
  const proxy = normalizeFtpProxy(input.proxy)
  const defaultPort = protocol === 'ftps-implicit' ? 990 : 21
  return {
    name: text(input.name, 'name', 1, 80),
    ...optionalText(input.group, 'group', 1, 64),
    protocol,
    host: text(input.host, 'host', 1, 253),
    port: integer(input.port ?? defaultPort, 'port', 1, 65_535),
    username: text(input.username, 'username', 1, 128),
    ...optionalText(input.credentialId, 'credentialId', 1, 100),
    proxy,
    initialPath: remotePath(input.initialPath ?? '/', 'initialPath'),
    connectTimeoutMs: integer(input.connectTimeoutMs ?? 15_000, 'connectTimeoutMs', 1000, 120_000),
    ...optionalText(input.tlsServerName, 'tlsServerName', 1, 253),
  }
}

export interface RemoteProjectDraft {
  name: string
  path: string
}

export interface ProfileDraft {
  name: string
  group?: string
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

export interface ProxyEntryDraft {
  name: string
  proxyType: 'http' | 'socks5'
  host: string
  port: number
  username?: string
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
    ...optionalText(input.group, 'group', 1, 64),
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

export function normalizeProxyEntryDraft(value: unknown): ProxyEntryDraft {
  const input = record(value, 'proxy entry')
  if (input.proxyType !== 'http' && input.proxyType !== 'socks5') throw bad('proxyType must be http or socks5')
  return {
    name: text(input.name, 'name', 1, 80),
    proxyType: input.proxyType,
    host: text(input.host, 'host', 1, 253),
    port: integer(input.port, 'port', 1, 65_535),
    ...optionalText(input.username, 'username', 1, 128),
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

export function normalizeRemoteProjectDraft(value: unknown): RemoteProjectDraft {
  const input = record(value, 'remote project')
  return {
    name: text(input.name, 'name', 1, 80),
    path: remotePath(input.path, 'path'),
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
  if (input.type === 'saved') return { type: 'saved', proxyId: text(input.proxyId, 'proxy.proxyId', 1, 100) }
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
  throw bad('proxy.type must be none, saved, http, socks5, or jump')
}

function normalizeFtpProxy(value: unknown): FtpProxyConfig {
  if (value === undefined || value === null) return { type: 'none' }
  const input = record(value, 'FTP proxy')
  if (input.type === 'none') return { type: 'none' }
  if (input.type === 'saved') return { type: 'saved', proxyId: text(input.proxyId, 'proxy.proxyId', 1, 100) }
  throw bad('FTP proxy.type must be none or saved')
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

function remotePath(value: unknown, label: string): string {
  if (typeof value !== 'string') throw bad(`${label} must be a string`)
  const result = value.trim()
  if (result.length < 1 || result.length > 4096 || /[\0\r\n]/.test(result)) throw bad(`${label} is invalid`)
  return result
}

function bad(message: string): Error {
  return Object.assign(new Error(message), { status: 400 })
}
