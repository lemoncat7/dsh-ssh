import type { Context } from '@deepseek-ai/cordis'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { Config as ConfigSchema, resolveConfig, type Config as SshConfig } from './config.js'
import { registerSshApi, type WebServerLike } from './api.js'
import { SshConnector } from './connector.js'
import { SshCredentialVault } from './credentials.js'
import { ForwardManager } from './forwards.js'
import { SshStore } from './store.js'
import { AiTerminalManager, BrowserTerminalManager } from './terminal.js'
import { registerSshTools } from './tools.js'
import { ActivityEventBus } from './activity-events.js'
import { NetworkDialer } from './network-dialer.js'
import { SftpFileSystemAdapter } from './sftp-adapter.js'
import { FtpFileSystemAdapter } from './ftp-adapter.js'
import { RemoteFileSystems } from './remote-file-systems.js'
import { FileTransferManager } from './file-transfer-manager.js'
import { EndpointSessionManager } from './endpoint-session-manager.js'
import { GistSyncService, GistTokenVault } from './gist-sync.js'

export const Config = ConfigSchema
export type Config = SshConfig
export * from './domain.js'
export const name = 'dsh-ssh'
export const inject = ['credentials', 'tools', 'agents', 'systemPrompt']

type RuntimeContext = Context & {
  credentials: CredentialProvider
  webServer?: WebServerLike
  inject?(services: string[], callback: (ctx: RuntimeContext) => void): unknown
}

export function apply(context: Context, config: SshConfig): void {
  const ctx = context as RuntimeContext
  const resolved = resolveConfig(config)
  ctx.effect(async () => {
    const store = await SshStore.open(resolved.statePath, {
      allowPublicBind: resolved.allowPublicBind,
      defaultCommandTimeoutMs: resolved.defaultCommandTimeoutMs,
      maxOutputChars: resolved.maxOutputChars,
    })
    const credentials = new SshCredentialVault(ctx.credentials)
    const gistSync = await GistSyncService.open(store, credentials, new GistTokenVault(ctx.credentials), `${resolved.statePath}.gist-sync.json`)
    const connector = new SshConnector(store, credentials)
    const dialer = new NetworkDialer(store, credentials)
    const files = new RemoteFileSystems([
      new SftpFileSystemAdapter(store, connector),
      new FtpFileSystemAdapter(store, credentials, dialer),
    ])
    const transfers = new FileTransferManager(files)
    const fileSessions = new EndpointSessionManager(files)
    const forwards = new ForwardManager(connector, store)
    const terminals = new BrowserTerminalManager(connector)
    const activityEvents = new ActivityEventBus()
    const aiTerminals = new AiTerminalManager(connector, event => { activityEvents.publish(event) })
    const disposeTools = registerSshTools(context, store, connector, forwards, aiTerminals, files, transfers)
    let disposeApi: (() => void) | undefined
    const mountApi = (runtime: RuntimeContext): void => {
      if (!resolved.exposeWeb) return
      const webServer = runtime.webServer ?? runtime.get('webServer') as WebServerLike | undefined
      if (webServer === undefined) throw new Error('dsh-ssh exposeWeb requires webServer')
      disposeApi = registerSshApi(webServer, resolved.apiPrefix, {
        store, credentials, gistSync, connector, dialer, files, transfers, fileSessions, forwards, terminals, aiTerminals, activityEvents,
        sessionCwd: sessionId => runtime.agents.get(sessionId as SessionId)?.session.header.cwd,
      })
    }
    if (ctx.inject !== undefined) ctx.inject(['webServer'], mountApi)
    else if (ctx.webServer !== undefined) mountApi(ctx)
    else ctx.logger.warn('dsh-ssh: webServer is unavailable; browser management is disabled')
    await forwards.startAuto()
    ctx.logger.info(`dsh-ssh: ready with ${store.profiles().length} profiles`)
    return async () => {
      disposeTools()
      disposeApi?.()
      await terminals.closeAll()
      await aiTerminals.closeAll()
      await transfers.closeAll()
      fileSessions.closeAll()
      await forwards.closeAll()
      await gistSync.close()
    }
  }, 'dsh-ssh.runtime')
}
