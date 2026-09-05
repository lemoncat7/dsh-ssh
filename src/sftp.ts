import { t } from './i18n.js'
import path from 'node:path'
import { Transform, type Readable, type Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { FileEntry, SFTPWrapper } from 'ssh2'
import { SshConnector, type ManagedSshConnection } from './connector.js'
import type { RemoteDirectoryView, RemoteEndpointView, RemoteFileEntry, RemoteFileSystemSession } from './remote-files.js'

export interface SftpDirectoryEntry {
  name: string
  path: string
  kind: 'directory' | 'file' | 'symlink' | 'other'
  size: number
  modifiedAt: number
}

export interface SftpDirectoryView {
  path: string
  parent: string | null
  entries: SftpDirectoryEntry[]
}

export interface SftpFileHandle {
  path: string
  size: number
  mimeType: string
  stream: Readable
  close(): void
}

export interface SftpFilePreview {
  path: string
  name: string
  size: number
  mimeType: string
  kind: 'text' | 'image' | 'pdf' | 'binary'
  text?: string
  truncated?: boolean
}

export interface SftpUploadResult {
  path: string
  name: string
  size: number
}

/** Opens one reusable SFTP channel. Browser panes and transfer jobs own its lifecycle. */
export async function openSftpFileSystemSession(
  connector: SshConnector,
  profileId: string,
  endpoint: RemoteEndpointView,
  signal?: AbortSignal,
): Promise<RemoteFileSystemSession> {
  signal?.throwIfAborted()
  const connection = await connector.connect(profileId, signal)
  try {
    const sftp = await openSftp(connection.client, signal)
    const home = await realpath(sftp, t("."))
    return new ReusableSftpSession(endpoint, connection, sftp, home)
  } catch (error) {
    connection.close()
    throw error
  }
}

class ReusableSftpSession implements RemoteFileSystemSession {
  private closed = false

  constructor(
    readonly endpoint: RemoteEndpointView,
    private readonly connection: ManagedSshConnection,
    private readonly sftp: SFTPWrapper,
    private readonly home: string,
  ) {}

  list(requestedPath: string, signal?: AbortSignal): Promise<RemoteDirectoryView> {
    return this.run(async () => {
      const resolved = await realpath(this.sftp, expandHome(requestedPath.trim() || '~', this.home))
      const entries = (await readdir(this.sftp, resolved))
        .filter(entry => entry.filename !== t(".") && entry.filename !== '..')
        .map(entry => viewEntry(resolved, entry))
        .sort((left, right) => {
          if (left.kind === 'directory' && right.kind !== 'directory') return -1
          if (left.kind !== 'directory' && right.kind === 'directory') return 1
          return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
        })
      return { path: resolved, parent: remoteParent(resolved), entries }
    }, signal)
  }

  stat(requestedPath: string, signal?: AbortSignal): Promise<RemoteFileEntry> {
    return this.run(async () => {
      const resolved = await realpath(this.sftp, expandHome(requestedPath.trim() || '~', this.home))
      const attributes = await stat(this.sftp, resolved)
      const fileType = attributes.mode & 0o170000
      return {
        name: remoteName(resolved), path: resolved,
        kind: fileType === 0o040000 ? 'directory' : fileType === 0o100000 ? 'file' : fileType === 0o120000 ? 'symlink' : 'other',
        size: attributes.size, modifiedAt: attributes.mtime * 1000,
      }
    }, signal)
  }

  download(requestedPath: string, destination: Writable, signal?: AbortSignal): Promise<void> {
    return this.run(async () => {
      const resolved = await realpath(this.sftp, expandHome(requestedPath, this.home))
      await pipeline(createSftpReadStream(this.sftp, resolved), destination, { signal })
    }, signal)
  }

  upload(requestedPath: string, source: Readable, overwrite: boolean, signal?: AbortSignal): Promise<void> {
    return this.run(async () => {
      const target = expandHome(requestedPath, this.home).replaceAll('\\', '/')
      if (!overwrite && await sftpPathExists(this.sftp, target)) throw Object.assign(new Error('A file with this name already exists'), { status: 409 })
      const output = this.sftp.createWriteStream(target, { flags: 'w', mode: 0o600 })
      output.on('error', () => {})
      await pipeline(source, output, { signal })
    }, signal)
  }

  ensureDirectory(requestedPath: string, signal?: AbortSignal): Promise<void> {
    return this.run(async () => {
      const target = expandHome(requestedPath.trim() || '~', this.home).replaceAll('\\', '/')
      const drive = /^([A-Za-z]:)\//.exec(target)?.[1]
      const absolute = target.startsWith('/') || drive !== undefined
      const parts = target.split('/').filter(Boolean).slice(drive === undefined ? 0 : 1)
      let current = drive === undefined ? absolute ? '/' : this.home : `${drive}/`
      for (const part of parts) {
        current = remoteJoin(current, part)
        if (!await sftpPathExists(this.sftp, current)) await mkdirSftp(this.sftp, current)
      }
    }, signal)
  }

  move(sourcePath: string, destinationPath: string, signal?: AbortSignal): Promise<void> {
    return this.run(async () => {
      const source = expandHome(sourcePath.trim(), this.home).replaceAll('\\', '/')
      const destination = expandHome(destinationPath.trim(), this.home).replaceAll('\\', '/')
      if (await sftpPathExists(this.sftp, destination)) throw Object.assign(new Error('destination already contains an entry with this name'), { status: 409 })
      await renameSftp(this.sftp, source, destination)
    }, signal)
  }

  remove(requestedPath: string, recursive: boolean, signal?: AbortSignal): Promise<void> {
    return this.run(async () => {
      const target = expandHome(requestedPath.trim(), this.home).replaceAll('\\', '/')
      await removeSftpEntry(this.sftp, target, recursive, signal, { entries: 0 })
    }, signal)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.sftp.end()
    this.connection.close()
  }

  private async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.closed) throw new Error('SFTP session is closed')
    signal?.throwIfAborted()
    const abort = (): void => this.close()
    signal?.addEventListener('abort', abort, { once: true })
    try { return await operation() }
    finally { signal?.removeEventListener('abort', abort) }
  }
}

export async function statSftpPath(
  connector: SshConnector,
  profileId: string,
  requestedPath: string,
  signal?: AbortSignal,
): Promise<SftpDirectoryEntry> {
  signal?.throwIfAborted()
  const connection = await connector.connect(profileId, signal)
  let sftp: SFTPWrapper | undefined
  try {
    sftp = await openSftp(connection.client, signal)
    const home = await realpath(sftp, t("."))
    const resolved = await realpath(sftp, expandHome(requestedPath.trim() || '~', home))
    const attributes = await stat(sftp, resolved)
    const fileType = attributes.mode & 0o170000
    return {
      name: remoteName(resolved), path: resolved,
      kind: fileType === 0o040000 ? 'directory' : fileType === 0o100000 ? 'file' : fileType === 0o120000 ? 'symlink' : 'other',
      size: attributes.size, modifiedAt: attributes.mtime * 1000,
    }
  } finally {
    sftp?.end()
    connection.close()
  }
}

export async function downloadSftpFile(
  connector: SshConnector,
  profileId: string,
  requestedPath: string,
  destination: import('node:stream').Writable,
  signal?: AbortSignal,
): Promise<void> {
  const handle = await openSftpFile(connector, profileId, requestedPath, signal)
  try { await pipeline(handle.stream, destination, { signal }) }
  finally { handle.close() }
}

export async function ensureSftpDirectory(
  connector: SshConnector,
  profileId: string,
  requestedPath: string,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted()
  const connection = await connector.connect(profileId, signal)
  let sftp: SFTPWrapper | undefined
  try {
    sftp = await openSftp(connection.client, signal)
    const home = await realpath(sftp, t("."))
    const target = expandHome(requestedPath.trim() || '~', home).replaceAll('\\', '/')
    const absolute = target.startsWith('/')
    const parts = target.split('/').filter(Boolean)
    let current = absolute ? '/' : home
    for (const part of parts) {
      current = remoteJoin(current, part)
      if (!await sftpPathExists(sftp, current)) await mkdirSftp(sftp, current)
    }
    return realpath(sftp, current)
  } finally {
    sftp?.end()
    connection.close()
  }
}

export async function listSftpDirectory(
  connector: SshConnector,
  profileId: string,
  requestedPath: string,
  signal?: AbortSignal,
): Promise<SftpDirectoryView> {
  signal?.throwIfAborted()
  const connection = await connector.connect(profileId, signal)
  let sftp: SFTPWrapper | undefined
  try {
    sftp = await openSftp(connection.client, signal)
    const home = await realpath(sftp, t("."))
    const target = expandHome(requestedPath.trim() || '~', home)
    const resolved = await realpath(sftp, target)
    const entries = (await readdir(sftp, resolved))
      .filter(entry => entry.filename !== t(".") && entry.filename !== '..')
      .map(entry => viewEntry(resolved, entry))
      .sort((left, right) => {
        if (left.kind === 'directory' && right.kind !== 'directory') return -1
        if (left.kind !== 'directory' && right.kind === 'directory') return 1
        return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
      })
    return { path: resolved, parent: remoteParent(resolved), entries }
  } finally {
    sftp?.end()
    connection.close()
  }
}

export async function openSftpFile(
  connector: SshConnector,
  profileId: string,
  requestedPath: string,
  signal?: AbortSignal,
): Promise<SftpFileHandle> {
  signal?.throwIfAborted()
  const connection = await connector.connect(profileId, signal)
  let sftp: SFTPWrapper | undefined
  try {
    sftp = await openSftp(connection.client, signal)
    const resolved = await realpath(sftp, requestedPath)
    const attributes = await stat(sftp, resolved)
    if ((attributes.mode & 0o170000) === 0o040000) throw new Error('SFTP path points to a directory, not a file')
    const stream = createSftpReadStream(sftp, resolved)
    let closed = false
    const close = (): void => {
      if (closed) return
      closed = true
      stream.destroy()
      sftp?.end()
      connection.close()
    }
    stream.once('close', () => {
      if (closed) return
      closed = true
      sftp?.end()
      connection.close()
    })
    return { path: resolved, size: attributes.size, mimeType: mimeTypeFor(resolved), stream, close }
  } catch (error) {
    sftp?.end()
    connection.close()
    throw error
  }
}

export async function readSftpFilePreview(
  connector: SshConnector,
  profileId: string,
  requestedPath: string,
  maxTextBytes = 1_048_576,
  signal?: AbortSignal,
): Promise<SftpFilePreview> {
  signal?.throwIfAborted()
  const connection = await connector.connect(profileId, signal)
  let sftp: SFTPWrapper | undefined
  try {
    sftp = await openSftp(connection.client, signal)
    const resolved = await realpath(sftp, requestedPath)
    const attributes = await stat(sftp, resolved)
    if ((attributes.mode & 0o170000) === 0o040000) throw new Error('SFTP path points to a directory, not a file')
    const mimeType = mimeTypeFor(resolved)
    const kind = previewKind(mimeType)
    const base = { path: resolved, name: remoteName(resolved), size: attributes.size, mimeType, kind }
    if (kind !== 'text') return base

    const stream = createSftpReadStream(sftp, resolved)
    const chunks: Buffer[] = []
    let total = 0
    let truncated = false
    for await (const chunk of stream) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      const remaining = maxTextBytes - total
      if (remaining <= 0) { truncated = true; break }
      chunks.push(value.subarray(0, remaining))
      total += Math.min(value.length, remaining)
      if (value.length > remaining || total >= maxTextBytes && attributes.size > total) { truncated = true; break }
    }
    return { ...base, text: Buffer.concat(chunks).toString('utf8'), truncated }
  } finally {
    sftp?.end()
    connection.close()
  }
}

export async function uploadSftpFile(
  connector: SshConnector,
  profileId: string,
  requestedDirectory: string,
  filename: string,
  input: Readable,
  options: { overwrite: boolean; maxBytes: number; signal?: AbortSignal },
): Promise<SftpUploadResult> {
  options.signal?.throwIfAborted()
  const connection = await connector.connect(profileId, options.signal)
  let sftp: SFTPWrapper | undefined
  try {
    sftp = await openSftp(connection.client)
    const home = await realpath(sftp, t("."))
    const directory = await realpath(sftp, expandHome(requestedDirectory.trim() || '~', home))
    const target = remoteJoin(directory, filename)
    if (!options.overwrite && await sftpPathExists(sftp, target)) throw Object.assign(new Error('A file with this name already exists'), { status: 409 })

    let size = 0
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length
        if (size > options.maxBytes) callback(Object.assign(new Error(`Upload exceeds the ${formatByteLimit(options.maxBytes)} limit`), { status: 413 }))
        else callback(null, chunk)
      },
    })
    const output = sftp.createWriteStream(target, { flags: 'w', mode: 0o600 })
    output.on('error', () => {})
    await pipeline(input, limiter, output, { signal: options.signal })
    return { path: target, name: filename, size }
  } finally {
    sftp?.end()
    connection.close()
  }
}

function mkdirSftp(sftp: SFTPWrapper, value: string): Promise<void> {
  return new Promise((resolve, reject) => sftp.mkdir(value, { mode: 0o755 }, error => error ? reject(error) : resolve()))
}

async function removeSftpEntry(sftp: SFTPWrapper, value: string, recursive: boolean, signal: AbortSignal | undefined, counter: { entries: number }, depth = 0): Promise<void> {
  signal?.throwIfAborted()
  counter.entries += 1
  if (depth > 64 || counter.entries > 20_000) throw Object.assign(new Error('directory deletion exceeds the safety limit'), { status: 413 })
  const attributes = await lstat(sftp, value)
  if ((attributes.mode & 0o170000) !== 0o040000) { await unlinkSftp(sftp, value); return }
  if (!recursive) throw Object.assign(new Error('remote path is a directory'), { status: 409 })
  const entries = await readdir(sftp, value)
  for (const entry of entries) {
    if (entry.filename === t(".") || entry.filename === '..') continue
    await removeSftpEntry(sftp, remoteJoin(value, entry.filename), true, signal, counter, depth + 1)
  }
  await rmdirSftp(sftp, value)
}

function openSftp(client: import('ssh2').Client, signal?: AbortSignal): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(signal?.reason instanceof Error ? signal.reason : new Error('SFTP request was aborted'))
    signal?.addEventListener('abort', abort, { once: true })
    client.sftp((error, channel) => {
      signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve(channel)
    })
  })
}

function realpath(sftp: SFTPWrapper, value: string): Promise<string> {
  return new Promise((resolve, reject) => {
    sftp.realpath(value, (error, resolved) => error ? reject(normalizeSftpPathError(error, value)) : resolve(resolved))
  })
}

function readdir(sftp: SFTPWrapper, value: string): Promise<FileEntry[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(value, (error, entries) => error ? reject(error) : resolve(entries))
  })
}

function stat(sftp: SFTPWrapper, value: string): Promise<import('ssh2').Stats> {
  return new Promise((resolve, reject) => {
    sftp.stat(value, (error, attributes) => error ? reject(normalizeSftpPathError(error, value)) : resolve(attributes))
  })
}

function lstat(sftp: SFTPWrapper, value: string): Promise<import('ssh2').Stats> {
  return new Promise((resolve, reject) => {
    sftp.lstat(value, (error, attributes) => error ? reject(normalizeSftpPathError(error, value)) : resolve(attributes))
  })
}

function unlinkSftp(sftp: SFTPWrapper, value: string): Promise<void> {
  return new Promise((resolve, reject) => sftp.unlink(value, error => error ? reject(normalizeSftpPathError(error, value)) : resolve()))
}

function rmdirSftp(sftp: SFTPWrapper, value: string): Promise<void> {
  return new Promise((resolve, reject) => sftp.rmdir(value, error => error ? reject(normalizeSftpPathError(error, value)) : resolve()))
}

function renameSftp(sftp: SFTPWrapper, source: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => sftp.rename(source, destination, error => error ? reject(normalizeSftpPathError(error, source)) : resolve()))
}

async function sftpPathExists(sftp: SFTPWrapper, value: string): Promise<boolean> {
  try { await stat(sftp, value); return true }
  catch (error) {
    if (isSftpPathMissing(error)) return false
    throw error
  }
}

function normalizeSftpPathError(error: unknown, value: string): unknown {
  if (!isSftpPathMissing(error)) return error
  return Object.assign(new Error(`remote path ${value} was not found`, { cause: error }), { status: 404, code: 'ENOENT' })
}

function isSftpPathMissing(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const value = error as { code?: unknown; status?: unknown }
  return value.status === 404 || value.code === 2 || value.code === '2' || value.code === 'ENOENT'
}

function createSftpReadStream(sftp: SFTPWrapper, value: string): ReturnType<SFTPWrapper['createReadStream']> {
  const stream = sftp.createReadStream(value)
  // ssh2 can emit a second transport error after an iterator or pipeline has already completed.
  // Keep a listener attached so that this late lifecycle event cannot terminate the DSH process.
  stream.on('error', () => {})
  return stream
}

function expandHome(value: string, home: string): string {
  if (value === '~') return home
  if (value.startsWith('~/') || value.startsWith('~\\')) return remoteJoin(home, value.slice(2))
  return value
}

function viewEntry(directory: string, entry: FileEntry): SftpDirectoryEntry {
  const fileType = entry.attrs.mode & 0o170000
  const kind = fileType === 0o040000 ? 'directory'
    : fileType === 0o100000 ? 'file'
      : fileType === 0o120000 ? 'symlink'
        : 'other'
  return {
    name: entry.filename,
    path: remoteJoin(directory, entry.filename),
    kind,
    size: entry.attrs.size,
    modifiedAt: entry.attrs.mtime * 1000,
  }
}

function remoteJoin(directory: string, name: string): string {
  return path.posix.join(directory.replaceAll('\\', '/'), name.replaceAll('\\', '/'))
}

function remoteParent(value: string): string | null {
  const normalized = value.replaceAll('\\', '/').replace(/\/+$/, '') || '/'
  if (normalized === '/' || /^[A-Za-z]:$/.test(normalized)) return null
  const parent = path.posix.dirname(normalized)
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}/`
  return parent === normalized ? null : parent
}

function remoteName(value: string): string {
  return path.posix.basename(value.replaceAll('\\', '/'))
}

function formatByteLimit(value: number): string {
  return value % (1024 * 1024) === 0 ? `${value / (1024 * 1024)} MB` : `${value} bytes`
}

export function previewKind(mimeType: string): SftpFilePreview['kind'] {
  if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml' || mimeType === 'application/javascript') return 'text'
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType === 'application/pdf') return 'pdf'
  return 'binary'
}

export function mimeTypeFor(value: string): string {
  const name = remoteName(value).toLowerCase()
  if (TEXT_FILENAMES.has(name)) return 'text/plain'
  const extension = path.posix.extname(value).toLowerCase()
  return {
    '.txt': 'text/plain', '.md': 'text/markdown', '.log': 'text/plain', '.csv': 'text/csv', '.tsv': 'text/tab-separated-values',
    '.json': 'application/json', '.jsonl': 'application/json', '.xml': 'application/xml', '.yml': 'text/yaml', '.yaml': 'text/yaml',
    '.js': 'application/javascript', '.mjs': 'application/javascript', '.cjs': 'application/javascript', '.ts': 'text/typescript', '.tsx': 'text/typescript', '.jsx': 'text/javascript',
    '.css': 'text/css', '.scss': 'text/x-scss', '.html': 'text/html', '.htm': 'text/html', '.sh': 'text/x-shellscript', '.bash': 'text/x-shellscript',
    '.py': 'text/x-python', '.rs': 'text/x-rust', '.go': 'text/x-go', '.java': 'text/x-java-source', '.c': 'text/x-c', '.h': 'text/x-c', '.cpp': 'text/x-c++',
    '.toml': 'text/plain', '.ini': 'text/plain', '.conf': 'text/plain', '.env': 'text/plain',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
    '.pdf': 'application/pdf', '.zip': 'application/zip', '.gz': 'application/gzip', '.tar': 'application/x-tar', '.wasm': 'application/wasm',
  }[extension] ?? 'application/octet-stream'
}

const TEXT_FILENAMES = new Set([
  '.bashrc', '.bash_profile', '.bash_logout', '.zshrc', '.zprofile', '.zshenv', '.profile',
  '.gitconfig', '.gitignore', '.gitattributes', '.editorconfig', '.npmrc', '.yarnrc',
  '.dockerignore', '.env', '.env.local', 'dockerfile', 'makefile', 'license', 'readme',
])
