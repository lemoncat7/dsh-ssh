import { t, tx } from './i18n.js'
import { ProxyAgent, fetch as undiciFetch } from 'undici'

const REQUEST_TIMEOUT_MESSAGE = t("GitHub request timed out.")

export interface GitHubHttpTransport {
  readonly request: typeof fetch
  route(): 'direct' | 'proxy'
  close(): Promise<void>
}

/**
 * One transport owns every GitHub request made by the plugin. The configured
 * proxy is resolved per request so changing the local SSH setting takes effect
 * without restarting DSH.
 */
export function createGitHubHttpTransport(
  configuredProxy: () => string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): GitHubHttpTransport {
  let activeProxy: string | undefined
  let agent: ProxyAgent | undefined

  const proxy = (): string | undefined => {
    const configured = configuredProxy()
    if (configured !== undefined && configured.trim() !== '') return normalizeGitHubProxy(configured)
    return firstProxy(environment.DSH_SSH_GITHUB_PROXY, environment.HTTPS_PROXY, environment.https_proxy)
  }
  const dispatcher = (value: string): ProxyAgent => {
    if (agent !== undefined && activeProxy === value) return agent
    const previous = agent
    activeProxy = value
    agent = new ProxyAgent(value)
    if (previous !== undefined) void previous.close().catch(() => {})
    return agent
  }
  const request: typeof fetch = async (input, init = {}) => {
    const proxyUrl = proxy()
    try {
      if (proxyUrl === undefined) return await fetch(input, init)
      return await undiciFetch(input as Parameters<typeof undiciFetch>[0], {
        ...init,
        dispatcher: dispatcher(proxyUrl),
      } as Parameters<typeof undiciFetch>[1]) as unknown as Response
    } catch (error) {
      throw githubConnectionError(error, proxyUrl !== undefined)
    }
  }
  return {
    request,
    route: () => proxy() === undefined ? 'direct' : 'proxy',
    async close() {
      const current = agent
      agent = undefined
      activeProxy = undefined
      if (current !== undefined) await current.close()
    },
  }
}

export function normalizeGitHubProxy(value: string): string {
  const raw = value.trim()
  if (raw.length === 0 || raw.length > 2_048) throw new Error(t("Invalid GitHub proxy address format."))
  let parsed: URL
  try { parsed = new URL(raw) } catch { throw new Error(t("Invalid GitHub proxy address format.")) }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(t("The GitHub proxy supports HTTP or HTTPS addresses only."))
  if (parsed.hostname.length === 0 || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error(t("Invalid GitHub proxy address format."))
  if (parsed.username || parsed.password) throw new Error(t("The settings page does not save proxy credentials; for an authenticated proxy use the DSH_SSH_GITHUB_PROXY environment variable."))
  return parsed.toString()
}

function firstProxy(...values: Array<string | undefined>): string | undefined {
  for (const value of values) if (value !== undefined && value.trim() !== '') return normalizeEnvironmentProxy(value)
  return undefined
}

function normalizeEnvironmentProxy(value: string): string {
  const raw = value.trim()
  let parsed: URL
  try { parsed = new URL(raw) } catch { throw new Error(t("Invalid GitHub proxy environment variable format.")) }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(t("The GitHub proxy environment variable supports HTTP or HTTPS addresses only."))
  return parsed.toString()
}

function githubConnectionError(error: unknown, proxied: boolean): Error {
  if (error instanceof Error && error.message.startsWith(t("Unable to "))) return error
  const reason = networkReason(error)
  const route = proxied ? t("connect through the configured proxy") : t("Direct")
  return new Error(tx`Unable to ${route} GitHub: ${reason}. Check “SSH settings → GitHub outbound proxy”`, { cause: error })
}

function networkReason(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') return REQUEST_TIMEOUT_MESSAGE
  if (error instanceof Error) {
    const cause = error.cause
    if (typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string') {
      if (cause.code.includes('TIMEOUT')) return REQUEST_TIMEOUT_MESSAGE
      return cause.code
    }
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return REQUEST_TIMEOUT_MESSAGE
    if (error.message && error.message !== 'fetch failed') return error.message
  }
  return t("Network request failed.")
}
