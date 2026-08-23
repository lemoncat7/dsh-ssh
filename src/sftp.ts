import path from 'node:path'
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
