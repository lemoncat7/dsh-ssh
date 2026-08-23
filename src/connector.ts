import ssh2, { type Client as SshClient, type ConnectConfig, type ClientChannel } from 'ssh2'
import type { Duplex } from 'node:stream'
import { connectHttpProxy, connectSocks5Proxy } from './proxy.js'
import { SshCredentialVault } from './credentials.js'
import type { SshCredentialPayload, SshProfile } from './domain.js'
import { SshStore } from './store.js'

export class HostKeyRequiredError extends Error {
  readonly code = 'HOST_KEY_REQUIRED'
  constructor(readonly profileId: string, readonly fingerprint: string) {
    super(`Host key confirmation required for ${profileId}: ${fingerprint}`)
    this.name = 'HostKeyRequiredError'
  }
}

export class SshConnector {
  constructor(private readonly store: SshStore, private readonly credentials: SshCredentialVault) {}

  async connect(profileId: string, signal?: AbortSignal): Promise<ManagedSshConnection> {
    return this.connectRecursive(profileId, new Set(), signal)
  }

  async connectDraft(profile: SshProfile, secrets: SshCredentialPayload, signal?: AbortSignal): Promise<ManagedSshConnection> {
    const identity = profile.credentialId === undefined ? { profile, secrets } : await this.resolveIdentity(profile)
    return this.connectResolved(identity.profile, identity.secrets, new Set([profile.id]), signal)
  }

  private async connectRecursive(profileId: string, chain: Set<string>, signal?: AbortSignal): Promise<ManagedSshConnection> {
    signal?.throwIfAborted()
    if (chain.has(profileId)) throw new Error(`SSH jump proxy cycle detected at ${profileId}`)
    const storedProfile = this.store.profile(profileId)
    if (storedProfile === undefined) throw Object.assign(new Error(`SSH profile ${profileId} was not found`), { status: 404 })
    const { profile, secrets } = await this.resolveIdentity(storedProfile)
    const nextChain = new Set(chain).add(profileId)
    return this.connectResolved(profile, secrets, nextChain, signal)
  }

  private async connectResolved(profile: SshProfile, secrets: SshCredentialPayload, chain: Set<string>, signal?: AbortSignal): Promise<ManagedSshConnection> {
    signal?.throwIfAborted()
    let socket: Duplex | undefined
    let parent: ManagedSshConnection | undefined
    try {
      if (profile.proxy.type === 'http') {
        socket = await connectHttpProxy(profile.proxy.host, profile.proxy.port, profile.host, profile.port, {
          ...profile.proxy.username === undefined ? {} : { username: profile.proxy.username },
          ...secrets.proxyPassword === undefined ? {} : { password: secrets.proxyPassword },
        }, profile.connectTimeoutMs)
      } else if (profile.proxy.type === 'socks5') {
        socket = await connectSocks5Proxy(profile.proxy.host, profile.proxy.port, profile.host, profile.port, {
          ...profile.proxy.username === undefined ? {} : { username: profile.proxy.username },
          ...secrets.proxyPassword === undefined ? {} : { password: secrets.proxyPassword },
        }, profile.connectTimeoutMs)
      } else if (profile.proxy.type === 'jump') {
        parent = await this.connectJumpChain(profile.proxy.profileIds, chain, signal)
        socket = await forwardOut(parent.client, profile.host, profile.port)
      }
      const client = await connectClient(profile, secrets, socket, signal)
      return new ManagedSshConnection(client, profile, parent)
    } catch (error) {
      socket?.destroy()
      parent?.close()
      throw error
    }
  }

  private async connectJumpChain(profileIds: string[], chain: Set<string>, signal?: AbortSignal): Promise<ManagedSshConnection> {
    let parent: ManagedSshConnection | undefined
    let visited = new Set(chain)
    try {
      for (const profileId of profileIds) {
        signal?.throwIfAborted()
        if (visited.has(profileId)) throw new Error(`SSH jump proxy cycle detected at ${profileId}`)
        if (parent === undefined) {
          parent = await this.connectRecursive(profileId, visited, signal)
        } else {
          const storedProfile = this.store.profile(profileId)
          if (storedProfile === undefined) throw Object.assign(new Error(`SSH profile ${profileId} was not found`), { status: 404 })
          const { profile, secrets } = await this.resolveIdentity(storedProfile)
          const socket = await forwardOut(parent.client, profile.host, profile.port)
          try {
            const client = await connectClient(profile, secrets, socket, signal)
            parent = new ManagedSshConnection(client, profile, parent)
          } catch (error) {
            socket.destroy()
            throw error
          }
        }
        visited = new Set(visited).add(profileId)
      }
      if (parent === undefined) throw new Error('SSH jump proxy chain is empty')
      return parent
    } catch (error) {
      parent?.close()
      throw error
    }
  }

  private async resolveIdentity(profile: SshProfile): Promise<{ profile: SshProfile; secrets: Awaited<ReturnType<SshCredentialVault['read']>> }> {
    if (profile.credentialId === undefined) return { profile, secrets: await this.credentials.read(profile.id) }
    const entry = this.store.credentialEntry(profile.credentialId)
    if (entry === undefined) throw new Error(`SSH credential entry ${profile.credentialId} was not found`)
    return {
      profile: { ...profile, username: entry.username, authType: entry.authType },
      secrets: await this.credentials.readEntry(entry.id),
    }
  }
}

export class ManagedSshConnection {
  private closed = false
  constructor(readonly client: SshClient, readonly profile: SshProfile, private readonly parent?: ManagedSshConnection) {}
  close(): void {
    if (this.closed) return
    this.closed = true
    this.client.end()
    this.parent?.close()
  }
}

async function connectClient(
  profile: SshProfile,
  secrets: Awaited<ReturnType<SshCredentialVault['read']>>,
  socket: Duplex | undefined,
  signal?: AbortSignal,
): Promise<SshClient> {
  const config: ConnectConfig = {
    host: profile.host,
    port: profile.port,
    username: profile.username,
    readyTimeout: profile.connectTimeoutMs,
    keepaliveInterval: profile.keepAliveIntervalMs,
    keepaliveCountMax: 3,
    hostHash: 'sha256',
    ...socket === undefined ? {} : { sock: socket },
  }
  if (profile.authType === 'password') {
    if (!secrets.password) throw Object.assign(new Error('SSH password is not configured'), { code: 'CREDENTIAL_MISSING' })
    config.password = secrets.password
  } else if (profile.authType === 'private-key') {
    if (!secrets.privateKey) throw Object.assign(new Error('SSH private key is not configured'), { code: 'CREDENTIAL_MISSING' })
    config.privateKey = secrets.privateKey
    if (secrets.passphrase) config.passphrase = secrets.passphrase
  } else {
    const agent = process.env.SSH_AUTH_SOCK
    if (!agent) throw Object.assign(new Error('SSH_AUTH_SOCK is not available in this DSH process'), { code: 'CREDENTIAL_MISSING' })
    config.agent = agent
  }
  let observedFingerprint: string | undefined
  config.hostVerifier = (fingerprint: string) => {
    observedFingerprint = `SHA256:${fingerprint}`
    return profile.hostFingerprint !== undefined && timingSafeEqualText(profile.hostFingerprint, observedFingerprint)
  }
  const client = new ssh2.Client()
  return new Promise((resolve, reject) => {
    let settled = false
    const abort = (): void => { client.end(); finishReject(signal?.reason instanceof Error ? signal.reason : new Error('SSH connection was aborted')) }
    const cleanup = (): void => {
      signal?.removeEventListener('abort', abort)
      client.off('ready', ready)
      client.off('error', failed)
    }
    const finishReject = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      if (profile.hostFingerprint === undefined && observedFingerprint !== undefined) reject(new HostKeyRequiredError(profile.id, observedFingerprint))
      else reject(error)
    }
    const ready = (): void => { if (settled) return; settled = true; cleanup(); resolve(client) }
    const failed = (error: Error): void => finishReject(error)
    signal?.addEventListener('abort', abort, { once: true })
    client.once('ready', ready)
    client.once('error', failed)
    try { client.connect(config) } catch (error) { finishReject(error instanceof Error ? error : new Error(String(error))) }
  })
}

function forwardOut(client: SshClient, host: string, port: number): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    client.forwardOut('127.0.0.1', 0, host, port, (error, channel) => error ? reject(error) : resolve(channel))
  })
}

function timingSafeEqualText(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return mismatch === 0
}
