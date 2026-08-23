import { executeSshCommand, type ExecResult } from './exec.js'
import { SshConnector } from './connector.js'
import type { SessionInjection } from './domain.js'
import { SshStore } from './store.js'

const DIRECTORY_PROBE_TIMEOUT_MS = 10_000
const DIRECTORY_PROBE_OUTPUT_CHARS = 8_192

export function sessionDirectory(injection: SessionInjection, profileId: string): string {
  return injection.workingDirectories[profileId] ?? '~'
}

export async function resolveRemoteDirectory(
  connector: SshConnector,
  profileId: string,
  requested: string,
  signal?: AbortSignal,
): Promise<string> {
  const cwd = normalizeRemoteDirectory(requested)
  const result = await executeSshCommand(
    connector,
    profileId,
    'pwd -P',
    DIRECTORY_PROBE_TIMEOUT_MS,
    DIRECTORY_PROBE_OUTPUT_CHARS,
    signal,
    cwd,
  )
  if (result.exitCode !== 0) throw directoryProbeError(result)
  const resolved = result.stdout.trim().split(/\r?\n/).at(-1)?.trim()
  if (!resolved?.startsWith('/')) throw new Error('SSH directory did not resolve to an absolute path')
  return normalizeRemoteDirectory(resolved)
}

export async function setSessionDirectory(
  store: SshStore,
  connector: SshConnector,
  sessionId: string,
  profileId: string,
  requested: string,
  signal?: AbortSignal,
): Promise<string> {
  const injection = store.injection(sessionId)
  if (injection === undefined || !injection.profileIds.includes(profileId)) {
    throw Object.assign(new Error('SSH profile is not injected into this DSH session'), { status: 403 })
  }
  const cwd = await resolveRemoteDirectory(connector, profileId, requested, signal)
  await store.update(state => {
    const current = state.injections.find(item => item.sessionId === sessionId)
    if (current === undefined || !current.profileIds.includes(profileId)) throw new Error('SSH session injection changed while resolving the directory')
    current.workingDirectories[profileId] = cwd
    current.updatedAt = Date.now()
  })
  return cwd
}

export function normalizeRemoteDirectory(value: unknown): string {
  if (typeof value !== 'string') throw Object.assign(new Error('cwd must be a string'), { status: 400 })
  const cwd = value.trim()
  if (cwd.length === 0 || cwd.length > 4096 || /[\0\r\n]/.test(cwd)) {
    throw Object.assign(new Error('cwd must contain 1-4096 characters without line breaks'), { status: 400 })
  }
  return cwd
}

function directoryProbeError(result: ExecResult): Error {
  const detail = result.stderr.trim() || result.stdout.trim() || `exit ${String(result.exitCode)}`
  return Object.assign(new Error(`Cannot use SSH directory: ${detail}`), { status: 400 })
}
