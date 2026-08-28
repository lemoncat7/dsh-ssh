import { SshConnector } from './connector.js'
import type { RemoteEndpointView, RemoteFileSystemAdapter, RemoteFileSystemSession } from './remote-files.js'
import { endpointId } from './remote-files.js'
import { openSftpFileSystemSession } from './sftp.js'
import { SshStore } from './store.js'

export class SftpFileSystemAdapter implements RemoteFileSystemAdapter {
  readonly kind = 'sftp' as const
  constructor(private readonly store: SshStore, private readonly connector: SshConnector) {}

  endpoint(id: string): RemoteEndpointView | undefined {
    const profile = this.store.profile(id)
    return profile === undefined ? undefined : {
      id: endpointId('sftp', profile.id), kind: 'sftp', protocol: 'sftp', name: profile.name,
      ...(profile.group === undefined ? {} : { group: profile.group }),
      address: `${profile.username}@${profile.host}:${profile.port}`, initialPath: '~',
    }
  }

  endpoints(): RemoteEndpointView[] { return this.store.profiles().map(profile => this.endpoint(profile.id)!).filter(Boolean) }

  async connect(id: string, signal?: AbortSignal): Promise<RemoteFileSystemSession> {
    signal?.throwIfAborted()
    const endpoint = this.endpoint(id)
    if (endpoint === undefined) throw Object.assign(new Error(`SFTP endpoint ${id} was not found`), { status: 404 })
    return openSftpFileSystemSession(this.connector, id, endpoint, signal)
  }
}
