import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { pipeline } from 'node:stream/promises'
import { HostKeyRequiredError, SshConnector } from './connector.js'
import { SshCredentialVault } from './credentials.js'
import {
  normalizeCredentialEntryDraft, normalizeForwardDraft, normalizeProfileDraft, normalizeSecrets,
  type CredentialEntry, type ForwardRule, type SessionInjection, type SshProfile,
} from './domain.js'
import { ForwardManager } from './forwards.js'
import { SshStore } from './store.js'
import { setSessionDirectory } from './directory.js'
import { AiTerminalManager, BrowserTerminalManager } from './terminal.js'
import { listSftpDirectory, openSftpFile, readSftpFilePreview } from './sftp.js'

const MAX_BODY_BYTES = 1_048_576

export interface WebServerLike {
  register(route: {
    kind: 'prefix'
    path: string
    handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>
  }): () => void
}

export interface SshApiRuntime {
  store: SshStore
  credentials: SshCredentialVault
  connector: SshConnector
  forwards: ForwardManager
  terminals: BrowserTerminalManager
  aiTerminals: AiTerminalManager
}

export function registerSshApi(webServer: WebServerLike, prefix: string, runtime: SshApiRuntime): () => void {
  return webServer.register({
    kind: 'prefix',
    path: prefix,
    handler: async (req, res) => {
      try {
        assertSameOrigin(req)
        await dispatch(req, res, prefix, runtime)
      } catch (error) {
        sendError(res, error)
      }
    },
  })
}

async function dispatch(req: IncomingMessage, res: ServerResponse, prefix: string, runtime: SshApiRuntime): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://ssh.local')
  const relative = url.pathname.slice(prefix.length).replace(/^\/+|\/+$/g, '')
  const segments = relative ? relative.split('/').map(decodeURIComponent) : []
  const method = req.method ?? 'GET'

  if (method === 'GET' && segments[0] === 'health') return sendJson(res, 200, { ok: true, service: 'dsh-ssh', schemaVersion: 1 })

  if (segments[0] === 'vault') {
    if (method === 'GET' && segments.length === 1) return sendJson(res, 200, await credentialEntryViews(runtime))
    if (method === 'POST' && segments.length === 1) {
      requireMutationHeader(req)
      const body = await readObject(req)
      const draft = normalizeCredentialEntryDraft(body.entry)
      const secrets = normalizeSecrets(body.secrets)
      requireCredentialSecret(draft.authType, secrets)
      const now = Date.now()
      const entry: CredentialEntry = { ...draft, id: createId('credential'), createdAt: now, updatedAt: now }
      await runtime.credentials.replaceEntry(entry.id, secrets)
      try { await runtime.store.update(state => { state.credentialEntries.push(entry) }) }
      catch (error) { await runtime.credentials.deleteEntry(entry.id).catch(() => {}); throw error }
      return sendJson(res, 201, await credentialEntryView(runtime, entry))
    }
    const id = segments[1]
    if (id !== undefined && method === 'PUT' && segments.length === 2) {
      requireMutationHeader(req)
      const previous = requiredCredentialEntry(runtime.store, id)
      const body = await readObject(req)
      const draft = normalizeCredentialEntryDraft(body.entry)
      const secrets = normalizeSecrets(body.secrets)
      const previousSecrets = await runtime.credentials.readEntry(id)
      requireCredentialSecret(draft.authType, { ...previousSecrets, ...secrets })
      if (Object.keys(secrets).length > 0) await runtime.credentials.writeEntry(id, secrets)
      const next: CredentialEntry = { ...previous, ...draft, id, createdAt: previous.createdAt, updatedAt: Date.now() }
      try { await runtime.store.update(state => { state.credentialEntries = state.credentialEntries.map(entry => entry.id === id ? next : entry) }) }
      catch (error) { await runtime.credentials.replaceEntry(id, previousSecrets).catch(() => {}); throw error }
      return sendJson(res, 200, await credentialEntryView(runtime, next))
    }
    if (id !== undefined && method === 'DELETE' && segments.length === 2) {
      requireMutationHeader(req)
      requiredCredentialEntry(runtime.store, id)
      const references = runtime.store.profiles().filter(profile => profile.credentialId === id)
      if (references.length > 0) throw httpError(409, `credential entry is used by ${references.length} SSH profile(s)`)
      await runtime.store.update(state => { state.credentialEntries = state.credentialEntries.filter(entry => entry.id !== id) })
      await runtime.credentials.deleteEntry(id)
      return sendJson(res, 204, undefined)
    }
  }

  if (segments[0] === 'profiles') {
    if (method === 'GET' && segments.length === 1) return sendJson(res, 200, await profileViews(runtime))
    if (method === 'POST' && segments.length === 1) {
      requireMutationHeader(req)
      const body = await readObject(req)
      const draft = normalizeProfileDraft(body.profile)
      const secrets = normalizeSecrets(body.secrets)
      const now = Date.now()
      const profile: SshProfile = { ...draft, id: createId('host'), port: draft.port ?? 22, proxy: draft.proxy ?? { type: 'none' }, keepAliveIntervalMs: draft.keepAliveIntervalMs ?? 15_000, connectTimeoutMs: draft.connectTimeoutMs ?? 15_000, terminalType: draft.terminalType ?? 'xterm-256color', tags: draft.tags ?? [], createdAt: now, updatedAt: now }
      if (profile.credentialId === undefined) await runtime.credentials.replace(profile.id, secrets)
      try { await runtime.store.update(state => { state.profiles.push(profile) }) }
      catch (error) { if (profile.credentialId === undefined) await runtime.credentials.delete(profile.id).catch(() => {}); throw error }
      return sendJson(res, 201, await profileView(runtime, profile))
    }
    const id = segments[1]
    if (id !== undefined && method === 'PUT' && segments.length === 2) {
      requireMutationHeader(req)
      const previous = requiredProfile(runtime.store, id)
      const body = await readObject(req)
      const draft = normalizeProfileDraft(body.profile)
      const secrets = normalizeSecrets(body.secrets)
      const next: SshProfile = { ...previous, ...draft, port: draft.port ?? 22, proxy: draft.proxy ?? { type: 'none' }, keepAliveIntervalMs: draft.keepAliveIntervalMs ?? 15_000, connectTimeoutMs: draft.connectTimeoutMs ?? 15_000, terminalType: draft.terminalType ?? 'xterm-256color', tags: draft.tags ?? [], id, createdAt: previous.createdAt, updatedAt: Date.now() }
      const previousSecrets = await runtime.credentials.read(id)
      if (Object.keys(secrets).length > 0) await runtime.credentials.write(id, secrets)
      try { await runtime.store.update(state => { state.profiles = state.profiles.map(profile => profile.id === id ? next : profile) }) }
      catch (error) { await runtime.credentials.replace(id, previousSecrets).catch(() => {}); throw error }
      return sendJson(res, 200, await profileView(runtime, next))
    }
    if (id !== undefined && method === 'DELETE' && segments.length === 2) {
      requireMutationHeader(req)
      requiredProfile(runtime.store, id)
      const related = runtime.store.forwards().filter(rule => rule.profileId === id)
      await Promise.all(related.map(rule => runtime.forwards.stop(rule.id).catch(() => {})))
      await runtime.store.update(state => {
        state.profiles = state.profiles.filter(profile => profile.id !== id)
        state.forwardRules = state.forwardRules.filter(rule => rule.profileId !== id)
        state.injections = state.injections.map(item => {
          const { [id]: _removed, ...workingDirectories } = item.workingDirectories
          return { ...item, profileIds: item.profileIds.filter(profileId => profileId !== id), workingDirectories }
        })
      })
      await runtime.credentials.delete(id)
      return sendJson(res, 204, undefined)
    }
    if (id !== undefined && method === 'POST' && segments[2] === 'test' && segments.length === 3) {
      requireMutationHeader(req)
      requiredProfile(runtime.store, id)
      try {
        const connection = await runtime.connector.connect(id)
        connection.close()
        return sendJson(res, 200, { ok: true })
      } catch (error) {
        if (error instanceof HostKeyRequiredError) return sendJson(res, 409, { ok: false, code: error.code, fingerprint: error.fingerprint })
        throw error
      }
    }
    if (id !== undefined && method === 'POST' && segments[2] === 'confirm-host' && segments.length === 3) {
      requireMutationHeader(req)
      const body = await readObject(req)
      const fingerprint = requireText(body.fingerprint, 'fingerprint', 256)
      const previous = requiredProfile(runtime.store, id)
      const next = { ...previous, hostFingerprint: fingerprint, updatedAt: Date.now() }
      await runtime.store.update(state => { state.profiles = state.profiles.map(profile => profile.id === id ? next : profile) })
      try {
        const connection = await runtime.connector.connect(id)
        connection.close()
      } catch (error) {
        await runtime.store.update(state => { state.profiles = state.profiles.map(profile => profile.id === id ? previous : profile) })
        throw error
      }
      return sendJson(res, 200, await profileView(runtime, next))
    }
  }

  if (segments[0] === 'forwards') {
    if (method === 'GET' && segments.length === 1) return sendJson(res, 200, { rules: runtime.store.forwards(), statuses: runtime.forwards.list() })
    if (method === 'POST' && segments.length === 1) {
      requireMutationHeader(req)
      const draft = normalizeForwardDraft((await readObject(req)).rule)
      requiredProfile(runtime.store, draft.profileId)
      const now = Date.now()
      const rule: ForwardRule = { ...draft, id: createId('forward'), bindHost: draft.bindHost ?? '127.0.0.1', autoStart: draft.autoStart ?? false, createdAt: now, updatedAt: now }
      await runtime.store.update(state => { state.forwardRules.push(rule) })
      return sendJson(res, 201, { rule, status: runtime.forwards.status(rule.id) })
    }
    const id = segments[1]
    if (id !== undefined && method === 'PUT' && segments.length === 2) {
      requireMutationHeader(req)
      const previous = requiredForward(runtime.store, id)
      const draft = normalizeForwardDraft((await readObject(req)).rule)
      requiredProfile(runtime.store, draft.profileId)
      await runtime.forwards.stop(id).catch(() => {})
      const next: ForwardRule = { ...previous, ...draft, bindHost: draft.bindHost ?? '127.0.0.1', autoStart: draft.autoStart ?? false, id, createdAt: previous.createdAt, updatedAt: Date.now() }
      await runtime.store.update(state => { state.forwardRules = state.forwardRules.map(rule => rule.id === id ? next : rule) })
      if (next.autoStart) await runtime.forwards.start(id)
      return sendJson(res, 200, { rule: next, status: runtime.forwards.status(id) })
    }
    if (id !== undefined && method === 'DELETE' && segments.length === 2) {
      requireMutationHeader(req)
      requiredForward(runtime.store, id)
      await runtime.forwards.stop(id).catch(() => {})
      await runtime.store.update(state => { state.forwardRules = state.forwardRules.filter(rule => rule.id !== id) })
      return sendJson(res, 204, undefined)
    }
    if (id !== undefined && method === 'POST' && segments[2] === 'start') { requireMutationHeader(req); return sendJson(res, 200, await runtime.forwards.start(id)) }
    if (id !== undefined && method === 'POST' && segments[2] === 'stop') { requireMutationHeader(req); return sendJson(res, 200, await runtime.forwards.stop(id)) }
  }

  if (segments[0] === 'injections') {
    if (method === 'GET' && segments.length === 1) {
      const sessionId = url.searchParams.get('sessionId')
      if (!sessionId) throw httpError(400, 'sessionId is required')
      return sendJson(res, 200, runtime.store.injection(sessionId) ?? null)
    }
    const sessionId = segments[1]
    if (sessionId !== undefined && method === 'PUT' && segments.length === 2) {
      requireMutationHeader(req)
      const body = await readObject(req)
      const profileIds = parseProfileIds(body.profileIds, runtime.store)
      const permission = body.permission === 'exec' ? 'exec' : body.permission === 'terminal' ? 'terminal' : undefined
      if (permission === undefined) throw httpError(400, 'permission must be exec or terminal')
      const previousDirectories = runtime.store.injection(sessionId)?.workingDirectories ?? {}
      const workingDirectories = Object.fromEntries(Object.entries(previousDirectories).filter(([profileId]) => profileIds.includes(profileId)))
      const injection: SessionInjection = { sessionId, profileIds, permission, requireCommandApproval: body.requireCommandApproval !== false, workingDirectories, updatedAt: Date.now() }
      await runtime.store.update(state => { state.injections = [...state.injections.filter(item => item.sessionId !== sessionId), injection] })
      return sendJson(res, 200, injection)
    }
    if (sessionId !== undefined && method === 'DELETE' && segments.length === 2) {
      requireMutationHeader(req)
      await runtime.store.update(state => { state.injections = state.injections.filter(item => item.sessionId !== sessionId) })
      return sendJson(res, 204, undefined)
    }
  }

  if (segments[0] === 'activity') {
    const sessionId = url.searchParams.get('sessionId')
    if (method === 'GET' && segments.length === 1) {
      if (!sessionId) throw httpError(400, 'sessionId is required')
      const injection = runtime.store.injection(sessionId)
      if (injection === undefined || injection.profileIds.length === 0) return sendJson(res, 200, { injection: null, profiles: [], terminals: [] })
      const profiles = injection.profileIds.map(profileId => runtime.store.profile(profileId)).filter((profile): profile is SshProfile => profile !== undefined).map(profile => ({
        id: profile.id,
        name: profile.name,
        host: profile.host,
        port: profile.port,
        username: profile.username,
        cwd: injection.workingDirectories[profile.id] ?? '~',
      }))
      return sendJson(res, 200, {
        injection,
        profiles,
        terminals: injection.permission === 'terminal' ? runtime.aiTerminals.activity(sessionId) : [],
      })
    }
    if (method === 'PUT' && segments[1] === 'directory' && segments.length === 2) {
      requireMutationHeader(req)
      const body = await readObject(req)
      const targetSessionId = requireText(body.sessionId, 'sessionId', 200)
      const profileId = requireText(body.profileId, 'profileId', 100)
      const cwd = requireRawText(body.cwd, 'cwd', 4096)
      return sendJson(res, 200, { cwd: await setSessionDirectory(runtime.store, runtime.connector, targetSessionId, profileId, cwd) })
    }
    if (method === 'GET' && segments[1] === 'files' && segments.length === 2) {
      if (!sessionId) throw httpError(400, 'sessionId is required')
      const profileId = requireText(url.searchParams.get('profileId'), 'profileId', 100)
      const injection = requireActivityProfile(runtime.store, sessionId, profileId)
      const requestedPath = url.searchParams.get('path') ?? injection.workingDirectories[profileId] ?? '~'
      return sendJson(res, 200, await listSftpDirectory(runtime.connector, profileId, requestedPath))
    }
    if (method === 'GET' && segments[1] === 'file' && segments.length === 2) {
      if (!sessionId) throw httpError(400, 'sessionId is required')
      const profileId = requireText(url.searchParams.get('profileId'), 'profileId', 100)
      requireActivityProfile(runtime.store, sessionId, profileId)
      const requestedPath = requireRawText(url.searchParams.get('path'), 'path', 4096)
      return sendJson(res, 200, await readSftpFilePreview(runtime.connector, profileId, requestedPath))
    }
    if (method === 'GET' && segments[1] === 'download' && segments.length === 2) {
      if (!sessionId) throw httpError(400, 'sessionId is required')
      const profileId = requireText(url.searchParams.get('profileId'), 'profileId', 100)
      requireActivityProfile(runtime.store, sessionId, profileId)
      const requestedPath = requireRawText(url.searchParams.get('path'), 'path', 4096)
      const file = await openSftpFile(runtime.connector, profileId, requestedPath)
      const filename = file.path.replaceAll('\\', '/').split('/').at(-1) || 'download'
      res.statusCode = 200
      res.setHeader('Cache-Control', 'private, no-store')
      res.setHeader('Content-Type', file.mimeType)
      res.setHeader('Content-Length', String(file.size))
      res.setHeader('Content-Disposition', `${url.searchParams.get('inline') === '1' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`)
      res.setHeader('X-Content-Type-Options', 'nosniff')
      try { await pipeline(file.stream, res) } finally { file.close() }
      return
    }
    if (method === 'POST' && segments[1] === 'terminals' && segments[2] !== undefined && segments.length === 4) {
      requireMutationHeader(req)
      const terminalId = segments[2]
      const operation = segments[3]
      const body = await readObject(req)
      const targetSessionId = requireText(body.sessionId, 'sessionId', 200)
      requireActivityTerminal(runtime.store, targetSessionId)
      if (operation === 'input') {
        runtime.aiTerminals.write(targetSessionId, terminalId, requireRawText(body.text, 'text', 100_000))
        return sendJson(res, 204, undefined)
      }
      if (operation === 'resize') {
        runtime.aiTerminals.resize(targetSessionId, terminalId, requireInteger(body.cols, 'cols', 20, 400), requireInteger(body.rows, 'rows', 5, 200))
        return sendJson(res, 204, undefined)
      }
    }
  }

  if (segments[0] === 'settings' && segments.length === 1) {
    if (method === 'GET') return sendJson(res, 200, runtime.store.settings())
    if (method === 'PUT') {
      requireMutationHeader(req)
      const body = await readObject(req)
      const settings = {
        allowPublicBind: body.allowPublicBind === true,
        defaultCommandTimeoutMs: requireInteger(body.defaultCommandTimeoutMs, 'defaultCommandTimeoutMs', 1000, 300_000),
        maxOutputChars: requireInteger(body.maxOutputChars, 'maxOutputChars', 1000, 1_000_000),
      }
      await runtime.store.update(state => { state.settings = settings })
      return sendJson(res, 200, settings)
    }
  }

  if (segments[0] === 'terminals') {
    if (method === 'POST' && segments.length === 1) {
      requireMutationHeader(req)
      const body = await readObject(req)
      const profileId = requireText(body.profileId, 'profileId', 100)
      requiredProfile(runtime.store, profileId)
      return sendJson(res, 201, await runtime.terminals.create(profileId, optionalInteger(body.cols, 20, 400) ?? 120, optionalInteger(body.rows, 5, 200) ?? 32))
    }
    const id = segments[1]
    if (id !== undefined && method === 'GET' && segments[2] === 'output') {
      return sendJson(res, 200, runtime.terminals.get(id).read(optionalInteger(Number(url.searchParams.get('cursor') ?? 0), 0, Number.MAX_SAFE_INTEGER) ?? 0))
    }
    if (id !== undefined && method === 'POST' && segments[2] === 'input') {
      requireMutationHeader(req)
      runtime.terminals.get(id).write(requireRawText((await readObject(req)).text, 'text', 100_000))
      return sendJson(res, 204, undefined)
    }
    if (id !== undefined && method === 'POST' && segments[2] === 'resize') {
      requireMutationHeader(req)
      const body = await readObject(req)
      runtime.terminals.get(id).resize(requireInteger(body.cols, 'cols', 20, 400), requireInteger(body.rows, 'rows', 5, 200))
      return sendJson(res, 204, undefined)
    }
    if (id !== undefined && method === 'DELETE' && segments.length === 2) {
      requireMutationHeader(req)
      await runtime.terminals.get(id).close()
      return sendJson(res, 204, undefined)
    }
  }

  throw httpError(404, 'SSH API route was not found')
}

async function profileViews(runtime: SshApiRuntime): Promise<unknown[]> {
  return Promise.all(runtime.store.profiles().map(profile => profileView(runtime, profile)))
}

async function profileView(runtime: SshApiRuntime, profile: SshProfile): Promise<unknown> {
  if (profile.credentialId !== undefined) {
    const entry = requiredCredentialEntry(runtime.store, profile.credentialId)
    const credential = await runtime.credentials.describeEntry(entry.id)
    const requiredField = entry.authType === 'password' ? 'password' : 'privateKey'
    return { ...profile, username: entry.username, authType: entry.authType, credential: { ...credential, configured: credential.fields.includes(requiredField), source: 'vault', entryId: entry.id, entryName: entry.name } }
  }
  const credential = await runtime.credentials.describe(profile.id)
  const requiredField = profile.authType === 'password' ? 'password' : profile.authType === 'private-key' ? 'privateKey' : undefined
  return { ...profile, credential: { ...credential, configured: requiredField === undefined || credential.fields.includes(requiredField), source: 'profile' } }
}

async function credentialEntryViews(runtime: SshApiRuntime): Promise<unknown[]> {
  return Promise.all(runtime.store.credentialEntries().map(entry => credentialEntryView(runtime, entry)))
}

async function credentialEntryView(runtime: SshApiRuntime, entry: CredentialEntry): Promise<unknown> {
  const credential = await runtime.credentials.describeEntry(entry.id)
  const requiredField = entry.authType === 'password' ? 'password' : 'privateKey'
  return { ...entry, credential: { ...credential, configured: credential.fields.includes(requiredField) }, references: runtime.store.profiles().filter(profile => profile.credentialId === entry.id).length }
}

function requiredProfile(store: SshStore, id: string): SshProfile {
  const profile = store.profile(id)
  if (profile === undefined) throw httpError(404, 'SSH profile was not found')
  return profile
}

function requiredForward(store: SshStore, id: string): ForwardRule {
  const rule = store.forward(id)
  if (rule === undefined) throw httpError(404, 'port-forward rule was not found')
  return rule
}

function requiredCredentialEntry(store: SshStore, id: string): CredentialEntry {
  const entry = store.credentialEntry(id)
  if (entry === undefined) throw httpError(404, 'SSH credential entry was not found')
  return entry
}

function requireCredentialSecret(authType: CredentialEntry['authType'], secrets: ReturnType<typeof normalizeSecrets>): void {
  if (authType === 'password' && !secrets.password) throw httpError(400, 'password is required for this credential entry')
  if (authType === 'private-key' && !secrets.privateKey) throw httpError(400, 'private key is required for this credential entry')
}

function requireActivityProfile(store: SshStore, sessionId: string, profileId: string): SessionInjection {
  const injection = store.injection(sessionId)
  if (injection === undefined) throw httpError(403, 'SSH access is not injected into this DSH session')
  if (!injection.profileIds.includes(profileId)) throw httpError(403, 'This SSH profile is not injected into the current DSH session')
  return injection
}

function requireActivityTerminal(store: SshStore, sessionId: string): SessionInjection {
  const injection = store.injection(sessionId)
  if (injection === undefined || injection.permission !== 'terminal') throw httpError(403, 'Terminal control is not granted to this DSH session')
  return injection
}

function parseProfileIds(value: unknown, store: SshStore): string[] {
  if (!Array.isArray(value) || value.length > 100) throw httpError(400, 'profileIds must be an array')
  return [...new Set(value.map(item => requireText(item, 'profileId', 100)))].map(id => requiredProfile(store, id).id)
}

function createId(prefix: string): string { return `${prefix}-${randomBytes(10).toString('hex')}` }

function assertSameOrigin(req: IncomingMessage): void {
  const origin = req.headers.origin
  const host = req.headers.host
  if (origin !== undefined && host !== undefined && new URL(origin).host !== host) throw httpError(403, 'cross-origin SSH API access is forbidden')
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'same-site' && site !== 'none') throw httpError(403, 'cross-site SSH API access is forbidden')
}

function requireMutationHeader(req: IncomingMessage): void {
  if (req.headers['x-dsh-ssh-request'] !== '1') throw httpError(403, 'missing SSH mutation request header')
}

async function readObject(req: IncomingMessage): Promise<Record<string, unknown>> {
  let total = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_BODY_BYTES) throw httpError(413, 'request body is too large')
    chunks.push(buffer)
  }
  let parsed: unknown
  try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { throw httpError(400, 'request body must be valid JSON') }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw httpError(400, 'request body must be an object')
  return parsed as Record<string, unknown>
}

function requireText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) throw httpError(400, `${label} is invalid`)
  return value.trim()
}

function requireRawText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw httpError(400, `${label} is invalid`)
  return value
}

function requireInteger(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw httpError(400, `${label} must be an integer between ${min} and ${max}`)
  return value
}

function optionalInteger(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requireInteger(value, 'value', min, max)
}

function httpError(status: number, message: string): Error { return Object.assign(new Error(message), { status }) }

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(value === undefined ? '' : JSON.stringify(value))
}

function sendError(res: ServerResponse, error: unknown): void {
  if (res.headersSent) { res.destroy(); return }
  const value = error as Error & { status?: number; code?: string }
  const status = Number.isInteger(value.status) ? value.status! : value instanceof HostKeyRequiredError ? 409 : 500
  sendJson(res, status, {
    error: value instanceof Error ? value.message : String(error),
    ...value.code === undefined ? {} : { code: value.code },
    ...value instanceof HostKeyRequiredError ? { fingerprint: value.fingerprint } : {},
  })
}
