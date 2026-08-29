export interface RemoteTransferLocation {
  endpointId: string
  directory: string
}

export interface RemoteFilesDragPayload extends RemoteTransferLocation {
  paneId: string
  paths: string[]
}

export const REMOTE_FILES_DRAG_TYPE = 'application/x-dsh-remote-files'
export type RemoteDropOperation = 'none' | 'move' | 'copy' | 'invalid'

export function isSameRemoteTransferLocation(source: RemoteTransferLocation, destination: RemoteTransferLocation): boolean {
  return source.endpointId === destination.endpointId && normalizeRemoteDirectory(source.directory) === normalizeRemoteDirectory(destination.directory)
}

export function canTransferIntoRemoteDirectory(source: RemoteTransferLocation, sourcePaths: string[], destination: RemoteTransferLocation): boolean {
  if (source.endpointId !== destination.endpointId) return true
  const target = normalizeRemoteDirectory(destination.directory)
  return !sourcePaths.some(path => {
    const candidate = normalizeRemoteDirectory(path)
    return target === candidate || target.startsWith(`${candidate}/`)
  })
}

export function remoteDropOperation(source: RemoteFilesDragPayload, destination: RemoteTransferLocation): RemoteDropOperation {
  if (isSameRemoteTransferLocation(source, destination)) return 'none'
  if (!canTransferIntoRemoteDirectory(source, source.paths, destination)) return 'invalid'
  return source.endpointId === destination.endpointId ? 'move' : 'copy'
}

export function parseRemoteFilesDragPayload(raw: string): RemoteFilesDragPayload | undefined {
  try {
    const value = JSON.parse(raw) as Partial<RemoteFilesDragPayload>
    return typeof value.paneId === 'string' && typeof value.endpointId === 'string' && typeof value.directory === 'string' && Array.isArray(value.paths) && value.paths.every(path => typeof path === 'string')
      ? { paneId: value.paneId, endpointId: value.endpointId, directory: value.directory, paths: value.paths }
      : undefined
  } catch { return undefined }
}

function normalizeRemoteDirectory(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
}
