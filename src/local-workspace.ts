import { t } from './i18n.js'
import { createReadStream } from 'node:fs'
import { lstat, open, readdir, realpath, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { mimeTypeFor, previewKind, type SftpDirectoryView, type SftpFilePreview } from './sftp.js'

const MAX_PREVIEW_BYTES = 1_048_576

export async function listLocalWorkspace(root: string, requestedPath?: string): Promise<SftpDirectoryView> {
  const boundary = await realpath(root)
  const target = await resolveInside(boundary, requestedPath ?? boundary)
  const targetStat = await stat(target)
  if (!targetStat.isDirectory()) throw httpError(400, t("Workspace path is not a directory."))
  const entries = await Promise.all((await readdir(target, { withFileTypes: true })).map(async entry => {
    const entryPath = path.join(target, entry.name)
    const attributes = await lstat(entryPath)
    return {
      name: entry.name,
      path: entryPath,
      kind: entry.isDirectory() ? 'directory' as const : entry.isFile() ? 'file' as const : entry.isSymbolicLink() ? 'symlink' as const : 'other' as const,
      size: attributes.size,
      modifiedAt: attributes.mtimeMs,
    }
  }))
  entries.sort((left, right) => {
    if (left.kind === 'directory' && right.kind !== 'directory') return -1
    if (left.kind !== 'directory' && right.kind === 'directory') return 1
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
  })
  return { path: target, parent: target === boundary ? null : path.dirname(target), entries }
}

export async function readLocalWorkspacePreview(root: string, requestedPath: string): Promise<SftpFilePreview> {
  const boundary = await realpath(root)
  const target = await resolveInside(boundary, requestedPath)
  const attributes = await stat(target)
  if (!attributes.isFile()) throw httpError(400, t("Workspace path is not a file."))
  const mimeType = mimeTypeFor(target)
  const kind = previewKind(mimeType)
  const base = { path: target, name: path.basename(target), size: attributes.size, mimeType, kind }
  if (kind !== 'text') return base
  const length = Math.min(attributes.size, MAX_PREVIEW_BYTES)
  const buffer = Buffer.alloc(length)
  const handle = await open(target, 'r')
  try {
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return { ...base, text: buffer.subarray(0, bytesRead).toString('utf8'), truncated: attributes.size > bytesRead }
  } finally { await handle.close() }
}

export async function openLocalWorkspaceFile(root: string, requestedPath: string): Promise<{ path: string; size: number; mimeType: string; stream: Readable }> {
  const boundary = await realpath(root)
  const target = await resolveInside(boundary, requestedPath)
  const attributes = await stat(target)
  if (!attributes.isFile()) throw httpError(400, t("Workspace path is not a file."))
  return { path: target, size: attributes.size, mimeType: mimeTypeFor(target), stream: createReadStream(target) }
}

export async function deleteLocalWorkspaceEntries(root: string, directory: string, requestedPaths: string[]): Promise<void> {
  const boundary = await realpath(root)
  const currentDirectory = await resolveInside(boundary, directory || boundary)
  if (!(await stat(currentDirectory)).isDirectory()) throw httpError(400, t("Current path is not a directory."))

  const targets = await Promise.all(requestedPaths.map(async requestedPath => {
    const candidate = path.resolve(currentDirectory, requestedPath)
    const relativeToDirectory = path.relative(currentDirectory, candidate)
    if (relativeToDirectory.length === 0 || path.isAbsolute(relativeToDirectory) || relativeToDirectory.startsWith(`..${path.sep}`) || relativeToDirectory.includes(path.sep)) {
      throw httpError(400, t("Only direct children of the current directory can be deleted."))
    }
    const relativeToBoundary = path.relative(boundary, candidate)
    if (path.isAbsolute(relativeToBoundary) || relativeToBoundary === '..' || relativeToBoundary.startsWith(`..${path.sep}`)) {
      throw httpError(403, t("Cannot delete content outside the current session workspace."))
    }
    const attributes = await lstat(candidate)
    return { path: candidate, recursive: attributes.isDirectory() }
  }))

  for (const target of targets) await rm(target.path, { recursive: target.recursive, force: false })
}

async function resolveInside(boundary: string, requestedPath: string): Promise<string> {
  const candidate = path.isAbsolute(requestedPath) ? requestedPath : path.join(boundary, requestedPath)
  let resolved: string
  try { resolved = await realpath(candidate) }
  catch { throw httpError(404, t("Workspace path does not exist.")) }
  const relative = path.relative(boundary, resolved)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw httpError(403, t("Cannot access paths outside the current session workspace."))
  return resolved
}

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status })
}
