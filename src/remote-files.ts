import path from 'node:path'
import type { Readable, Writable } from 'node:stream'

export type RemoteEndpointKind = 'sftp' | 'ftp'
export type RemoteFileKind = 'directory' | 'file' | 'symlink' | 'other'

export interface RemoteEndpointView {
  id: string
  kind: RemoteEndpointKind
  protocol: 'sftp' | 'ftp' | 'ftps-explicit' | 'ftps-implicit'
  name: string
  group?: string
  address: string
  initialPath: string
}

export interface RemoteFileEntry {
  name: string
  path: string
  kind: RemoteFileKind
  navigable?: boolean
  size: number
  modifiedAt: number
}

export interface RemoteDirectoryView {
  path: string
  parent: string | null
  entries: RemoteFileEntry[]
}

export interface RemoteFileSystemSession {
  readonly endpoint: RemoteEndpointView
  list(path: string, signal?: AbortSignal): Promise<RemoteDirectoryView>
  stat(path: string, signal?: AbortSignal): Promise<RemoteFileEntry>
  download(path: string, destination: Writable, signal?: AbortSignal): Promise<void>
  upload(path: string, source: Readable, overwrite: boolean, signal?: AbortSignal): Promise<void>
  ensureDirectory(path: string, signal?: AbortSignal): Promise<void>
  remove(path: string, recursive: boolean, signal?: AbortSignal): Promise<void>
  close(): void
}

export interface RemoteFileSystemAdapter {
  readonly kind: RemoteEndpointKind
  endpoint(id: string): RemoteEndpointView | undefined
  endpoints(): RemoteEndpointView[]
  connect(id: string, signal?: AbortSignal): Promise<RemoteFileSystemSession>
}

export function endpointId(kind: RemoteEndpointKind, id: string): string { return `${kind}:${id}` }

export function splitEndpointId(value: string): { kind: RemoteEndpointKind; id: string } | undefined {
  const separator = value.indexOf(':')
  if (separator < 1) return undefined
  const kind = value.slice(0, separator)
  const id = value.slice(separator + 1)
  if ((kind !== 'sftp' && kind !== 'ftp') || id.length === 0) return undefined
  return { kind, id }
}

export function remoteJoin(directory: string, name: string): string {
  return path.posix.join(normalizeRemotePath(directory), name.replaceAll('\\', '/'))
}

export function remoteParent(value: string): string | null {
  const normalized = normalizeRemotePath(value).replace(/\/+$/, '') || '/'
  if (normalized === '/' || /^[A-Za-z]:$/.test(normalized)) return null
  const parent = path.posix.dirname(normalized)
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}/`
  return parent === normalized ? null : parent
}

export function remoteName(value: string): string { return path.posix.basename(normalizeRemotePath(value)) }
export function normalizeRemotePath(value: string): string { return value.replaceAll('\\', '/') || '/' }

export function sortRemoteEntries(entries: RemoteFileEntry[]): RemoteFileEntry[] {
  return entries.sort((left, right) => {
    if (left.kind === 'directory' && right.kind !== 'directory') return -1
    if (left.kind !== 'directory' && right.kind === 'directory') return 1
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
  })
}
