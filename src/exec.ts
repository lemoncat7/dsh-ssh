import type { ClientChannel } from 'ssh2'
import { SshConnector } from './connector.js'

export interface ExecResult {
  profileId: string
  command: string
  cwd: string
  stdout: string
  stderr: string
  exitCode: number | null
  signal: string | null
  durationMs: number
  truncated: boolean
}

export async function executeSshCommand(
  connector: SshConnector,
  profileId: string,
  command: string,
  timeoutMs: number,
  maxOutputChars: number,
  signal?: AbortSignal,
  cwd = '~',
): Promise<ExecResult> {
  if (!command.trim()) throw new Error('command must be non-empty')
  const startedAt = Date.now()
  const connection = await connector.connect(profileId, signal)
  try {
    const channel = await execChannel(connection.client, `${directoryPrelude(cwd)} && ${command}`)
    return await collect(channel, profileId, command, cwd, startedAt, timeoutMs, maxOutputChars, signal)
  } finally {
    connection.close()
  }
}

function execChannel(client: import('ssh2').Client, command: string): Promise<ClientChannel> {
  return new Promise((resolve, reject) => client.exec(command, (error, channel) => error ? reject(error) : resolve(channel)))
}

function collect(
  channel: ClientChannel,
  profileId: string,
  command: string,
  cwd: string,
  startedAt: number,
  timeoutMs: number,
  maxOutputChars: number,
  signal?: AbortSignal,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let exitCode: number | null = null
    let exitSignal: string | null = null
    let truncated = false
    let settled = false
    const append = (target: 'stdout' | 'stderr', text: string): void => {
      if (target === 'stdout') stdout += text
      else stderr += text
      const total = stdout.length + stderr.length
      if (total > maxOutputChars) {
        const overflow = total - maxOutputChars
        if (stderr.length >= overflow) stderr = stderr.slice(overflow)
        else { const remainder = overflow - stderr.length; stderr = ''; stdout = stdout.slice(remainder) }
        truncated = true
      }
    }
    const cleanup = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
    const finish = (): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve({ profileId, command, cwd, stdout, stderr, exitCode, signal: exitSignal, durationMs: Date.now() - startedAt, truncated })
    }
    const fail = (error: Error): void => { if (settled) return; settled = true; cleanup(); reject(error) }
    const abort = (): void => { channel.close(); fail(signal?.reason instanceof Error ? signal.reason : new Error('SSH command was aborted')) }
    const timer = setTimeout(() => { channel.close(); fail(Object.assign(new Error(`SSH command timed out after ${timeoutMs} ms`), { code: 'COMMAND_TIMEOUT' })) }, timeoutMs)
    channel.setEncoding('utf8')
    channel.on('data', (chunk: string | Buffer) => append('stdout', String(chunk)))
    channel.stderr.setEncoding('utf8')
    channel.stderr.on('data', (chunk: string | Buffer) => append('stderr', String(chunk)))
    channel.once('exit', (code: number | undefined, signalName: string | undefined) => { exitCode = code ?? null; exitSignal = signalName ?? null })
    channel.once('close', finish)
    channel.once('error', fail)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export function directoryPrelude(cwd: string): string {
  if (cwd === '~') return 'cd -- "$HOME"'
  if (cwd.startsWith('~/')) return `cd -- "$HOME"/${shellQuote(cwd.slice(2))}`
  return `cd -- ${shellQuote(cwd)}`
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}
