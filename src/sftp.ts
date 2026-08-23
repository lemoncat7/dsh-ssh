import path from 'node:path'
import type { Readable } from 'node:stream'
import type { FileEntry, SFTPWrapper } from 'ssh2'
import { SshConnector } from './connector.js'

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
    const home = await realpath(sftp, '.')
    const target = expandHome(requestedPath.trim() || '~', home)
    const resolved = await realpath(sftp, target)
    const entries = (await readdir(sftp, resolved))
      .filter(entry => entry.filename !== '.' && entry.filename !== '..')
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
    const stream = sftp.createReadStream(resolved)
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
  const file = await openSftpFile(connector, profileId, requestedPath, signal)
  const kind = previewKind(file.mimeType)
  const base = { path: file.path, name: remoteName(file.path), size: file.size, mimeType: file.mimeType, kind }
  if (kind !== 'text') { file.close(); return base }
  const chunks: Buffer[] = []
  let total = 0
  let truncated = false
  try {
    for await (const chunk of file.stream) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      const remaining = maxTextBytes - total
      if (remaining <= 0) { truncated = true; break }
      chunks.push(value.subarray(0, remaining))
      total += Math.min(value.length, remaining)
      if (value.length > remaining || total >= maxTextBytes && file.size > total) { truncated = true; break }
    }
    return { ...base, text: Buffer.concat(chunks).toString('utf8'), truncated }
  } finally {
    file.close()
  }
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
    sftp.realpath(value, (error, resolved) => error ? reject(error) : resolve(resolved))
  })
}

function readdir(sftp: SFTPWrapper, value: string): Promise<FileEntry[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(value, (error, entries) => error ? reject(error) : resolve(entries))
  })
}

function stat(sftp: SFTPWrapper, value: string): Promise<import('ssh2').Stats> {
  return new Promise((resolve, reject) => {
    sftp.stat(value, (error, attributes) => error ? reject(error) : resolve(attributes))
  })
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

function previewKind(mimeType: string): SftpFilePreview['kind'] {
  if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml' || mimeType === 'application/javascript') return 'text'
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType === 'application/pdf') return 'pdf'
  return 'binary'
}

function mimeTypeFor(value: string): string {
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
