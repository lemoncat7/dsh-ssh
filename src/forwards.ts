import net, { type Server, type Socket } from 'node:net'
import type { Client, ClientChannel, TcpConnectionDetails } from 'ssh2'
import { SshConnector, type ManagedSshConnection } from './connector.js'
import { isLoopbackHost, type ForwardRule } from './domain.js'
import { SshStore } from './store.js'

export interface ForwardStatus {
  ruleId: string
  state: 'stopped' | 'starting' | 'running' | 'error'
  bindHost: string
  bindPort: number
  connections: number
  error?: string
}

interface RunningForward {
  rule: ForwardRule
  connection: ManagedSshConnection
  server?: Server
  bindPort: number
  connections: number
  close(): Promise<void>
}

export class ForwardManager {
  private readonly running = new Map<string, RunningForward>()
  private readonly failures = new Map<string, string>()
  private readonly starting = new Map<string, Promise<ForwardStatus>>()

  constructor(private readonly connector: SshConnector, private readonly store: SshStore) {}

  list(): ForwardStatus[] {
    return this.store.forwards().map(rule => {
      const active = this.running.get(rule.id)
      if (active !== undefined) return { ruleId: rule.id, state: 'running', bindHost: rule.bindHost, bindPort: active.bindPort, connections: active.connections }
      if (this.starting.has(rule.id)) return { ruleId: rule.id, state: 'starting', bindHost: rule.bindHost, bindPort: rule.bindPort, connections: 0 }
      const error = this.failures.get(rule.id)
      return { ruleId: rule.id, state: error === undefined ? 'stopped' : 'error', bindHost: rule.bindHost, bindPort: rule.bindPort, connections: 0, ...error === undefined ? {} : { error } }
    })
  }

  status(ruleId: string): ForwardStatus {
    const result = this.list().find(item => item.ruleId === ruleId)
    if (result === undefined) throw Object.assign(new Error('forward rule was not found'), { status: 404 })
    return result
  }

  start(ruleId: string): Promise<ForwardStatus> {
    const active = this.running.get(ruleId)
    if (active !== undefined) return Promise.resolve(this.status(ruleId))
    const pending = this.starting.get(ruleId)
    if (pending !== undefined) return pending
    const operation = this.startFresh(ruleId).finally(() => this.starting.delete(ruleId))
    this.starting.set(ruleId, operation)
    return operation
  }

  async stop(ruleId: string): Promise<ForwardStatus> {
    await this.starting.get(ruleId)?.catch(() => {})
    const active = this.running.get(ruleId)
    if (active !== undefined) { this.running.delete(ruleId); await active.close() }
    this.failures.delete(ruleId)
    return this.status(ruleId)
  }

  async startAuto(): Promise<void> {
    for (const rule of this.store.forwards().filter(item => item.autoStart)) await this.start(rule.id).catch(() => {})
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.running.values()].map(item => item.close().catch(() => {})))
    this.running.clear()
  }

  private async startFresh(ruleId: string): Promise<ForwardStatus> {
    const rule = this.store.forward(ruleId)
    if (rule === undefined) throw Object.assign(new Error('forward rule was not found'), { status: 404 })
    const settings = this.store.settings()
    if (!settings.allowPublicBind && !isLoopbackHost(rule.bindHost)) {
      throw Object.assign(new Error('Public port binding is disabled. Use a loopback bind address or enable it in SSH settings.'), { status: 403 })
    }
    const connection = await this.connector.connect(rule.profileId)
    try {
      const running = rule.kind === 'local'
        ? await startLocal(rule, connection)
        : rule.kind === 'dynamic'
          ? await startDynamic(rule, connection)
          : await startRemote(rule, connection)
      this.failures.delete(ruleId)
      this.running.set(ruleId, running)
      return this.status(ruleId)
    } catch (error) {
      connection.close()
      const message = error instanceof Error ? error.message : String(error)
      this.failures.set(ruleId, message)
      throw error
    }
  }
}

async function startLocal(rule: ForwardRule, connection: ManagedSshConnection): Promise<RunningForward> {
  const running = baseRunning(rule, connection)
  const server = net.createServer(socket => {
    running.connections += 1
    socket.once('close', () => { running.connections -= 1 })
    connection.client.forwardOut(socket.remoteAddress ?? '127.0.0.1', socket.remotePort ?? 0, rule.targetHost!, rule.targetPort!, (error, channel) => {
      if (error) return socket.destroy(error)
      pipeSockets(socket, channel)
    })
  })
  running.server = server
  running.bindPort = await listen(server, rule.bindHost, rule.bindPort)
  running.close = async () => { await closeServer(server); connection.close() }
  return running
}

async function startDynamic(rule: ForwardRule, connection: ManagedSshConnection): Promise<RunningForward> {
  const running = baseRunning(rule, connection)
  const server = net.createServer(socket => { running.connections += 1; socket.once('close', () => { running.connections -= 1 }); void handleSocksClient(socket, connection.client) })
  running.server = server
  running.bindPort = await listen(server, rule.bindHost, rule.bindPort)
  running.close = async () => { await closeServer(server); connection.close() }
  return running
}

async function startRemote(rule: ForwardRule, connection: ManagedSshConnection): Promise<RunningForward> {
  const running = baseRunning(rule, connection)
  const port = await new Promise<number>((resolve, reject) => connection.client.forwardIn(rule.bindHost, rule.bindPort, (error, assignedPort) => error ? reject(error) : resolve(assignedPort)))
  const onConnection = (details: TcpConnectionDetails, accept: () => ClientChannel, reject: () => void): void => {
    if (details.destPort !== port) return
    const channel = accept()
    const socket = net.connect({ host: rule.targetHost!, port: rule.targetPort! })
    running.connections += 1
    channel.once('close', () => { running.connections -= 1 })
    socket.once('connect', () => pipeSockets(socket, channel))
    socket.once('error', () => { channel.close(); reject() })
  }
  connection.client.on('tcp connection', onConnection)
  running.bindPort = port
  running.close = async () => {
    connection.client.off('tcp connection', onConnection)
    await new Promise<void>(resolve => connection.client.unforwardIn(rule.bindHost, port, () => resolve()))
    connection.close()
  }
  return running
}

function baseRunning(rule: ForwardRule, connection: ManagedSshConnection): RunningForward {
  return { rule, connection, bindPort: rule.bindPort, connections: 0, close: async () => connection.close() }
}

function listen(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host, port, exclusive: true }, () => {
      server.off('error', reject)
      const address = server.address()
      if (address === null || typeof address === 'string') return reject(new Error('forward server did not expose a TCP address'))
      resolve(address.port)
    })
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise(resolve => server.close(() => resolve()))
}

function pipeSockets(socket: Socket, channel: ClientChannel): void {
  socket.pipe(channel).pipe(socket)
  const close = (): void => { socket.destroy(); channel.destroy() }
  socket.once('error', close)
  channel.once('error', close)
}

async function handleSocksClient(socket: Socket, client: Client): Promise<void> {
  try {
    const greeting = await socketRead(socket, 2)
    if (greeting[0] !== 5) throw new Error('not SOCKS5')
    const methods = await socketRead(socket, greeting[1] ?? 0)
    if (!methods.includes(0)) { socket.end(Buffer.from([5, 0xff])); return }
    socket.write(Buffer.from([5, 0]))
    const request = await socketRead(socket, 4)
    if (request[0] !== 5 || request[1] !== 1) throw new Error('unsupported SOCKS5 request')
    let host: string
    if (request[3] === 1) host = [...await socketRead(socket, 4)].join('.')
    else if (request[3] === 3) { const length = (await socketRead(socket, 1))[0] ?? 0; host = (await socketRead(socket, length)).toString('utf8') }
    else throw new Error('unsupported SOCKS5 address')
    const portBuffer = await socketRead(socket, 2)
    const port = ((portBuffer[0] ?? 0) << 8) | (portBuffer[1] ?? 0)
    client.forwardOut(socket.remoteAddress ?? '127.0.0.1', socket.remotePort ?? 0, host, port, (error, channel) => {
      if (error) { socket.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0])); return }
      socket.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
      pipeSockets(socket, channel)
    })
  } catch { socket.destroy() }
}

function socketRead(socket: Socket, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0)
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length < length) return
      cleanup()
      const extra = buffer.subarray(length)
      if (extra.length > 0) socket.unshift(extra)
      resolve(buffer.subarray(0, length))
    }
    const onError = (error: Error): void => { cleanup(); reject(error) }
    const cleanup = (): void => { socket.off('data', onData); socket.off('error', onError) }
    socket.on('data', onData)
    socket.once('error', onError)
  })
}
