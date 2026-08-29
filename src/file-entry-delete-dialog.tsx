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
  return <Dialog className="dsh-ssh-file-delete-dialog" title={`删除 ${entries.length} 项？`} subtitle={`${locationName} · 此操作无法撤销`} onClose={() => { if (!deleting) onClose() }}>
    <div className="dsh-ssh-file-delete-copy"><span><IconTrashOutline16 size={18} /></span><p>将直接从{locationKind === 'local' ? '当前会话目录' : '远端'}删除所选内容。{directories > 0 ? `其中 ${directories} 个目录及其全部内容会被递归删除。` : ''}</p></div>
    <div className="dsh-ssh-file-delete-list">{entries.slice(0, 6).map(entry => <div key={entry.path}>{entry.kind === 'directory' ? <IconFolderClose16 size={17} /> : <IconDataOutline16 size={17} />}<span><strong>{entry.name}</strong><small title={entry.path}>{entry.path}</small></span></div>)}{entries.length > 6 && <p>以及其他 {entries.length - 6} 项</p>}</div>
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    <div className="dsh-ssh-dialog-actions"><span /><button type="button" className="dsh-ssh-secondary-button" data-ssh-dialog-close disabled={deleting} onClick={onClose}>取消</button><button type="button" className="dsh-ssh-danger-button" disabled={deleting} onClick={() => { void submit() }}>{deleting ? '正在删除…' : '确认删除'}</button></div>
  </Dialog>
}
