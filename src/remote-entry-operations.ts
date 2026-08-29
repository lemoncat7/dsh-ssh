import type { RemoteFileSystemSession } from './remote-files.js'
import { normalizeRemotePath, remoteJoin, remoteName } from './remote-files.js'

export interface RemoteEntrySelection {
  directory: string
  paths: string[]
}

export interface RemoteEntryMove extends RemoteEntrySelection {
  destinationDirectory: string
}

export async function deleteRemoteEntries(session: RemoteFileSystemSession, selection: RemoteEntrySelection): Promise<void> {
  const directory = await session.list(selection.directory)
  assertDirectChildren(directory.path, directory.entries.map(entry => entry.path), selection.paths)
  for (const path of selection.paths) await session.remove(path, true)
}

export async function moveRemoteEntries(session: RemoteFileSystemSession, request: RemoteEntryMove): Promise<void> {
  const source = await session.list(request.directory)
  const destination = await session.list(request.destinationDirectory)
  if (sameRemotePath(source.path, destination.path)) return
  assertDirectChildren(source.path, source.entries.map(entry => entry.path), request.paths)
  for (const path of request.paths) if (isRemoteDescendant(path, destination.path)) throw operationError(400, 'a directory cannot be moved into itself or one of its descendants')
  const destinationNames = new Set(destination.entries.map(entry => entry.name))
  for (const path of request.paths) if (destinationNames.has(remoteName(path))) throw operationError(409, `destination already contains ${remoteName(path)}`)
  for (const path of request.paths) await session.move(path, remoteJoin(destination.path, remoteName(path)))
}

function assertDirectChildren(directory: string, availablePaths: string[], requestedPaths: string[]): void {
  const available = new Set(availablePaths)
  for (const path of requestedPaths) if (!available.has(path)) throw operationError(404, `remote path ${path} is not a direct child of ${directory}`)
}

function sameRemotePath(left: string, right: string): boolean { return comparableRemotePath(left) === comparableRemotePath(right) }
function isRemoteDescendant(parent: string, target: string): boolean {
  const normalizedParent = comparableRemotePath(parent)
  const normalizedTarget = comparableRemotePath(target)
  return normalizedTarget === normalizedParent || normalizedTarget.startsWith(`${normalizedParent}/`)
}
function comparableRemotePath(value: string): string { return normalizeRemotePath(value).replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/' }
function operationError(status: number, message: string): Error { return Object.assign(new Error(message), { status }) }
