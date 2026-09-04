import { randomBytes } from 'node:crypto'

const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'

export interface GitHubDeviceFlowStart {
  id: string
  userCode: string
  verificationUri: string
  expiresAt: number
  retryAfterMs: number
}

export type GitHubDeviceFlowStatus =
  | { state: 'pending'; retryAfterMs: number }
  | { state: 'complete'; login: string }

interface PendingFlow {
  id: string
  clientId: string
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresAt: number
  intervalMs: number
  nextPollAt: number
}

export class GitHubDeviceAuthService {
  private readonly pending = new Map<string, PendingFlow>()

  constructor(
    private readonly clientId: () => string | undefined,
    private readonly authorize: (token: string) => Promise<{ login: string }>,
    private readonly request: typeof fetch = fetch,
  ) {}

  async start(): Promise<GitHubDeviceFlowStart> {
    this.prune()
    const now = Date.now()
    const existing = this.pending.values().next().value as PendingFlow | undefined
    if (existing !== undefined) return this.startView(existing, now)
    const clientId = normalizeClientId(this.clientId())
    const value = await this.form(DEVICE_CODE_URL, { client_id: clientId, scope: 'gist' })
    const deviceCode = requiredText(value.device_code, 'GitHub device_code', 20, 512)
    const userCode = requiredText(value.user_code, 'GitHub user_code', 4, 32)
    const verificationUri = trustedVerificationUri(value.verification_uri)
    const expiresIn = boundedInteger(value.expires_in, 'GitHub expires_in', 60, 1_800)
    const intervalMs = boundedInteger(value.interval ?? 5, 'GitHub interval', 1, 60) * 1_000
    const flow: PendingFlow = {
      id: randomBytes(18).toString('hex'), clientId, deviceCode, userCode, verificationUri,
      expiresAt: now + expiresIn * 1_000, intervalMs, nextPollAt: now,
    }
    this.pending.set(flow.id, flow)
    return this.startView(flow, now)
  }

  async poll(id: string): Promise<GitHubDeviceFlowStatus> {
    const flow = this.pending.get(normalizeFlowId(id))
    if (flow === undefined) throw new Error('GitHub 授权已失效，请重新连接')
    const now = Date.now()
    if (now >= flow.expiresAt) {
      this.pending.delete(flow.id)
      throw new Error('GitHub 授权已过期，请重新连接')
    }
    if (now < flow.nextPollAt) return { state: 'pending', retryAfterMs: flow.nextPollAt - now }
    flow.nextPollAt = now + flow.intervalMs
    const value = await this.form(ACCESS_TOKEN_URL, {
      client_id: flow.clientId,
      device_code: flow.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    })
    if (typeof value.access_token === 'string') {
      const token = requiredText(value.access_token, 'GitHub access_token', 20, 512)
      this.pending.delete(flow.id)
      const identity = await this.authorize(token)
      return { state: 'complete', login: identity.login }
    }
    const error = typeof value.error === 'string' ? value.error : 'unknown_error'
    if (error === 'authorization_pending') return { state: 'pending', retryAfterMs: flow.intervalMs }
    if (error === 'slow_down') {
      flow.intervalMs = Math.min(60_000, flow.intervalMs + 5_000)
      flow.nextPollAt = now + flow.intervalMs
      return { state: 'pending', retryAfterMs: flow.intervalMs }
    }
    this.pending.delete(flow.id)
    if (error === 'access_denied') throw new Error('GitHub 授权已取消')
    if (error === 'expired_token') throw new Error('GitHub 授权已过期，请重新连接')
    if (error === 'incorrect_client_credentials') throw new Error('GitHub OAuth Client ID 无效')
    throw new Error(`GitHub 授权失败：${error}`)
  }

  close(): void { this.pending.clear() }

  private startView(flow: PendingFlow, now: number): GitHubDeviceFlowStart {
    return {
      id: flow.id, userCode: flow.userCode, verificationUri: flow.verificationUri,
      expiresAt: flow.expiresAt, retryAfterMs: Math.max(0, flow.nextPollAt - now),
    }
  }

  private prune(): void {
    const now = Date.now()
    for (const [id, flow] of this.pending) if (flow.expiresAt <= now) this.pending.delete(id)
  }

  private async form(url: string, fields: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await this.request(url, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'dsh-ssh-github-auth' },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(15_000),
    })
    const value = await response.json().catch(() => undefined) as unknown
    if (!response.ok || typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`GitHub 授权服务请求失败（HTTP ${response.status}）`)
    }
    return value as Record<string, unknown>
  }
}

function normalizeClientId(value: string | undefined): string {
  const clientId = value?.trim()
  if (clientId === undefined || !/^[A-Za-z0-9._-]{10,128}$/.test(clientId)) {
    throw new Error('请先在同步设置中填写有效的 GitHub OAuth Client ID')
  }
  return clientId
}

function normalizeFlowId(value: string): string {
  if (!/^[a-f0-9]{36}$/.test(value)) throw new Error('GitHub 授权标识无效')
  return value
}

function requiredText(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== 'string' || value.length < min || value.length > max) throw new Error(`${label} 格式无效`)
  return value
}

function boundedInteger(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new Error(`${label} 格式无效`)
  return value as number
}

function trustedVerificationUri(value: unknown): string {
  const uri = requiredText(value, 'GitHub verification_uri', 10, 512)
  const parsed = new URL(uri)
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') throw new Error('GitHub 返回了不可信的授权地址')
  return parsed.toString()
}
