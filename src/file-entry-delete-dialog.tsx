import { useState } from 'react'
import { IconDataOutline16, IconFolderClose16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SftpEntryView } from './client-api.js'
import { Dialog, errorMessage } from './ui-components.js'

export function FileEntryDeleteDialog({ locationName, locationKind, entries, onClose, onDelete }: { locationName: string; locationKind: 'local' | 'remote'; entries: SftpEntryView[]; onClose(): void; onDelete(): Promise<void> }): JSX.Element {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string>()
  const directories = entries.filter(entry => entry.kind === 'directory').length
  const submit = async (): Promise<void> => {
    setDeleting(true); setError(undefined)
    try { await onDelete(); setDeleting(false); onClose() }
    catch (reason) { setError(errorMessage(reason)); setDeleting(false) }
  }
  return <Dialog className="dsh-ssh-file-delete-dialog" title={`Delete ${entries.length} items?`} subtitle={`${locationName} · this cannot be undone`} onClose={() => { if (!deleting) onClose() }}>
    <div className="dsh-ssh-file-delete-copy"><span><IconTrashOutline16 size={18} /></span><p>The selected items will be deleted directly from {locationKind === 'local' ? "the current session directory" : "the remote"}.{directories > 0 ? `Of these, ${directories} directories and all their contents will be recursively deleted.` : ''}</p></div>
    <div className="dsh-ssh-file-delete-list">{entries.slice(0, 6).map(entry => <div key={entry.path}>{entry.kind === 'directory' ? <IconFolderClose16 size={17} /> : <IconDataOutline16 size={17} />}<span><strong>{entry.name}</strong><small title={entry.path}>{entry.path}</small></span></div>)}{entries.length > 6 && <p>and {entries.length - 6} more items</p>}</div>
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    <div className="dsh-ssh-dialog-actions"><span /><button type="button" className="dsh-ssh-secondary-button" data-ssh-dialog-close disabled={deleting} onClick={onClose}>Cancel</button><button type="button" className="dsh-ssh-danger-button" disabled={deleting} onClick={() => { void submit() }}>{deleting ? "Deleting…" : "Confirm delete"}</button></div>
  </Dialog>
}
