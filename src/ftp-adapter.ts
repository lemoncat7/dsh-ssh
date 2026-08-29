import net from 'node:net'
import tls, { type TLSSocket } from 'node:tls'
import type { Readable, Writable } from 'node:stream'
import { Client, FTPError, type FTPContext, type FTPResponse, type FileInfo } from 'basic-ftp'
import { SshCredentialVault } from './credentials.js'
import type { FtpProfile } from './domain.js'
import { NetworkDialer } from './network-dialer.js'
import type { RemoteDirectoryView, RemoteEndpointView, RemoteFileEntry, RemoteFileSystemAdapter, RemoteFileSystemSession } from './remote-files.js'
import { endpointId, remoteJoin, remoteName, remoteParent, sortRemoteEntries } from './remote-files.js'
import { SshStore } from './store.js'

export class FtpFileSystemAdapter implements RemoteFileSystemAdapter {
  readonly kind = 'ftp' as const
  constructor(private readonly store: SshStore, private readonly credentials: SshCredentialVault, private readonly dialer: NetworkDialer) {}

  endpoint(id: string): RemoteEndpointView | undefined {
    const profile = this.store.ftpProfile(id)
    return profile === undefined ? undefined : ftpEndpoint(this.resolveProfile(profile))
  }

  endpoints(): RemoteEndpointView[] { return this.store.ftpProfiles().map(profile => ftpEndpoint(this.resolveProfile(profile))) }

  async connect(id: string, signal?: AbortSignal): Promise<RemoteFileSystemSession> {
    const profile = this.store.ftpProfile(id)
    if (profile === undefined) throw Object.assign(new Error(`FTP endpoint ${id} was not found`), { status: 404 })
    const entry = profile.credentialId === undefined ? undefined : this.store.credentialEntry(profile.credentialId)
    if (profile.credentialId !== undefined && (entry === undefined || entry.authType !== 'password')) throw new Error('FTP password credential entry was not found')
    const secrets = entry === undefined ? await this.credentials.readFtp(profile.id) : await this.credentials.readEntry(entry.id)
    if (!secrets.password) throw Object.assign(new Error('FTP password is not configured'), { code: 'CREDENTIAL_MISSING' })
    const resolved = entry === undefined ? profile : { ...profile, username: entry.username }
    return FtpFileSystemSession.open(ftpEndpoint(resolved), resolved, secrets.password, this.dialer, signal)
  }

  private resolveProfile(profile: FtpProfile): FtpProfile {
    if (profile.credentialId === undefined) return profile
    const entry = this.store.credentialEntry(profile.credentialId)
    return entry?.authType === 'password' ? { ...profile, username: entry.username } : profile
  }
}

export async function connectFtpProfile(profile: FtpProfile, password: string, dialer: NetworkDialer, signal?: AbortSignal): Promise<RemoteFileSystemSession> {
  return FtpFileSystemSession.open(ftpEndpoint(profile), profile, password, dialer, signal)
}

class FtpFileSystemSession implements RemoteFileSystemSession {
  private closed = false
  private constructor(readonly endpoint: RemoteEndpointView, private readonly profile: FtpProfile, private readonly client: Client) {}

  static async open(endpoint: RemoteEndpointView, profile: FtpProfile, password: string, dialer: NetworkDialer, signal?: AbortSignal): Promise<FtpFileSystemSession> {
    signal?.throwIfAborted()
    const client = new Client(profile.connectTimeoutMs, { allowSeparateTransferHost: false })
    client.prepareTransfer = createPassiveTransfer(profile, dialer, signal)
    const tlsOptions: tls.ConnectionOptions = {
      host: profile.host,
      rejectUnauthorized: true,
      ...(net.isIP(profile.tlsServerName ?? profile.host) === 0 ? { servername: profile.tlsServerName ?? profile.host } : {}),
    }
    try {
      const raw = await dialer.connect(profile.host, profile.port, profile.proxy, profile.connectTimeoutMs, signal)
      if (profile.protocol === 'ftps-implicit') {
        const secure = tls.connect({ ...tlsOptions, socket: raw })
        const welcome = handleWelcome(client)
        client.ftp.socket = secure
        await Promise.all([waitForSecureConnect(secure, signal), welcome])
        client.ftp.tlsOptions = tlsOptions
      } else {
        const welcome = handleWelcome(client)
        client.ftp.socket = raw
        await welcome
        if (profile.protocol === 'ftps-explicit') await client.useTLS(tlsOptions)
      }
      await client.login(profile.username, password)
      await client.useDefaultSettings()
      if (profile.initialPath !== '/') await client.cd(profile.initialPath)
      return new FtpFileSystemSession(endpoint, profile, client)
    } catch (error) {
      client.close()
      throw error
    }
  }

  async list(value: string, signal?: AbortSignal): Promise<RemoteDirectoryView> {
    const requested = value.trim() || this.profile.initialPath
    const resolved = await this.resolveDirectory(requested, signal)
    const entries: RemoteFileEntry[] = []
    for (const entry of await this.run(this.client.list(resolved), signal)) {
      const mapped = ftpEntry(resolved, entry)
      if (mapped.kind === 'symlink' || mapped.kind === 'other') {
        mapped.navigable = await this.isDirectory(mapped.path, signal)
      }
      entries.push(mapped)
    }
    return { path: resolved, parent: remoteParent(resolved), entries: sortRemoteEntries(entries) }
  }

  async stat(value: string, signal?: AbortSignal): Promise<RemoteFileEntry> {
    const normalized = value.replaceAll('\\', '/').replace(/\/+$/, '') || '/'
    if (normalized === '/') return { name: '/', path: '/', kind: 'directory', size: 0, modifiedAt: 0 }
    const parent = remoteParent(normalized) ?? '/'
    const match = (await this.list(parent, signal)).entries.find(entry => entry.name === remoteName(normalized))
    if (match === undefined) throw Object.assign(new Error(`remote path ${value} was not found`), { status: 404 })
    return match
  }

  async download(value: string, destination: Writable, signal?: AbortSignal): Promise<void> {
    await this.run(this.client.downloadTo(destination, value), signal)
  }

  async upload(value: string, source: Readable, overwrite: boolean, signal?: AbortSignal): Promise<void> {
    if (!overwrite) {
      try { await this.stat(value, signal); throw Object.assign(new Error('A file with this name already exists'), { status: 409 }) }
      catch (error) { if ((error as { status?: number }).status !== 404) throw error }
    }
    await this.run(this.client.uploadFrom(source, value), signal)
  }

  async ensureDirectory(value: string, signal?: AbortSignal): Promise<void> { await this.run(this.client.ensureDir(value), signal) }

  async move(sourcePath: string, destinationPath: string, signal?: AbortSignal): Promise<void> {
    try { await this.stat(destinationPath, signal); throw Object.assign(new Error('destination already contains an entry with this name'), { status: 409 }) }
    catch (error) { if ((error as { status?: number }).status !== 404) throw error }
    await this.run(this.client.rename(sourcePath, destinationPath), signal)
  }

  async remove(value: string, recursive: boolean, signal?: AbortSignal): Promise<void> {
    const entry = await this.stat(value, signal)
    if (entry.kind === 'directory') {
      if (!recursive) throw Object.assign(new Error('remote path is a directory'), { status: 409 })
      await this.run(this.client.removeDir(value), signal)
      return
    }
    await this.run(this.client.remove(value), signal)
  }

  close(): void { if (!this.closed) { this.closed = true; this.client.close() } }

  private async resolveDirectory(value: string, signal?: AbortSignal): Promise<string> {
    const previous = await this.run(this.client.pwd(), signal)
    try { await this.run(this.client.cd(value), signal); return await this.run(this.client.pwd(), signal) }
    finally { await this.run(this.client.cd(previous), signal).catch(() => {}) }
  }

  private async isDirectory(value: string, signal?: AbortSignal): Promise<boolean> {
    try { await this.resolveDirectory(value, signal); return true }
    catch { signal?.throwIfAborted(); return false }
  }

  private async run<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.closed) throw new Error('FTP session is closed')
    signal?.throwIfAborted()
    if (signal === undefined) return operation
    const abort = (): void => this.close()
    signal.addEventListener('abort', abort, { once: true })
    try { return await operation }
    finally { signal.removeEventListener('abort', abort) }
  }
}

function createPassiveTransfer(profile: FtpProfile, dialer: NetworkDialer, defaultSignal?: AbortSignal) {
  return async (ftp: FTPContext): Promise<FTPResponse> => {
    let response: FTPResponse
    let port: number
    try {
      response = await ftp.request('EPSV')
      port = parseEpsvPort(response.message)
    } catch {
      response = await ftp.request('PASV')
      port = parsePasvPort(response.message)
    }
    const raw = await dialer.connect(profile.host, port, profile.proxy, profile.connectTimeoutMs, defaultSignal)
    let socket: typeof raw | TLSSocket = raw
    if (ftp.hasTLS) {
      socket = tls.connect({
        ...ftp.tlsOptions,
        socket: raw,
        session: ftp.tlsSessionStore ?? (ftp.socket as TLSSocket).getSession(),
      })
      socket.on('session', session => { ftp.tlsSessionStore = session })
    }
    ftp.dataSocket = socket
    return response
  }
}

function handleWelcome(client: Client): Promise<FTPResponse> {
  return client.ftp.handle(undefined, (response, task) => {
    if (response instanceof Error) task.reject(response)
    else if (response.code >= 200 && response.code < 300) task.resolve(response)
    else task.reject(new FTPError(response))
  }) as Promise<FTPResponse>
}

function waitForSecureConnect(socket: TLSSocket, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = (): void => { cleanup(); socket.destroy(); reject(signal?.reason instanceof Error ? signal.reason : new Error('FTPS connection was aborted')) }
    const ready = (): void => { cleanup(); resolve() }
    const failed = (error: Error): void => { cleanup(); reject(error) }
    const cleanup = (): void => { signal?.removeEventListener('abort', abort); socket.off('secureConnect', ready); socket.off('error', failed) }
    signal?.addEventListener('abort', abort, { once: true })
    socket.once('secureConnect', ready)
    socket.once('error', failed)
  })
}

function parseEpsvPort(message: string): number {
  const value = /[|!]{3}(\d+)[|!]/.exec(message)?.[1]
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error(`invalid EPSV response: ${message}`)
  return port
}

function parsePasvPort(message: string): number {
  const match = /(?:\d+,){3}\d+,(\d+),(\d+)/.exec(message)
  if (match === null) throw new Error(`invalid PASV response: ${message}`)
  const port = (Number(match[1]) & 255) * 256 + (Number(match[2]) & 255)
  if (port < 1 || port > 65_535) throw new Error(`invalid PASV response: ${message}`)
  return port
}

function ftpEntry(directory: string, entry: FileInfo): RemoteFileEntry {
  return {
    name: entry.name, path: remoteJoin(directory, entry.name),
    kind: entry.isDirectory ? 'directory' : entry.isFile ? 'file' : entry.isSymbolicLink ? 'symlink' : 'other',
    size: entry.size, modifiedAt: entry.modifiedAt?.getTime() ?? 0,
  }
}

function ftpEndpoint(profile: FtpProfile): RemoteEndpointView {
  return {
    id: endpointId('ftp', profile.id), kind: 'ftp', protocol: profile.protocol, name: profile.name,
    ...(profile.group === undefined ? {} : { group: profile.group }),
    address: `${profile.username}@${profile.host}:${profile.port}`, initialPath: profile.initialPath,
  }
}
