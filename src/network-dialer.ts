import type { Socket } from 'node:net'
import type { FtpProxyConfig } from './domain.js'
import { SshCredentialVault } from './credentials.js'
import { connectHttpProxy, connectSocket, connectSocks5Proxy } from './proxy.js'
import { SshStore } from './store.js'

/** Opens one routed TCP socket. FTP control and passive data channels share this boundary. */
export class NetworkDialer {
  constructor(private readonly store: SshStore, private readonly credentials: SshCredentialVault) {}

  async connect(host: string, port: number, route: FtpProxyConfig, timeoutMs: number, signal?: AbortSignal): Promise<Socket> {
    signal?.throwIfAborted()
    if (route.type === 'none') return connectSocket(host, port, timeoutMs, signal)
    const proxy = this.store.proxyEntry(route.proxyId)
    if (proxy === undefined) throw Object.assign(new Error(`proxy entry ${route.proxyId} was not found`), { status: 404 })
    const secrets = await this.credentials.readProxyEntry(proxy.id)
    const auth = {
      ...(proxy.username === undefined ? {} : { username: proxy.username }),
      ...(secrets.proxyPassword === undefined ? {} : { password: secrets.proxyPassword }),
    }
    return proxy.proxyType === 'http'
      ? connectHttpProxy(proxy.host, proxy.port, host, port, auth, timeoutMs, signal)
      : connectSocks5Proxy(proxy.host, proxy.port, host, port, auth, timeoutMs, signal)
  }
}
