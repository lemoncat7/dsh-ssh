import { randomBytes } from 'node:crypto'
import { Transform } from 'node:stream'
import type { RemoteFileSystemSession } from './remote-files.js'
import { remoteJoin, remoteName } from './remote-files.js'
import { RemoteFileSystems } from './remote-file-systems.js'
import { scanRemoteTree } from './remote-tree-scan.js'

export type TransferConflictPolicy = 'fail' | 'skip' | 'overwrite' | 'rename'
export type TransferJobState = 'queued' | 'scanning' | 'transferring' | 'completed' | 'failed' | 'cancelled'

export interface TransferRequest {
  sourceEndpointId: string
  sourcePaths: string[]
  destinationEndpointId: string
  destinationDirectory: string
  conflictPolicy: TransferConflictPolicy
}

export interface TransferJobView {
  id: string
  ownerId: string
  request: TransferRequest
  state: TransferJobState
  totalFiles: number
  completedFiles: number
  skippedFiles: number
  totalBytes: number
  transferredBytes: number
  currentPath?: string
  error?: string
  createdAt: number
  startedAt?: number
  completedAt?: number
}

interface TransferTask { sourcePath: string; destinationPath: string; kind: 'directory' | 'file'; size: number }
interface ManagedJob { view: TransferJobView; controller: AbortController; finished: Promise<void>; finish(): void }

export class FileTransferManager {
  private readonly jobs = new Map<string, ManagedJob>()
  private readonly queue: string[] = []
  private readonly listeners = new Set<(job: TransferJobView) => void>()
  private readonly active = new Set<Promise<void>>()
  private running = 0
  private closed = false

  constructor(private readonly files: RemoteFileSystems, private readonly concurrency = 2, private readonly historyLimit = 250) {}

  start(ownerId: string, request: TransferRequest): TransferJobView {
    if (this.closed) throw Object.assign(new Error('file transfer service is closed'), { status: 503 })
    validateRequest(request)
    this.pruneHistory()
    const id = `transfer-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`
    const view: TransferJobView = {
      id, ownerId, request: structuredClone(request), state: 'queued', totalFiles: 0, completedFiles: 0,
      skippedFiles: 0, totalBytes: 0, transferredBytes: 0, createdAt: Date.now(),
    }
    let finish!: () => void
    const finished = new Promise<void>(resolve => { finish = resolve })
    this.jobs.set(id, { view, controller: new AbortController(), finished, finish })
    this.queue.push(id)
    this.emit(view)
    this.drain()
    return structuredClone(view)
  }

  list(ownerId?: string): TransferJobView[] {
    return [...this.jobs.values()].map(job => job.view).filter(job => ownerId === undefined || job.ownerId === ownerId)
      .sort((left, right) => right.createdAt - left.createdAt).map(job => structuredClone(job))
  }

  get(id: string, ownerId?: string): TransferJobView {
    const job = this.jobs.get(id)?.view
    if (job === undefined || ownerId !== undefined && job.ownerId !== ownerId) throw Object.assign(new Error('transfer job was not found'), { status: 404 })
    return structuredClone(job)
  }

  cancel(id: string, ownerId?: string): boolean {
    const managed = this.jobs.get(id)
    if (managed === undefined || ownerId !== undefined && managed.view.ownerId !== ownerId) throw Object.assign(new Error('transfer job was not found'), { status: 404 })
    if (isTerminal(managed.view.state)) return false
    managed.controller.abort(new Error('transfer was cancelled'))
    if (managed.view.state === 'queued') {
      managed.view.state = 'cancelled'
      managed.view.completedAt = Date.now()
      this.queue.splice(this.queue.indexOf(id), 1)
      this.emit(managed.view)
      managed.finish()
    }
    return true
  }

  /** Resolve only after the worker has stopped and its owned sessions are closed. */
  async cancelAndWait(id: string, ownerId?: string): Promise<TransferJobView> {
    const managed = this.jobs.get(id)!
    this.cancel(id, ownerId)
    await managed.finished
    return structuredClone(managed.view)
  }

  dismiss(id: string, ownerId?: string): boolean {
    const managed = this.jobs.get(id)
    if (managed === undefined || ownerId !== undefined && managed.view.ownerId !== ownerId) throw Object.assign(new Error('transfer job was not found'), { status: 404 })
    if (!isTerminal(managed.view.state)) throw Object.assign(new Error('active transfer jobs cannot be dismissed'), { status: 409 })
    return this.jobs.delete(id)
  }

  subscribe(listener: (job: TransferJobView) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  async closeAll(): Promise<void> {
    this.closed = true
    for (const id of this.queue.splice(0)) {
      const job = this.jobs.get(id)
      if (job === undefined || job.view.state !== 'queued') continue
      job.controller.abort(new Error('file transfer service is stopping'))
      job.view.state = 'cancelled'
      job.view.error = '传输服务已停止'
      job.view.completedAt = Date.now()
      this.emit(job.view)
      job.finish()
    }
    for (const job of this.jobs.values()) if (!isTerminal(job.view.state)) job.controller.abort(new Error('file transfer service is stopping'))
    await Promise.allSettled([...this.active])
  }

  private drain(): void {
    while (!this.closed && this.running < this.concurrency) {
      const id = this.queue.shift()
      if (id === undefined) break
      const job = this.jobs.get(id)
      if (job === undefined || job.view.state !== 'queued') continue
      this.running += 1
      const operation = this.run(job).finally(() => { this.running -= 1; this.drain() })
      this.active.add(operation)
      void operation.finally(() => this.active.delete(operation))
    }
  }

  private async run(job: ManagedJob): Promise<void> {
    const lifetime = new AbortController()
    const signal = AbortSignal.any([job.controller.signal, lifetime.signal])
    const sessions = new Set<RemoteFileSystemSession>()
    let disposed = false
    let closeError: unknown
    const close = (): void => {
      for (const session of sessions) {
        sessions.delete(session)
        try { session.close() } catch (error) { closeError ??= error }
      }
    }
    const connect = async (id: string): Promise<RemoteFileSystemSession> => {
      const session = await this.files.connect(id, signal)
      if (disposed || signal.aborted) { session.close(); throw signal.reason ?? new Error('transfer already ended') }
      sessions.add(session)
      return session
    }
    signal.addEventListener('abort', close, { once: true })
    let source: RemoteFileSystemSession | undefined
    let destination: RemoteFileSystemSession | undefined
    try {
      job.view.state = 'scanning'; job.view.startedAt = Date.now(); this.emit(job.view)
      ;[source, destination] = await interrupted(Promise.all([
        connect(job.view.request.sourceEndpointId),
        connect(job.view.request.destinationEndpointId),
      ]), signal)
      const tasks = (await interrupted(scanRemoteTree(source, job.view.request.sourcePaths, signal), signal)).map(task => ({
        sourcePath: task.sourcePath,
        destinationPath: remoteJoin(job.view.request.destinationDirectory, task.relativePath),
        kind: task.kind,
        size: task.size,
      }))
      job.view.totalFiles = tasks.filter(task => task.kind === 'file').length
      job.view.totalBytes = tasks.reduce((sum, task) => sum + (task.kind === 'file' ? task.size : 0), 0)
      job.view.state = 'transferring'; this.emit(job.view)
      for (const task of tasks) {
        signal.throwIfAborted()
        job.view.currentPath = task.sourcePath; this.emit(job.view)
        if (task.kind === 'directory') { await interrupted(destination.ensureDirectory(task.destinationPath, signal), signal); continue }
        const target = await interrupted(resolveConflict(destination, task.destinationPath, job.view.request.conflictPolicy, signal), signal)
        if (target === undefined) { job.view.skippedFiles += 1; this.emit(job.view); continue }
        await interrupted(destination.ensureDirectory(parentPath(target), signal), signal)
        await interrupted(transferFile(source, destination, task.sourcePath, target, job, signal), signal)
        job.view.completedFiles += 1; this.emit(job.view)
      }
      signal.throwIfAborted()
      delete job.view.currentPath
      job.view.state = 'completed'; job.view.completedAt = Date.now(); this.emit(job.view)
    } catch (error) {
      delete job.view.currentPath
      job.view.state = job.controller.signal.aborted ? 'cancelled' : 'failed'
      job.view.error = job.controller.signal.aborted ? '传输已取消' : errorMessage(error)
      job.view.completedAt = Date.now(); this.emit(job.view)
    } finally {
      disposed = true
      lifetime.abort(new Error('transfer worker ended'))
      signal.removeEventListener('abort', close)
      close()
      if (closeError !== undefined) {
        job.view.state = 'failed'
        job.view.error = `关闭传输连接失败：${errorMessage(closeError)}`
        this.emit(job.view)
      }
      job.finish()
    }
  }

  private emit(view: TransferJobView): void { for (const listener of this.listeners) listener(structuredClone(view)) }

  private pruneHistory(): void {
    const terminal = [...this.jobs.values()].filter(job => isTerminal(job.view.state)).sort((left, right) => right.view.createdAt - left.view.createdAt)
    for (const job of terminal.slice(this.historyLimit)) this.jobs.delete(job.view.id)
  }
}

async function transferFile(source: RemoteFileSystemSession, destination: RemoteFileSystemSession, sourcePath: string, destinationPath: string, job: ManagedJob, signal: AbortSignal): Promise<void> {
  const meter = new Transform({
    highWaterMark: 1024 * 1024,
    transform(chunk: Buffer, _encoding, callback) {
      try { signal.throwIfAborted(); job.view.transferredBytes += chunk.length; callback(null, chunk) }
      catch (error) { callback(error as Error) }
    },
  })
  meter.on('error', () => {})
  const abort = (): void => { meter.destroy(signal.reason instanceof Error ? signal.reason : new Error('transfer was aborted')) }
  signal.addEventListener('abort', abort, { once: true })
  try {
    const sourceTask = source.download(sourcePath, meter, signal).catch(error => {
      const contextual = transferEndpointError('read', sourcePath, error)
      meter.destroy(contextual)
      throw contextual
    })
    const destinationTask = destination.upload(destinationPath, meter, true, signal).catch(error => {
      const contextual = transferEndpointError('write', destinationPath, error)
      meter.destroy(contextual)
      throw contextual
    })
    await Promise.all([sourceTask, destinationTask])
  }
  finally { signal.removeEventListener('abort', abort) }
}

/** A disconnected protocol callback must not hold the worker or cancellation forever. */
function interrupted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = (): void => { signal.removeEventListener('abort', abort); reject(signal.reason ?? new Error('transfer aborted')) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    pending.then(value => { signal.removeEventListener('abort', abort); resolve(value) }, error => { signal.removeEventListener('abort', abort); reject(error) })
  })
}

function transferEndpointError(operation: 'read' | 'write', value: string, cause: unknown): Error {
  const message = cause instanceof Error ? cause.message : String(cause)
  return new Error(`could not ${operation} remote path ${value}: ${message}`, { cause })
}

async function resolveConflict(destination: RemoteFileSystemSession, value: string, policy: TransferConflictPolicy, signal: AbortSignal): Promise<string | undefined> {
  const exists = await pathExists(destination, value, signal)
  if (!exists) return value
  if (policy === 'skip') return undefined
  if (policy === 'overwrite') return value
  if (policy === 'fail') throw Object.assign(new Error(`destination already contains ${value}`), { status: 409 })
  const name = remoteName(value)
  const directory = parentPath(value)
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''
  for (let index = 1; index <= 999; index += 1) {
    const candidate = remoteJoin(directory, `${base} (${index})${extension}`)
    if (!await pathExists(destination, candidate, signal)) return candidate
  }
  throw new Error(`could not choose a unique name for ${value}`)
}

async function pathExists(session: RemoteFileSystemSession, value: string, signal: AbortSignal): Promise<boolean> {
  try { await session.stat(value, signal); return true }
  catch (error) { if ((error as { status?: number }).status === 404) return false; throw error }
}

function parentPath(value: string): string { return value.replaceAll('\\', '/').replace(/\/[^/]*$/, '') || '/' }
function isTerminal(state: TransferJobState): boolean { return state === 'completed' || state === 'failed' || state === 'cancelled' }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }

function validateRequest(value: TransferRequest): void {
  if (!/^(?:sftp|ftp):[^:\s]{1,100}$/.test(value.sourceEndpointId) || !/^(?:sftp|ftp):[^:\s]{1,100}$/.test(value.destinationEndpointId)) throw Object.assign(new Error('invalid file endpoint'), { status: 400 })
  if (!Array.isArray(value.sourcePaths) || value.sourcePaths.length < 1 || value.sourcePaths.length > 100) throw Object.assign(new Error('sourcePaths must contain 1-100 paths'), { status: 400 })
  for (const path of [...value.sourcePaths, value.destinationDirectory]) if (typeof path !== 'string' || path.length < 1 || path.length > 4096 || /[\0\r\n]/.test(path)) throw Object.assign(new Error('invalid remote path'), { status: 400 })
  if (!['fail', 'skip', 'overwrite', 'rename'].includes(value.conflictPolicy)) throw Object.assign(new Error('invalid conflict policy'), { status: 400 })
}
