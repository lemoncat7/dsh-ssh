import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { pipeline } from 'node:stream/promises'
import { HostKeyRequiredError, SshConnector } from './connector.js'
import { SshCredentialVault } from './credentials.js'
import {
  normalizeCredentialEntryDraft, normalizeForwardDraft, normalizeFtpProfileDraft, normalizeProfileDraft, normalizeProxyEntryDraft, normalizeRemoteProjectDraft, normalizeSecrets,
  type CredentialEntry, type ForwardRule, type FtpProfile, type ProxyEntry, type RemoteProject, type SessionInjection, type SshProfile,
} from './domain.js'
import { ForwardManager } from './forwards.js'
import { SshStore } from './store.js'
import { setSessionDirectory } from './directory.js'
import { AiTerminalManager, BrowserTerminalManager } from './terminal.js'
import { streamTerminalOutput } from './terminal-stream.js'
import { normalizeGitHubProxy } from './github-http.js'
import { listSftpDirectory, openSftpFile, readSftpFilePreview, uploadSftpFile } from './sftp.js'
import { ActivityEventBus, streamActivityEvents } from './activity-events.js'
import { deleteLocalWorkspaceEntries, listLocalWorkspace, openLocalWorkspaceFile, readLocalWorkspacePreview } from './local-workspace.js'
import { connectFtpProfile } from './ftp-adapter.js'
import { NetworkDialer } from './network-dialer.js'
import { RemoteFileSystems } from './remote-file-systems.js'
import { FileTransferManager, type TransferConflictPolicy } from './file-transfer-manager.js'
import { EndpointSessionManager } from './endpoint-session-manager.js'
import { deleteRemoteEntries, moveRemoteEntries } from './remote-entry-operations.js'
import { remoteName } from './remote-files.js'
import { scanRemoteTree } from './remote-tree-scan.js'
import { streamRemoteTar } from './remote-tar-download.js'
import { GistSyncService } from './gist-sync.js'

const MAX_BODY_BYTES = 1_048_576
const MAX_SFTP_UPLOAD_BYTES = 512 * 1024 * 1024

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
  gistSync: GistSyncService
  connector: SshConnector
  forwards: ForwardManager
  terminals: BrowserTerminalManager
  aiTerminals: AiTerminalManager
  activityEvents: ActivityEventBus
  dialer: NetworkDialer
  files: RemoteFileSystems
  transfers: FileTransferManager
  fileSessions: EndpointSessionManager
  sessionCwd(sessionId: string): string | undefined
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

  if (method === 'GET' && segments[0] === 'health') return sendJson(res, 200, { ok: true, service: 'dsh-ssh', schemaVersion: 5 })

  if (segments[0] === 'gist-sync') {
    if (segments.length === 1 && method === 'GET') return sendJson(res, 200, await runtime.gistSync.view())
    if (segments.length === 1 && method === 'PUT') {
      requireMutationHeader(req)
      return sendJson(res, 200, await runtime.gistSync.configure(await readObject(req)))
    }
    if (segments[1] === 'test' && segments.length === 2 && method === 'POST') {
      requireMutationHeader(req)
      return sendJson(res, 200, await runtime.gistSync.testConnection())
    }
    if (segments[1] === 'network' && segments[2] === 'test' && segments.length === 3 && method === 'POST') {
      requireMutationHeader(req)
      return sendJson(res, 200, await runtime.gistSync.testNetwork())
    }
    if (segments[1] === 'run' && segments.length === 2 && method === 'POST') {
      requireMutationHeader(req)
      return sendJson(res, 200, await runtime.gistSync.sync())
    }
    if (segments[1] === 'oauth' && segments[2] === 'start' && segments.length === 3 && method === 'POST') {
      requireMutationHeader(req)
      return sendJson(res, 200, await runtime.gistSync.startOAuth())
    }
    if (segments[1] === 'oauth' && segments[2] === 'poll' && segments.length === 3 && method === 'POST') {
      requireMutationHeader(req)
      const input = await readObject(req)
      return sendJson(res, 200, await runtime.gistSync.pollOAuth(requireText(input.id, 'id', 64)))
    }
    if (segments[1] === 'oauth' && segments[2] === 'disconnect' && segments.length === 3 && method === 'POST') {
      requireMutationHeader(req)
      return sendJson(res, 200, await runtime.gistSync.disconnectGitHub())
    }
  }

  if (segments[0] === 'file-transfer') {
    if (method === 'GET' && segments[1] === 'endpoints' && segments.length === 2) return sendJson(res, 200, runtime.files.endpoints())
    if (method === 'GET' && segments[1] === 'directory' && segments.length === 2) {
      const endpointId = requireText(url.searchParams.get('endpointId'), 'endpointId', 110)
      const paneId = requireText(url.searchParams.get('paneId'), 'paneId', 100)
      return sendJson(res, 200, await runtime.fileSessions.run(paneId, endpointId, session => session.list(url.searchParams.get('path') ?? session.endpoint.initialPath)))
    }
    if (method === 'GET' && segments[1] === 'download' && segments.length === 2) {
      const endpointId = requireText(url.searchParams.get('endpointId'), 'endpointId', 110)
      const requestedPath = requireRawText(url.searchParams.get('path'), 'path', 4096)
      return streamRemoteEndpointFile(req, res, runtime, endpointId, requestedPath)
    }
    if (method === 'POST' && segments[1] === 'delete' && segments.length === 2) {
      requireMutationHeader(req)
      const request = parseFileDeleteRequest(await readObject(req))
      await runtime.fileSessions.run(request.paneId, request.endpointId, session => deleteRemoteEntries(session, request))
      return sendJson(res, 204, undefined)
    }
    if (method === 'POST' && segments[1] === 'move' && segments.length === 2) {
      requireMutationHeader(req)
      const request = parseFileMoveRequest(await readObject(req))
      await runtime.fileSessions.run(request.paneId, request.endpointId, session => moveRemoteEntries(session, { directory: request.sourceDirectory, destinationDirectory: request.destinationDirectory, paths: request.paths }))
      return sendJson(res, 204, undefined)
    }
    if (segments[1] === 'jobs') {
      if (method === 'GET' && segments.length === 2) return sendJson(res, 200, runtime.transfers.list())
      if (method === 'POST' && segments.length === 2) {
        requireMutationHeader(req)
        const body = await readObject(req)
        return sendJson(res, 202, runtime.transfers.start('ui', parseTransferRequest(body)))
      }
      const jobId = segments[2]
      if (jobId !== undefined && method === 'GET' && segments.length === 3) return sendJson(res, 200, runtime.transfers.get(jobId))
      if (jobId !== undefined && method === 'DELETE' && segments.length === 3) { requireMutationHeader(req); runtime.transfers.cancel(jobId); return sendJson(res, 204, undefined) }
    }
  }

  if (segments[0] === 'ftp-profiles') {
    if (method === 'GET' && segments.length === 1) return sendJson(res, 200, await ftpProfileViews(runtime))
    if (method === 'POST' && segments[1] === 'test-draft' && segments.length === 2) {
      requireMutationHeader(req)
      const body = await readObject(req)
      const draft = normalizeFtpProfileDraft(body.profile)
      const id = body.profileId === undefined ? createId('ftp-preview') : requiredFtpProfile(runtime.store, requireText(body.profileId, 'profileId', 100)).id
      const previous = body.profileId === undefined ? {} : await runtime.credentials.readFtp(id)
      const secrets = { ...previous, ...normalizeSecrets(body.secrets) }
      if (!secrets.password && draft.credentialId === undefined) throw httpError(400, 'FTP password is required')
      const credentialEntry = draft.credentialId === undefined ? undefined : requiredPasswordCredential(runtime.store, draft.credentialId)
      const password = credentialEntry === undefined ? secrets.password! : (await runtime.credentials.readEntry(credentialEntry.id)).password
      if (!password) throw httpError(400, 'FTP password credential is not configured')
      const now = Date.now()
      const profile: FtpProfile = { ...draft, id, username: credentialEntry?.username ?? draft.username, port: draft.port ?? defaultFtpPort(draft.protocol), proxy: draft.proxy ?? { type: 'none' }, initialPath: draft.initialPath ?? '/', connectTimeoutMs: draft.connectTimeoutMs ?? 15_000, createdAt: now, updatedAt: now }
      const session = await connectFtpProfile(profile, password, runtime.dialer)
      try { await session.list(profile.initialPath); return sendJson(res, 200, { ok: true }) } finally { session.close() }
    }
    if (method === 'POST' && segments.length === 1) {
      requireMutationHeader(req)
      const body = await readObject(req)
      const draft = normalizeFtpProfileDraft(body.profile)
      if (draft.credentialId !== undefined) requiredPasswordCredential(runtime.store, draft.credentialId)
      const secrets = normalizeSecrets(body.secrets)
      if (draft.credentialId === undefined && !secrets.password) throw httpError(400, 'FTP password is required')
      const now = Date.now()
      const profile: FtpProfile = { ...draft, id: createId('ftp'), port: draft.port ?? defaultFtpPort(draft.protocol), proxy: draft.proxy ?? { type: 'none' }, initialPath: draft.initialPath ?? '/', connectTimeoutMs: draft.connectTimeoutMs ?? 15_000, createdAt: now, updatedAt: now }
      if (profile.credentialId === undefined) await runtime.credentials.replaceFtp(profile.id, { password: secrets.password! })
      try { await runtime.store.update(state => { state.ftpProfiles.push(profile) }) }
      catch (error) { if (profile.credentialId === undefined) await runtime.credentials.deleteFtp(profile.id).catch(() => {}); throw error }
      return sendJson(res, 201, await ftpProfileView(runtime, profile))
    }
    const id = segments[1]
    if (id !== undefined && method === 'PUT' && segments.length === 2) {
      requireMutationHeader(req)
      const previous = requiredFtpProfile(runtime.store, id)
      const body = await readObject(req)
      const draft = normalizeFtpProfileDraft(body.profile)
      if (draft.credentialId !== undefined) requiredPasswordCredential(runtime.store, draft.credentialId)
      const secrets = normalizeSecrets(body.secrets)
      const next: FtpProfile = { ...previous, ...draft, id, port: draft.port ?? defaultFtpPort(draft.protocol), proxy: draft.proxy ?? { type: 'none' }, initialPath: draft.initialPath ?? '/', connectTimeoutMs: draft.connectTimeoutMs ?? 15_000, createdAt: previous.createdAt, updatedAt: Date.now() }
      if (draft.group === undefined) delete next.group
      if (draft.tlsServerName === undefined) delete next.tlsServerName
      const oldSecrets = await runtime.credentials.readFtp(id)
      if (next.credentialId === undefined && !secrets.password && !oldSecrets.password) throw httpError(400, 'FTP password is required when switching to connection-specific credentials')
      if (next.credentialId === undefined && secrets.password) await runtime.credentials.writeFtp(id, { password: secrets.password })
      try { await runtime.store.update(state => { state.ftpProfiles = state.ftpProfiles.map(profile => profile.id === id ? next : profile) }) }
      catch (error) { await runtime.credentials.replaceFtp(id, oldSecrets).catch(() => {}); throw error }
      if (next.credentialId !== undefined && previous.credentialId === undefined) await runtime.credentials.deleteFtp(id).catch(() => {})
      return sendJson(res, 200, await ftpProfileView(runtime, next))
    }
    if (id !== undefined && method === 'DELETE' && segments.length === 2) {
      requireMutationHeader(req)
      requiredFtpProfile(runtime.store, id)
      await runtime.store.update(state => {
        state.ftpProfiles = state.ftpProfiles.filter(profile => profile.id !== id)
        state.injections = state.injections.map(injection => ({ ...injection, fileEndpointIds: injection.fileEndpointIds.filter(endpointId => endpointId !== `ftp:${id}`) }))
      })
      await runtime.credentials.deleteFtp(id)
      return sendJson(res, 204, undefined)
    }
  }

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
      const references = runtime.store.profiles().filter(profile => profile.credentialId === id).length + runtime.store.ftpProfiles().filter(profile => profile.credentialId === id).length
      if (references > 0) throw httpError(409, `credential entry is used by ${references} connection(s)`)
      await runtime.store.update(state => { state.credentialEntries = state.credentialEntries.filter(entry => entry.id !== id) })
      await runtime.credentials.deleteEntry(id)
      return sendJson(res, 204, undefined)
    }
  }

  if (segments[0] === 'proxies') {
    if (method === 'GET' && segments.length === 1) return sendJson(res, 200, await proxyEntryViews(runtime))
    if (method === 'POST' && segments.length === 1) {
      requireMutationHeader(req)
      const body = await readObject(req)
      const draft = normalizeProxyEntryDraft(body.entry)
      const secrets = normalizeProxySecrets(body.secrets)
      const now = Date.now()
      const entry: ProxyEntry = { ...draft, id: createId('proxy'), createdAt: now, updatedAt: now }
      await runtime.credentials.replaceProxyEntry(entry.id, secrets)
      try { await runtime.store.update(state => { state.proxyEntries.push(entry) }) }
      catch (error) { await runtime.credentials.deleteProxyEntry(entry.id).catch(() => {}); throw error }
      return sendJson(res, 201, await proxyEntryView(runtime, entry))
    }
    const id = segments[1]
    if (id !== undefined && method === 'PUT' && segments.length === 2) {
      requireMutationHeader(req)
      const previous = requiredProxyEntry(runtime.store, id)
      const body = await readObject(req)
      const draft = normalizeProxyEntryDraft(body.entry)
      const secrets = normalizeProxySecrets(body.secrets)
      const previousSecrets = await runtime.credentials.readProxyEntry(id)
      if (Object.keys(secrets).length > 0) await runtime.credentials.writeProxyEntry(id, secrets)
      const next: ProxyEntry = { ...previous, ...draft, id, createdAt: previous.createdAt, updatedAt: Date.now() }
      try { await runtime.store.update(state => { state.proxyEntries = state.proxyEntries.map(entry => entry.id === id ? next : entry) }) }
      catch (error) { await runtime.credentials.replaceProxyEntry(id, previousSecrets).catch(() => {}); throw error }
      return sendJson(res, 200, await proxyEntryView(runtime, next))
    }
    if (id !== undefined && method === 'DELETE' && segments.length === 2) {
      requireMutationHeader(req)
      requiredProxyEntry(runtime.store, id)
      const references = runtime.store.profiles().filter(profile => profile.proxy.type === 'saved' && profile.proxy.proxyId === id).length + runtime.store.ftpProfiles().filter(profile => profile.proxy.type === 'saved' && profile.proxy.proxyId === id).length
      if (references > 0) throw httpError(409, `proxy entry is used by ${references} connection(s)`)
      await runtime.store.update(state => { state.proxyEntries = state.proxyEntries.filter(entry => entry.id !== id) })
      await runtime.credentials.deleteProxyEntry(id)
      return sendJson(res, 204, undefined)
    }
  }

  if (segments[0] === 'profiles') {
    if (method === 'GET' && segments.length === 1) return sendJson(res, 200, await profileViews(runtime))
    if (method === 'POST' && segments[1] === 'test-draft' && segments.length === 2) {
      requireMutationHeader(req)
      const body = await readObject(req)
      const draft = normalizeProfileDraft(body.profile)
      const profileId = body.profileId === undefined ? createId('preview') : requireText(body.profileId, 'profileId', 100)
      const previousSecrets = body.profileId === undefined ? {} : await runtime.credentials.read(requiredProfile(runtime.store, profileId).id)
      const secrets = { ...previousSecrets, ...normalizeSecrets(body.secrets) }
      const now = Date.now()
      const profile: SshProfile = { ...draft, id: profileId, port: draft.port ?? 22, proxy: draft.proxy ?? { type: 'none' }, keepAliveIntervalMs: draft.keepAliveIntervalMs ?? 15_000, connectTimeoutMs: draft.connectTimeoutMs ?? 15_000, terminalType: draft.terminalType ?? 'xterm-256color', tags: draft.tags ?? [], createdAt: now, updatedAt: now }
      try {
        const connection = await runtime.connector.connectDraft(profile, secrets)
        connection.close()
        return sendJson(res, 200, { ok: true })
      } catch (error) {
        if (error instanceof HostKeyRequiredError) return sendJson(res, 409, { ok: false, code: error.code, fingerprint: error.fingerprint })
        throw error
      }
    }
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
    if (id !== undefined && segments[2] === 'projects') {
      requiredProfile(runtime.store, id)
      if (method === 'GET' && segments.length === 3) return sendJson(res, 200, runtime.store.remoteProjects(id))
      if (method === 'POST' && segments.length === 3) {
        requireMutationHeader(req)
        const draft = normalizeRemoteProjectDraft((await readObject(req)).project)
        const now = Date.now()
        const project: RemoteProject = { ...draft, id: createId('project'), profileId: id, createdAt: now, updatedAt: now }
        await runtime.store.update(state => { state.remoteProjects.push(project) })
        return sendJson(res, 201, project)
      }
      const projectId = segments[3]
      if (projectId !== undefined && method === 'PUT' && segments.length === 4) {
        requireMutationHeader(req)
        const previous = requiredRemoteProject(runtime.store, projectId, id)
        const draft = normalizeRemoteProjectDraft((await readObject(req)).project)
        const next: RemoteProject = { ...previous, ...draft, updatedAt: Date.now() }
        await runtime.store.update(state => {
          state.remoteProjects = state.remoteProjects.map(project => project.id === projectId ? next : project)
          state.injections = state.injections.map(injection => {
            if (injection.workingProjectIds[previous.profileId] !== projectId || injection.workingDirectories[previous.profileId] !== previous.path) return injection
            return { ...injection, workingDirectories: { ...injection.workingDirectories, [previous.profileId]: next.path } }
          })
        })
        return sendJson(res, 200, next)
      }
      if (projectId !== undefined && method === 'DELETE' && segments.length === 4) {
        requireMutationHeader(req)
        requiredRemoteProject(runtime.store, projectId, id)
        await runtime.store.update(state => {
          state.remoteProjects = state.remoteProjects.filter(project => project.id !== projectId)
          state.injections = state.injections.map(injection => {
            if (injection.workingProjectIds[id] !== projectId) return injection
            const { [id]: _removed, ...workingProjectIds } = injection.workingProjectIds
            return { ...injection, workingProjectIds }
          })
        })
        return sendJson(res, 204, undefined)
      }
    }
    if (id !== undefined && segments[2] === 'sftp') {
      requiredProfile(runtime.store, id)
      const operation = segments[3]
      if (method === 'GET' && operation === 'directory' && segments.length === 4) {
        return sendJson(res, 200, await listSftpDirectory(runtime.connector, id, url.searchParams.get('path') ?? '~'))
      }
      if (method === 'GET' && operation === 'file' && segments.length === 4) {
        return sendJson(res, 200, await readSftpFilePreview(runtime.connector, id, requireRawText(url.searchParams.get('path'), 'path', 4096)))
      }
      if (method === 'GET' && operation === 'download' && segments.length === 4) {
        return streamSftpFile(res, url, runtime, id, requireRawText(url.searchParams.get('path'), 'path', 4096))
      }
      if (method === 'PUT' && operation === 'upload' && segments.length === 4) {
        requireMutationHeader(req)
        const contentLengthHeader = req.headers['content-length']
        const contentLength = contentLengthHeader === undefined ? undefined : optionalInteger(Number(contentLengthHeader), 0, Number.MAX_SAFE_INTEGER)
        if (contentLength !== undefined && contentLength > MAX_SFTP_UPLOAD_BYTES) throw httpError(413, 'upload exceeds the 512 MB limit')
        const directory = requireRawText(url.searchParams.get('directory'), 'directory', 4096)
        const filename = requireRemoteFilename(url.searchParams.get('name'))
        const result = await uploadSftpFile(runtime.connector, id, directory, filename, req, {
          overwrite: url.searchParams.get('overwrite') === '1',
          maxBytes: MAX_SFTP_UPLOAD_BYTES,
        })
        return sendJson(res, 201, result)
      }
    }
    if (id !== undefined && method === 'PUT' && segments.length === 2) {
      requireMutationHeader(req)
      const previous = requiredProfile(runtime.store, id)
      const body = await readObject(req)
      const draft = normalizeProfileDraft(body.profile)
      const secrets = normalizeSecrets(body.secrets)
      const next: SshProfile = { ...previous, ...draft, port: draft.port ?? 22, proxy: draft.proxy ?? { type: 'none' }, keepAliveIntervalMs: draft.keepAliveIntervalMs ?? 15_000, connectTimeoutMs: draft.connectTimeoutMs ?? 15_000, terminalType: draft.terminalType ?? 'xterm-256color', tags: draft.tags ?? [], id, createdAt: previous.createdAt, updatedAt: Date.now() }
      if (draft.group === undefined) delete next.group
      const previousSecrets = await runtime.credentials.read(id)
      if (Object.keys(secrets).length > 0) await runtime.credentials.write(id, secrets)
      try { await runtime.store.update(state => { state.profiles = state.profiles.map(profile => profile.id === id ? next : profile) }) }
      catch (error) { await runtime.credentials.replace(id, previousSecrets).catch(() => {}); throw error }
      return sendJson(res, 200, await profileView(runtime, next))
    }
    if (id !== undefined && method === 'DELETE' && segments.length === 2) {
      requireMutationHeader(req)
      requiredProfile(runtime.store, id)
      const jumpDependents = runtime.store.profiles().filter(profile => profile.id !== id && profile.proxy.type === 'jump' && profile.proxy.profileIds.includes(id))
      if (jumpDependents.length > 0) throw httpError(409, `profile is used as a jump host by ${jumpDependents.length} SSH profile(s)`)
      const related = runtime.store.forwards().filter(rule => rule.profileId === id)
      await Promise.all(related.map(rule => runtime.forwards.stop(rule.id).catch(() => {})))
      await runtime.store.update(state => {
        state.profiles = state.profiles.filter(profile => profile.id !== id)
        state.remoteProjects = (state.remoteProjects ?? []).filter(project => project.profileId !== id)
        state.forwardRules = state.forwardRules.filter(rule => rule.profileId !== id)
        state.injections = state.injections.map(item => {
          const { [id]: _removed, ...workingDirectories } = item.workingDirectories
          const { [id]: _removedProject, ...workingProjectIds } = item.workingProjectIds
          return { ...item, profileIds: item.profileIds.filter(profileId => profileId !== id), fileEndpointIds: (item.fileEndpointIds ?? []).filter(endpointId => endpointId !== `sftp:${id}`), workingDirectories, workingProjectIds }
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
      const previous = runtime.store.injection(sessionId)
      const profileIds = parseProfileIds(body.profileIds, runtime.store)
      const fileEndpointIds = body.fileEndpointIds === undefined ? previous?.fileEndpointIds ?? [] : parseFileEndpointIds(body.fileEndpointIds, runtime.files)
      const filePermission = body.filePermission === undefined ? previous?.filePermission ?? 'browse' : body.filePermission === 'browse' ? 'browse' : body.filePermission === 'transfer' ? 'transfer' : undefined
      if (filePermission === undefined) throw httpError(400, 'filePermission must be browse or transfer')
      const permission = body.permission === 'exec' ? 'exec' : body.permission === 'terminal' ? 'terminal' : undefined
      if (permission === undefined) throw httpError(400, 'permission must be exec or terminal')
      const workingDirectories = parseWorkingDirectories(body.workingDirectories, profileIds)
      const workingProjectIds = parseWorkingProjectIds(body.workingProjectIds, profileIds, runtime.store)
      const injection: SessionInjection = {
        sessionId, profileIds, fileEndpointIds, filePermission, requireFileApproval: body.requireFileApproval === undefined ? previous?.requireFileApproval ?? true : body.requireFileApproval !== false,
        permission, requireCommandApproval: body.requireCommandApproval !== false, workingDirectories, workingProjectIds, updatedAt: Date.now(),
      }
      await runtime.store.update(state => { state.injections = [...state.injections.filter(item => item.sessionId !== sessionId), injection] })
      const revoked = previous?.profileIds.filter(profileId => !profileIds.includes(profileId)) ?? []
      if (permission !== 'terminal') await runtime.aiTerminals.closeOwner(sessionId)
      else await Promise.all(revoked.map(profileId => runtime.aiTerminals.closeProfile(sessionId, profileId)))
      return sendJson(res, 200, injection)
    }
    if (sessionId !== undefined && method === 'DELETE' && segments.length === 2) {
      requireMutationHeader(req)
      await runtime.store.update(state => { state.injections = state.injections.filter(item => item.sessionId !== sessionId) })
      await runtime.aiTerminals.closeOwner(sessionId)
      return sendJson(res, 204, undefined)
    }
  }

  if (segments[0] === 'activity') {
    const sessionId = url.searchParams.get('sessionId')
    if (method === 'GET' && segments[1] === 'local-directory' && segments.length === 2) {
      if (!sessionId) throw httpError(400, 'sessionId is required')
      const cwd = runtime.sessionCwd(sessionId)
      if (cwd === undefined) throw httpError(404, "No working directory is available for the current session.")
      return sendJson(res, 200, await listLocalWorkspace(cwd, url.searchParams.get('path') ?? undefined))
    }
    if (method === 'GET' && segments[1] === 'local-file' && segments.length === 2) {
      if (!sessionId) throw httpError(400, 'sessionId is required')
      const cwd = runtime.sessionCwd(sessionId)
      if (cwd === undefined) throw httpError(404, "No working directory is available for the current session.")
      return sendJson(res, 200, await readLocalWorkspacePreview(cwd, requireRawText(url.searchParams.get('path'), 'path', 4096)))
    }
    if (method === 'POST' && segments[1] === 'local-delete' && segments.length === 2) {
      requireMutationHeader(req)
      const request = parseLocalDeleteRequest(await readObject(req))
      const cwd = runtime.sessionCwd(request.sessionId)
      if (cwd === undefined) throw httpError(404, "No working directory is available for the current session.")
      await deleteLocalWorkspaceEntries(cwd, request.directory, request.paths)
      return sendJson(res, 204, undefined)
    }
    if (method === 'GET' && segments[1] === 'local-download' && segments.length === 2) {
      if (!sessionId) throw httpError(400, 'sessionId is required')
      const cwd = runtime.sessionCwd(sessionId)
      if (cwd === undefined) throw httpError(404, "No working directory is available for the current session.")
      return streamLocalFile(res, url, await openLocalWorkspaceFile(cwd, requireRawText(url.searchParams.get('path'), 'path', 4096)))
    }
    if (method === 'GET' && segments[1] === 'events' && segments.length === 2) {
      if (!sessionId) throw httpError(400, 'sessionId is required')
      if (runtime.store.injection(sessionId) === undefined) throw httpError(403, 'SSH access is not injected into this DSH session')
      return streamActivityEvents(req, res, sessionId, runtime.activityEvents)
    }
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
    if (method === 'DELETE' && segments[1] === 'terminals' && segments[2] !== undefined && segments.length === 3) {
      requireMutationHeader(req)
      if (!sessionId) throw httpError(400, 'sessionId is required')
      await closeActivityTerminal(runtime, sessionId, segments[2])
      return sendJson(res, 204, undefined)
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
      return streamSftpFile(res, url, runtime, profileId, requestedPath)
    }
    if (method === 'POST' && segments[1] === 'terminals' && segments[2] !== undefined && segments.length === 4) {
      requireMutationHeader(req)
      const terminalId = segments[2]
      const operation = segments[3]
      const body = await readObject(req)
      const targetSessionId = requireText(body.sessionId, 'sessionId', 200)
      if (operation === 'close') {
        await closeActivityTerminal(runtime, targetSessionId, terminalId)
        return sendJson(res, 204, undefined)
      }
      requireActivityTerminal(runtime.store, targetSessionId)
      if (operation === 'input') {
        runtime.aiTerminals.writeOrdered(targetSessionId, terminalId, optionalInteger(body.sequence, 0, Number.MAX_SAFE_INTEGER), requireRawText(body.text, 'text', 100_000))
        return sendJson(res, 204, undefined)
      }
      if (operation === 'resize') {
        runtime.aiTerminals.resize(targetSessionId, terminalId, requireInteger(body.cols, 'cols', 20, 400), requireInteger(body.rows, 'rows', 5, 200))
        return sendJson(res, 204, undefined)
      }
    }
    if (method === 'GET' && segments[1] === 'terminals' && segments[2] !== undefined && segments[3] === 'output' && segments.length === 4) {
      if (!sessionId) throw httpError(400, 'sessionId is required')
      requireActivityTerminal(runtime.store, sessionId)
      return sendJson(res, 200, runtime.aiTerminals.readOutput(sessionId, segments[2], optionalInteger(Number(url.searchParams.get('cursor') ?? 0), 0, Number.MAX_SAFE_INTEGER) ?? 0))
    }
    if (method === 'GET' && segments[1] === 'terminals' && segments[2] !== undefined && segments[3] === 'stream' && segments.length === 4) {
      if (!sessionId) throw httpError(400, 'sessionId is required')
      requireActivityTerminal(runtime.store, sessionId)
      const terminal = runtime.aiTerminals.get(sessionId, segments[2])
      return streamTerminalOutput(req, res, url, {
        read: cursor => terminal.readOutput(cursor),
        subscribe: listener => terminal.subscribeOutput(listener),
      })
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
        ...(typeof body.githubProxy === 'string' && body.githubProxy.trim() !== '' ? { githubProxy: normalizeGitHubProxy(body.githubProxy) } : {}),
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
    if (id !== undefined && method === 'GET' && segments[2] === 'stream') {
      const terminal = runtime.terminals.get(id)
      return streamTerminalOutput(req, res, url, {
        read: cursor => terminal.read(cursor),
        subscribe: listener => terminal.subscribeOutput(listener),
      })
    }
    if (id !== undefined && method === 'POST' && segments[2] === 'input') {
      requireMutationHeader(req)
      const body = await readObject(req)
      runtime.terminals.get(id).writeOrdered(optionalInteger(body.sequence, 0, Number.MAX_SAFE_INTEGER), requireRawText(body.text, 'text', 100_000))
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

async function closeActivityTerminal(runtime: SshApiRuntime, sessionId: string, terminalId: string): Promise<void> {
  requireActivityTerminal(runtime.store, sessionId)
  if (!await runtime.aiTerminals.close(sessionId, terminalId)) {
    throw httpError(404, 'SSH terminal was not found in the current DSH session')
  }
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
  return { ...entry, credential: { ...credential, configured: credential.fields.includes(requiredField) }, references: runtime.store.profiles().filter(profile => profile.credentialId === entry.id).length + runtime.store.ftpProfiles().filter(profile => profile.credentialId === entry.id).length }
}

async function proxyEntryViews(runtime: SshApiRuntime): Promise<unknown[]> {
  return Promise.all(runtime.store.proxyEntries().map(entry => proxyEntryView(runtime, entry)))
}

async function proxyEntryView(runtime: SshApiRuntime, entry: ProxyEntry): Promise<unknown> {
  const credential = await runtime.credentials.describeProxyEntry(entry.id)
  return { ...entry, credential, references: runtime.store.profiles().filter(profile => profile.proxy.type === 'saved' && profile.proxy.proxyId === entry.id).length + runtime.store.ftpProfiles().filter(profile => profile.proxy.type === 'saved' && profile.proxy.proxyId === entry.id).length }
}

async function ftpProfileViews(runtime: SshApiRuntime): Promise<unknown[]> { return Promise.all(runtime.store.ftpProfiles().map(profile => ftpProfileView(runtime, profile))) }

async function ftpProfileView(runtime: SshApiRuntime, profile: FtpProfile): Promise<unknown> {
  if (profile.credentialId !== undefined) {
    const entry = requiredPasswordCredential(runtime.store, profile.credentialId)
    const credential = await runtime.credentials.describeEntry(entry.id)
    return { ...profile, username: entry.username, credential: { ...credential, configured: credential.fields.includes('password'), source: 'vault', entryId: entry.id, entryName: entry.name } }
  }
  const credential = await runtime.credentials.describeFtp(profile.id)
  return { ...profile, credential: { ...credential, configured: credential.fields.includes('password'), source: 'profile' } }
}

function requiredProfile(store: SshStore, id: string): SshProfile {
  const profile = store.profile(id)
  if (profile === undefined) throw httpError(404, 'SSH profile was not found')
  return profile
}

function requiredFtpProfile(store: SshStore, id: string): FtpProfile {
  const profile = store.ftpProfile(id)
  if (profile === undefined) throw httpError(404, 'FTP profile was not found')
  return profile
}

function requiredPasswordCredential(store: SshStore, id: string): CredentialEntry {
  const entry = requiredCredentialEntry(store, id)
  if (entry.authType !== 'password') throw httpError(400, 'FTP connections require a password credential')
  return entry
}

function requiredRemoteProject(store: SshStore, id: string, profileId: string): RemoteProject {
  const project = store.remoteProject(id)
  if (project === undefined || project.profileId !== profileId) throw httpError(404, 'remote project was not found')
  return project
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

function requiredProxyEntry(store: SshStore, id: string): ProxyEntry {
  const entry = store.proxyEntry(id)
  if (entry === undefined) throw httpError(404, 'SSH proxy entry was not found')
  return entry
}

function requireCredentialSecret(authType: CredentialEntry['authType'], secrets: ReturnType<typeof normalizeSecrets>): void {
  if (authType === 'password' && !secrets.password) throw httpError(400, 'password is required for this credential entry')
  if (authType === 'private-key' && !secrets.privateKey) throw httpError(400, 'private key is required for this credential entry')
}

function normalizeProxySecrets(value: unknown): ReturnType<typeof normalizeSecrets> {
  const { proxyPassword } = normalizeSecrets(value)
  return proxyPassword === undefined ? {} : { proxyPassword }
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

function parseWorkingDirectories(value: unknown, profileIds: string[]): Record<string, string> {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw httpError(400, 'workingDirectories must be an object')
  const result: Record<string, string> = {}
  for (const [profileId, rawPath] of Object.entries(value)) {
    if (!profileIds.includes(profileId)) continue
    const path = requireRawText(rawPath, 'working directory', 4096).trim()
    if (path.length > 0) result[profileId] = path
  }
  return result
}

function parseWorkingProjectIds(value: unknown, profileIds: string[], store: SshStore): Record<string, string> {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw httpError(400, 'workingProjectIds must be an object')
  const result: Record<string, string> = {}
  for (const [profileId, rawProjectId] of Object.entries(value)) {
    if (!profileIds.includes(profileId)) continue
    const projectId = requireText(rawProjectId, 'working project id', 100)
    result[profileId] = requiredRemoteProject(store, projectId, profileId).id
  }
  return result
}

function parseFileEndpointIds(value: unknown, files: RemoteFileSystems): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 100) throw httpError(400, 'fileEndpointIds must be an array')
  return [...new Set(value.map(item => requireText(item, 'fileEndpointId', 110)))].map(id => {
    if (files.endpoint(id) === undefined) throw httpError(404, `file endpoint ${id} was not found`)
    return id
  })
}

function parseTransferRequest(value: Record<string, unknown>) {
  const conflict = value.conflictPolicy
  if (conflict !== 'fail' && conflict !== 'skip' && conflict !== 'overwrite' && conflict !== 'rename') throw httpError(400, 'invalid conflictPolicy')
  if (!Array.isArray(value.sourcePaths)) throw httpError(400, 'sourcePaths must be an array')
  return {
    sourceEndpointId: requireText(value.sourceEndpointId, 'sourceEndpointId', 110),
    sourcePaths: value.sourcePaths.map(path => requireRawText(path, 'source path', 4096)),
    destinationEndpointId: requireText(value.destinationEndpointId, 'destinationEndpointId', 110),
    destinationDirectory: requireRawText(value.destinationDirectory, 'destinationDirectory', 4096),
    conflictPolicy: conflict as TransferConflictPolicy,
  }
}

function parseFileDeleteRequest(value: Record<string, unknown>) {
  if (!Array.isArray(value.paths) || value.paths.length < 1 || value.paths.length > 100) throw httpError(400, 'paths must contain 1-100 entries')
  const paths = [...new Set(value.paths.map(path => requireRawText(path, 'remote path', 4096)))]
  for (const path of paths) assertDeletableRemotePath(path)
  return {
    paneId: requireText(value.paneId, 'paneId', 100),
    endpointId: requireText(value.endpointId, 'endpointId', 110),
    directory: requireRawText(value.directory, 'directory', 4096),
    paths,
  }
}

function parseLocalDeleteRequest(value: Record<string, unknown>) {
  if (!Array.isArray(value.paths) || value.paths.length < 1 || value.paths.length > 100) throw httpError(400, 'paths must contain 1-100 entries')
  return {
    sessionId: requireText(value.sessionId, 'sessionId', 200),
    directory: requireRawText(value.directory, 'directory', 4096),
    paths: [...new Set(value.paths.map(path => requireRawText(path, 'local path', 4096)))],
  }
}

function parseFileMoveRequest(value: Record<string, unknown>) {
  if (!Array.isArray(value.paths) || value.paths.length < 1 || value.paths.length > 100) throw httpError(400, 'paths must contain 1-100 entries')
  return {
    paneId: requireText(value.paneId, 'paneId', 100),
    endpointId: requireText(value.endpointId, 'endpointId', 110),
    sourceDirectory: requireRawText(value.sourceDirectory, 'sourceDirectory', 4096),
    destinationDirectory: requireRawText(value.destinationDirectory, 'destinationDirectory', 4096),
    paths: [...new Set(value.paths.map(path => requireRawText(path, 'remote path', 4096)))],
  }
}

function assertDeletableRemotePath(value: string): void {
  const normalized = value.trim().replaceAll('\\', '/').replace(/\/+$/, '') || '/'
  if (normalized === '/' || normalized === '.' || normalized === '~' || /^[A-Za-z]:$/.test(normalized)) throw httpError(400, 'refusing to delete a remote filesystem root')
}

function defaultFtpPort(protocol: FtpProfile['protocol']): number { return protocol === 'ftps-implicit' ? 990 : 21 }

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

function requireRemoteFilename(value: unknown): string {
  const filename = requireText(value, 'name', 255)
  if (filename === '.' || filename === '..' || filename.includes('/') || filename.includes('\\')) throw httpError(400, 'name must be a single remote filename')
  return filename
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

async function streamSftpFile(res: ServerResponse, url: URL, runtime: SshApiRuntime, profileId: string, requestedPath: string): Promise<void> {
  const file = await openSftpFile(runtime.connector, profileId, requestedPath)
  const filename = file.path.replaceAll('\\', '/').split('/').at(-1) || 'download'
  res.statusCode = 200
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Content-Type', file.mimeType)
  res.setHeader('Content-Length', String(file.size))
  res.setHeader('Content-Disposition', `${url.searchParams.get('inline') === '1' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  try { await pipeline(file.stream, res) } finally { file.close() }
}

async function streamLocalFile(res: ServerResponse, url: URL, file: Awaited<ReturnType<typeof openLocalWorkspaceFile>>): Promise<void> {
  const filename = file.path.replaceAll('\\', '/').split('/').at(-1) || 'download'
  res.statusCode = 200
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Content-Type', file.mimeType)
  res.setHeader('Content-Length', String(file.size))
  res.setHeader('Content-Disposition', `${url.searchParams.get('inline') === '1' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  await pipeline(file.stream, res)
}

async function streamRemoteEndpointFile(req: IncomingMessage, res: ServerResponse, runtime: SshApiRuntime, endpointId: string, requestedPath: string): Promise<void> {
  const controller = new AbortController()
  let session: Awaited<ReturnType<RemoteFileSystems['connect']>> | undefined
  const abortRequest = (): void => controller.abort()
  const abortResponse = (): void => { if (!res.writableEnded) controller.abort() }
  req.once('aborted', abortRequest)
  res.once('close', abortResponse)
  try {
    session = await runtime.files.connect(endpointId, controller.signal)
    const entry = await session.stat(requestedPath, controller.signal)
    if (entry.kind !== 'file' && entry.kind !== 'directory') throw httpError(400, 'this remote entry cannot be downloaded')
    const basename = remoteName(entry.path) || remoteName(requestedPath) || 'download'
    const directory = entry.kind === 'directory'
    const tasks = directory ? await scanRemoteTree(session, [entry.path], controller.signal) : undefined
    const filename = directory ? `${basename}.tar` : basename
    res.statusCode = 200
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Type', directory ? 'application/x-tar' : 'application/octet-stream')
    if (!directory && Number.isSafeInteger(entry.size) && entry.size >= 0) res.setHeader('Content-Length', String(entry.size))
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (tasks !== undefined) await streamRemoteTar(session, tasks, res, controller.signal)
    else await session.download(entry.path, res, controller.signal)
    if (!res.writableEnded) res.end()
  } finally {
    req.off('aborted', abortRequest)
    res.off('close', abortResponse)
    session?.close()
  }
}

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
