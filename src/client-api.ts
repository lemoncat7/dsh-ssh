export const SSH_API = '/ssh-local/v1'

export interface CredentialView { configured: boolean; writable: boolean; fields: string[]; source: 'profile' | 'vault'; entryId?: string; entryName?: string }
export interface ProfileView {
  id: string; name: string; host: string; port: number; username: string
  group?: string
  authType: 'password' | 'private-key' | 'agent'; hostFingerprint?: string
  credentialId?: string
  proxy: { type: 'none' } | { type: 'http' | 'socks5'; host: string; port: number; username?: string } | { type: 'jump'; profileIds: string[] }
  keepAliveIntervalMs: number; connectTimeoutMs: number; terminalType: string; tags: string[]
  credential: CredentialView
}
export interface VaultEntryView {
  id: string; name: string; username: string; authType: 'password' | 'private-key'; createdAt: number; updatedAt: number; references: number
  credential: { configured: boolean; writable: boolean; fields: string[] }
}
export interface ForwardView {
  id: string; profileId: string; name: string; kind: 'local' | 'remote' | 'dynamic'
  bindHost: string; bindPort: number; targetHost?: string; targetPort?: number; autoStart: boolean
}
export interface ForwardStatus { ruleId: string; state: 'stopped' | 'starting' | 'running' | 'error'; bindHost: string; bindPort: number; connections: number; error?: string }
export interface InjectionView { sessionId: string; profileIds: string[]; permission: 'exec' | 'terminal'; requireCommandApproval: boolean; workingDirectories: Record<string, string>; updatedAt: number }
export interface SettingsView { allowPublicBind: boolean; defaultCommandTimeoutMs: number; maxOutputChars: number }
export interface ActivityProfileView { id: string; name: string; host: string; port: number; username: string; cwd: string }
export interface ActivityCommandView { id: string; command: string; submitted: boolean; startedAt: number; completedAt: number; output: string; waitReason: string; truncated: boolean }
export interface ActivityTerminalView {
  terminalId: string; profileId: string; name: string; cwd: string; createdAt: number
  status: { kind: 'running' } | { kind: 'exited'; exitCode: number | null; signal: string | null }
  scrollback: string; commands: ActivityCommandView[]
}
export interface ActivityView { injection: InjectionView | null; profiles: ActivityProfileView[]; terminals: ActivityTerminalView[] }
export interface SftpEntryView { name: string; path: string; kind: 'directory' | 'file' | 'symlink' | 'other'; size: number; modifiedAt: number }
export interface SftpDirectoryView { path: string; parent: string | null; entries: SftpEntryView[] }
export interface SftpFilePreviewView { path: string; name: string; size: number; mimeType: string; kind: 'text' | 'image' | 'pdf' | 'binary'; text?: string; truncated?: boolean }

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly body?: Record<string, unknown>) { super(message); this.name = 'ApiError' }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? 'GET'
  const response = await fetch(`${SSH_API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-DSH-SSH-Request': '1' },
      ...init.headers,
    },
  })
  if (response.status === 204) return undefined as T
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) throw new ApiError(response.status, typeof body.error === 'string' ? body.error : `HTTP ${response.status}`, body)
  return body as T
}

export function loadProfiles(): Promise<ProfileView[]> { return api('/profiles') }
export function loadVaultEntries(): Promise<VaultEntryView[]> { return api('/vault') }
export function loadForwards(): Promise<{ rules: ForwardView[]; statuses: ForwardStatus[] }> { return api('/forwards') }
export function loadInjection(sessionId: string): Promise<InjectionView | null> { return api(`/injections?sessionId=${encodeURIComponent(sessionId)}`) }
export function loadActivity(sessionId: string): Promise<ActivityView> { return api(`/activity?sessionId=${encodeURIComponent(sessionId)}`) }
export function loadSftpDirectory(sessionId: string, profileId: string, path?: string): Promise<SftpDirectoryView> {
  const query = new URLSearchParams({ sessionId, profileId })
  if (path !== undefined) query.set('path', path)
  return api(`/activity/files?${query.toString()}`)
}
export function loadSftpFilePreview(sessionId: string, profileId: string, path: string): Promise<SftpFilePreviewView> {
  const query = new URLSearchParams({ sessionId, profileId, path })
  return api(`/activity/file?${query.toString()}`)
}
export function sftpFileUrl(sessionId: string, profileId: string, path: string, inline = false): string {
  const query = new URLSearchParams({ sessionId, profileId, path })
  if (inline) query.set('inline', '1')
  return `${SSH_API}/activity/download?${query.toString()}`
}
export function sendActivityTerminalInput(sessionId: string, terminalId: string, text: string): Promise<void> {
  return api(`/activity/terminals/${encodeURIComponent(terminalId)}/input`, { method: 'POST', body: JSON.stringify({ sessionId, text }) })
}
export function resizeActivityTerminal(sessionId: string, terminalId: string, cols: number, rows: number): Promise<void> {
  return api(`/activity/terminals/${encodeURIComponent(terminalId)}/resize`, { method: 'POST', body: JSON.stringify({ sessionId, cols, rows }) })
}
export function updateActivityDirectory(sessionId: string, profileId: string, cwd: string): Promise<{ cwd: string }> {
  return api('/activity/directory', { method: 'PUT', body: JSON.stringify({ sessionId, profileId, cwd }) })
}

export function profileAddress(profile: ProfileView): string { return `${profile.username}@${profile.host}:${profile.port}` }
