import { randomUUID } from 'node:crypto'
import type { ClientChannel } from 'ssh2'
import type {
  TerminalBackend, TerminalBackendSession, TerminalBackendSpawnSpec, TerminalReadRequest,
  TerminalReadResult, TerminalSendOperation, TerminalSendRequest, TerminalSendResult,
  TerminalSessionStatus, TerminalSignal, TerminalSignalResult,
} from '@deepseek-ai/dsh-terminal'
import { SshConnector, type ManagedSshConnection } from './connector.js'
import { SshStore } from './store.js'
import { directoryPrelude } from './exec.js'

const MAX_SCROLLBACK_CHARS = 256_000

export class SshTerminalBackend implements TerminalBackend {
  readonly type = 'ssh'
  constructor(private readonly connector: SshConnector, private readonly store: SshStore) {}

  async spawn(spec: TerminalBackendSpawnSpec): Promise<TerminalBackendSession> {
    const profileId = spec.cwd?.trim()
    if (!profileId) throw new Error('SSH terminal backend requires the injected profile id as cwd')
    const injection = this.store.injection(spec.owner.session.id)
    if (injection === undefined || !injection.profileIds.includes(profileId)) throw new Error('This SSH profile is not injected into the current DSH session')
    if (injection.permission !== 'terminal') throw new Error('This SSH injection allows one-shot commands only')
    const connection = await this.connector.connect(profileId, spec.signal)
    try {
      const channel = await openShell(connection, 120, 32)
      return new SshTerminalSession(connection, channel, `Connected to ${connection.profile.name} (${connection.profile.username}@${connection.profile.host})`)
    } catch (error) {
      connection.close()
      throw error
    }
  }
}

export class SshTerminalSession implements TerminalBackendSession {
  readonly motd: string
  private scrollback = ''
  private terminalStatus: TerminalSessionStatus = { kind: 'running' }
  private active: SendOperation | undefined
  private closing?: Promise<void>

  constructor(private readonly connection: ManagedSshConnection, readonly channel: ClientChannel, motd: string) {
    this.motd = motd
    channel.setEncoding('utf8')
    channel.on('data', (chunk: string | Buffer) => this.receive(String(chunk)))
    channel.stderr?.setEncoding('utf8')
    channel.stderr?.on('data', (chunk: string | Buffer) => this.receive(String(chunk)))
    channel.on('exit', (code: number | undefined, signal: string | undefined) => {
      this.terminalStatus = { kind: 'exited', exitCode: code ?? null, signal: normalizeSignal(signal) }
      this.active?.settle('session_exit')
    })
    channel.on('close', () => {
      if (this.terminalStatus.kind === 'running') this.terminalStatus = { kind: 'exited', exitCode: null, signal: null }
      this.active?.settle('session_exit')
      connection.close()
    })
  }

  startSend(request: TerminalSendRequest): TerminalSendOperation {
    if (this.terminalStatus.kind === 'exited') throw new Error('SSH terminal has exited')
    if (this.active !== undefined) throw new Error('SSH terminal already has an active send')
    const operation = new SendOperation(this, request)
    this.active = operation
    operation.done.finally(() => { if (this.active === operation) this.active = undefined }).catch(() => {})
    this.channel.write(request.submit ? `${request.text}\n` : request.text)
    return operation
  }

  read(request: TerminalReadRequest): TerminalReadResult {
    const lines = this.scrollback.split(/\r?\n/)
    const totalLines = lines.length
    const offset = clamp(request.offset ?? 0, 0, totalLines)
    const count = clamp(request.count ?? 200, 1, 2000)
    const lineEnd = totalLines - offset
    const lineBegin = Math.max(0, lineEnd - count)
    return {
      text: lines.slice(lineBegin, lineEnd).join('\n'),
      totalLines,
      lineBegin,
      lineEnd,
      truncated: this.scrollback.length >= MAX_SCROLLBACK_CHARS || lineBegin > 0,
    }
  }

  write(text: string): void {
    if (this.terminalStatus.kind === 'exited') throw new Error('SSH terminal has exited')
    this.channel.write(text)
  }

  resize(cols: number, rows: number): void {
    if (this.terminalStatus.kind === 'exited') return
    this.channel.setWindow(rows, cols, 0, 0)
  }

  async signal(signal: TerminalSignal): Promise<TerminalSignalResult> {
    this.channel.signal(signal.replace(/^SIG/, ''))
    return { delivered: true, targetPgid: 0 }
  }

  status(): TerminalSessionStatus { return this.terminalStatus }

  close(_reason: string): Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.closing = new Promise(resolve => {
      if (this.terminalStatus.kind === 'exited') { this.connection.close(); return resolve() }
      const timer = setTimeout(() => { this.channel.destroy(); this.connection.close(); resolve() }, 1500)
      this.channel.once('close', () => { clearTimeout(timer); this.connection.close(); resolve() })
      this.channel.end()
    })
    return this.closing
  }

  receive(text: string): void {
    this.scrollback = `${this.scrollback}${text}`.slice(-MAX_SCROLLBACK_CHARS)
    this.active?.push(text)
  }

  snapshotStatus(): TerminalSessionStatus { return this.terminalStatus }
}

class SendOperation implements TerminalSendOperation {
  readonly done: Promise<TerminalSendResult>
  private resolveDone!: (value: TerminalSendResult) => void
  private buffer = ''
  private unread = ''
  private truncated = false
  private settled = false
  private idleTimer?: ReturnType<typeof setTimeout>
  private timeoutTimer?: ReturnType<typeof setTimeout>

  constructor(private readonly session: SshTerminalSession, request: TerminalSendRequest) {
    this.done = new Promise(resolve => { this.resolveDone = resolve })
    this.timeoutTimer = setTimeout(() => this.settle('timeout'), 30_000)
    request.signal?.addEventListener('abort', () => { void session.signal('SIGINT').catch(() => {}); this.settle('timeout') }, { once: true })
    this.armIdle()
  }

  readOutput(): { delta: string; truncated: boolean } {
    const delta = this.unread
    this.unread = ''
    return { delta, truncated: this.truncated }
  }

  cancel(): boolean {
    if (this.settled) return false
    void this.session.signal('SIGINT').catch(() => {})
    this.settle('inferred_idle')
    return true
  }

  push(text: string): void {
    if (this.settled) return
    this.buffer += text
    this.unread += text
    if (this.buffer.length > 64_000) { this.buffer = this.buffer.slice(-64_000); this.truncated = true }
    if (this.unread.length > 64_000) { this.unread = this.unread.slice(-64_000); this.truncated = true }
    this.armIdle()
  }

  settle(reason: TerminalSendResult['waitReason']): void {
    if (this.settled) return
    this.settled = true
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer)
    if (this.timeoutTimer !== undefined) clearTimeout(this.timeoutTimer)
    this.resolveDone({
      viewport: this.buffer,
      waitReason: reason,
      sessionStatus: this.session.snapshotStatus(),
      truncated: this.truncated,
    })
  }

  private armIdle(): void {
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.settle('inferred_idle'), 700)
  }
}

export class BrowserTerminalManager {
  private readonly sessions = new Map<string, BrowserTerminal>()
  constructor(private readonly connector: SshConnector) {}

  async create(profileId: string, cols: number, rows: number, signal?: AbortSignal): Promise<{ id: string; profileId: string }> {
    const connection = await this.connector.connect(profileId, signal)
    try {
      const channel = await openShell(connection, clamp(cols, 20, 400), clamp(rows, 5, 200))
      const terminal = new BrowserTerminal(randomUUID(), profileId, connection, channel, () => this.sessions.delete(terminal.id))
      this.sessions.set(terminal.id, terminal)
      return { id: terminal.id, profileId }
    } catch (error) {
      connection.close()
      throw error
    }
  }

  get(id: string): BrowserTerminal {
    const terminal = this.sessions.get(id)
    if (terminal === undefined) throw Object.assign(new Error('browser terminal was not found'), { status: 404 })
    return terminal
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map(terminal => terminal.close()))
    this.sessions.clear()
  }
}

/** Owner-scoped AI terminals for Web profiles, whose official Terminal service lives inside each Agent preset realm. */
export class AiTerminalManager {
  private readonly sessions = new Map<string, Map<string, AiTerminalRecord>>()
  constructor(private readonly connector: SshConnector) {}

  async create(ownerId: string, profileId: string, cwd: string, name?: string, signal?: AbortSignal): Promise<{ terminalId: string; profileId: string; cwd: string; motd: string }> {
    const connection = await this.connector.connect(profileId, signal)
    try {
      const channel = await openShell(connection, 120, 32)
      const terminalId = randomUUID()
      const session = new SshTerminalSession(connection, channel, `Connected to ${connection.profile.name} (${connection.profile.username}@${connection.profile.host})`)
      const record: AiTerminalRecord = {
        terminalId,
        profileId,
        name: name?.trim() || connection.profile.name,
        cwd,
        createdAt: Date.now(),
        session,
        commands: [],
      }
      const owned = this.sessions.get(ownerId) ?? new Map<string, AiTerminalRecord>()
      owned.set(terminalId, record)
      this.sessions.set(ownerId, owned)
      channel.write(`${directoryPrelude(cwd)}\n`)
      return { terminalId, profileId, cwd, motd: session.motd }
    } catch (error) {
      connection.close()
      throw error
    }
  }

  get(ownerId: string, terminalId: string): SshTerminalSession {
    const record = this.sessions.get(ownerId)?.get(terminalId)
    if (record === undefined) throw new Error('SSH terminal was not found in the current DSH session')
    return record.session
  }

  list(ownerId: string): Array<{ terminalId: string; status: TerminalSessionStatus }> {
    return [...(this.sessions.get(ownerId) ?? new Map()).values()].map(record => ({ terminalId: record.terminalId, status: record.session.status() }))
  }

  async send(ownerId: string, terminalId: string, request: TerminalSendRequest): Promise<TerminalSendResult> {
    const record = this.sessions.get(ownerId)?.get(terminalId)
    if (record === undefined) throw new Error('SSH terminal was not found in the current DSH session')
    const startedAt = Date.now()
    const result = await record.session.startSend(request).done
    record.commands.push({
      id: randomUUID(),
      command: request.text,
      submitted: request.submit !== false,
      startedAt,
      completedAt: Date.now(),
      output: result.viewport.slice(-64_000),
      waitReason: result.waitReason,
      truncated: result.truncated || result.viewport.length > 64_000,
    })
    if (record.commands.length > 80) record.commands.splice(0, record.commands.length - 80)
    return result
  }

  write(ownerId: string, terminalId: string, text: string): void {
    this.get(ownerId, terminalId).write(text)
  }

  resize(ownerId: string, terminalId: string, cols: number, rows: number): void {
    this.get(ownerId, terminalId).resize(cols, rows)
  }

  activity(ownerId: string): AiTerminalActivity[] {
    return [...(this.sessions.get(ownerId) ?? new Map()).values()].map(record => {
      const scrollback = record.session.read({ count: 500 }).text
      return {
        terminalId: record.terminalId,
        profileId: record.profileId,
        name: record.name,
        cwd: record.cwd,
        createdAt: record.createdAt,
        status: record.session.status(),
        scrollback: scrollback.slice(-96_000),
        commands: structuredClone(record.commands),
      }
    })
  }

  async close(ownerId: string, terminalId: string): Promise<boolean> {
    const owned = this.sessions.get(ownerId)
    const record = owned?.get(terminalId)
    if (record === undefined) return false
    owned!.delete(terminalId)
    if (owned!.size === 0) this.sessions.delete(ownerId)
    await record.session.close('closed by owner')
    return true
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.sessions.values()].flatMap(owned => [...owned.values()].map(record => record.session))
    this.sessions.clear()
    await Promise.all(sessions.map(session => session.close('dsh-ssh disposed').catch(() => {})))
  }
}

interface AiTerminalRecord {
  terminalId: string
  profileId: string
  name: string
  cwd: string
  createdAt: number
  session: SshTerminalSession
  commands: AiTerminalCommand[]
}

export interface AiTerminalCommand {
  id: string
  command: string
  submitted: boolean
  startedAt: number
  completedAt: number
  output: string
  waitReason: TerminalSendResult['waitReason']
  truncated: boolean
}

export interface AiTerminalActivity {
  terminalId: string
  profileId: string
  name: string
  cwd: string
  createdAt: number
  status: TerminalSessionStatus
  scrollback: string
  commands: AiTerminalCommand[]
}

export class BrowserTerminal {
  private output = ''
  private baseCursor = 0
  private closed = false
  private idleTimer: ReturnType<typeof setTimeout>

  constructor(
    readonly id: string,
    readonly profileId: string,
    private readonly connection: ManagedSshConnection,
    private readonly channel: ClientChannel,
    private readonly onClose: () => void,
  ) {
    this.idleTimer = setTimeout(() => { void this.close() }, 30 * 60_000)
    channel.setEncoding('utf8')
    channel.on('data', (chunk: string | Buffer) => this.append(String(chunk)))
    channel.stderr?.setEncoding('utf8')
    channel.stderr?.on('data', (chunk: string | Buffer) => this.append(String(chunk)))
    channel.once('close', () => { this.closed = true; connection.close(); onClose() })
  }

  write(text: string): void { this.touch(); if (this.closed) throw new Error('terminal is closed'); this.channel.write(text) }
  resize(cols: number, rows: number): void { this.touch(); this.channel.setWindow(clamp(rows, 5, 200), clamp(cols, 20, 400), 0, 0) }

  read(cursor: number): { data: string; cursor: number; truncated: boolean; closed: boolean } {
    this.touch()
    const safeCursor = Math.max(cursor, this.baseCursor)
    const index = safeCursor - this.baseCursor
    return { data: this.output.slice(index), cursor: this.baseCursor + this.output.length, truncated: cursor < this.baseCursor, closed: this.closed }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    clearTimeout(this.idleTimer)
    this.channel.end()
    this.connection.close()
    this.onClose()
  }

  private append(text: string): void {
    this.output += text
    if (this.output.length > 1_000_000) {
      const removed = this.output.length - 750_000
      this.output = this.output.slice(removed)
      this.baseCursor += removed
    }
  }

  private touch(): void {
    clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => { void this.close() }, 30 * 60_000)
  }
}

function openShell(connection: ManagedSshConnection, cols: number, rows: number): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    connection.client.shell({ term: connection.profile.terminalType, cols, rows }, (error, channel) => error ? reject(error) : resolve(channel))
  })
}

function normalizeSignal(signal: string | undefined): NodeJS.Signals | null {
  if (signal === undefined) return null
  const normalized = signal.startsWith('SIG') ? signal : `SIG${signal}`
  return normalized as NodeJS.Signals
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? Math.floor(value) : min))
}
