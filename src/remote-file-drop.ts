import { moveFileEndpointEntries, startFileTransfer, type TransferJobView } from './client-api.js'
import { remoteDropOperation, type RemoteFilesDragPayload } from './file-transfer-intent.js'

export interface RemoteDropDestination {
  paneId: string
  endpointId: string
  directory: string
}

export interface RemoteDropResult {
  operation: 'none' | 'move' | 'copy'
  job?: TransferJobView
}

/** Applies file-manager drag semantics: move within one endpoint, copy across endpoints. */
export async function executeRemoteFileDrop(source: RemoteFilesDragPayload, destination: RemoteDropDestination): Promise<RemoteDropResult> {
  const operation = remoteDropOperation(source, destination)
  if (operation === 'none') return { operation }
  if (operation === 'invalid') throw new Error("You can't move a directory into itself or one of its subdirectories.")
  if (operation === 'move') {
    await moveFileEndpointEntries({
      paneId: destination.paneId,
      endpointId: destination.endpointId,
      sourceDirectory: source.directory,
      destinationDirectory: destination.directory,
      paths: source.paths,
    })
    return { operation }
  }
  const job = await startFileTransfer({
    sourceEndpointId: source.endpointId,
    sourcePaths: source.paths,
    destinationEndpointId: destination.endpointId,
    destinationDirectory: destination.directory,
    conflictPolicy: 'fail',
  })
  return { operation, job }
}
