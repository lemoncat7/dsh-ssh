import type { Context } from '@deepseek-ai/cordis'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { Config as ConfigSchema, resolveConfig, type Config as SshConfig } from './config.js'
import { registerSshApi, type WebServerLike } from './api.js'
import { SshConnector } from './connector.js'
import { SshCredentialVault } from './credentials.js'
import { ForwardManager } from './forwards.js'
import { SshStore } from './store.js'
import { AiTerminalManager, BrowserTerminalManager } from './terminal.js'
import { registerSshTools } from './tools.js'

export const Config = ConfigSchema
export type Config = SshConfig
export * from './domain.js'
export const name = 'dsh-ssh'
export const inject = ['credentials', 'tools']

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
    const connector = new SshConnector(store, credentials)
    const forwards = new ForwardManager(connector, store)
    const terminals = new BrowserTerminalManager(connector)
    const aiTerminals = new AiTerminalManager(connector)
    registerSshTools(context, store, connector, forwards, aiTerminals)
    let disposeApi: (() => void) | undefined
    const mountApi = (runtime: RuntimeContext): void => {
      if (!resolved.exposeWeb) return
      const webServer = runtime.webServer ?? runtime.get('webServer') as WebServerLike | undefined
      if (webServer === undefined) throw new Error('dsh-ssh exposeWeb requires webServer')
      disposeApi = registerSshApi(webServer, resolved.apiPrefix, { store, credentials, connector, forwards, terminals, aiTerminals })
    }
    if (ctx.inject !== undefined) ctx.inject(['webServer'], mountApi)
    else if (ctx.webServer !== undefined) mountApi(ctx)
    else ctx.logger.warn('dsh-ssh: webServer is unavailable; browser management is disabled')
    await forwards.startAuto()
    ctx.logger.info(`dsh-ssh: ready with ${store.profiles().length} profiles`)
    return async () => {
      disposeApi?.()
      await terminals.closeAll()
      await aiTerminals.closeAll()
      await forwards.closeAll()
    }
  }, 'dsh-ssh.runtime')
}
