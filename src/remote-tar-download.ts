import { pipeline } from 'node:stream/promises'
import { pack as createTarPack } from 'tar-stream'
import type { RemoteFileSystemSession } from './remote-files.js'
import type { RemoteTreeTask } from './remote-tree-scan.js'

/** Streams a standard tar archive directly from the remote protocol into the HTTP response. */
export async function streamRemoteTar(source: RemoteFileSystemSession, tasks: RemoteTreeTask[], destination: NodeJS.WritableStream, signal: AbortSignal): Promise<void> {
  const archive = createTarPack()
  archive.on('error', () => {})
  const output = pipeline(archive, destination, { signal })
  try {
    for (const task of tasks) {
      signal.throwIfAborted()
      const name = archivePath(task.relativePath)
      if (task.kind === 'directory') {
        await addDirectory(archive, name)
        continue
      }
      await addFile(archive, source, task, name, signal)
    }
    archive.finalize()
    await output
  } catch (error) {
    archive.destroy(error instanceof Error ? error : new Error(String(error)))
    await output.catch(() => undefined)
    throw error
  }
}

async function addFile(archive: ReturnType<typeof createTarPack>, source: RemoteFileSystemSession, task: RemoteTreeTask, name: string, signal: AbortSignal): Promise<void> {
  let resolveCommitted!: () => void
  let rejectCommitted!: (error: Error) => void
  const committed = new Promise<void>((resolve, reject) => { resolveCommitted = resolve; rejectCommitted = reject })
  const entry = archive.entry({ name, size: task.size, type: 'file', mode: 0o600 }, error => {
    if (error === null || error === undefined) resolveCommitted()
    else rejectCommitted(error)
  })
  await source.download(task.sourcePath, entry, signal)
  await committed
}

function addDirectory(archive: ReturnType<typeof createTarPack>, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    archive.entry({ name: value.endsWith('/') ? value : `${value}/`, type: 'directory', mode: 0o700 }, error => error === null || error === undefined ? resolve() : reject(error))
  })
}

function archivePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\/+/, '').replace(/\.{2}(?:\/|$)/g, '_/')
  return normalized || 'download'
}
