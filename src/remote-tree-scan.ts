import type { RemoteFileEntry, RemoteFileSystemSession } from './remote-files.js'
import { remoteJoin, remoteName } from './remote-files.js'

export interface RemoteTreeTask {
  sourcePath: string
  relativePath: string
  kind: 'directory' | 'file'
  size: number
}

export interface RemoteTreeLimits {
  maxDepth: number
  maxEntries: number
}

const DEFAULT_LIMITS: RemoteTreeLimits = { maxDepth: 64, maxEntries: 20_000 }

/** Scans remote roots once for transfer and archive consumers without following links. */
export async function scanRemoteTree(source: RemoteFileSystemSession, sourcePaths: string[], signal: AbortSignal, limits: RemoteTreeLimits = DEFAULT_LIMITS): Promise<RemoteTreeTask[]> {
  const tasks: RemoteTreeTask[] = []
  const visit = async (sourcePath: string, relativePath: string, depth: number, knownEntry?: RemoteFileEntry): Promise<void> => {
    signal.throwIfAborted()
    if (depth > limits.maxDepth || tasks.length >= limits.maxEntries) throw new Error('remote directory exceeds the safety limit')
    const entry = knownEntry ?? await source.stat(sourcePath, signal)
    if (entry.kind !== 'directory') {
      if (entry.kind === 'file') tasks.push({ sourcePath: entry.path, relativePath, kind: 'file', size: entry.size })
      return
    }
    tasks.push({ sourcePath: entry.path, relativePath, kind: 'directory', size: 0 })
    for (const child of (await source.list(entry.path, signal)).entries) {
      if (child.kind === 'symlink' || child.kind === 'other') continue
      await visit(child.path, remoteJoin(relativePath, child.name), depth + 1, child)
    }
  }
  for (const sourcePath of sourcePaths) await visit(sourcePath, remoteName(sourcePath), 0)
  return tasks
}
