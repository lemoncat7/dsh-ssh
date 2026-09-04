import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  IconChevronLeftOutline14, IconCloseOutline16, IconDataOutline16, IconDownloadOutline16, IconFolderClose16,
  IconEditOutline16, IconFullscreenOutline16, IconRefreshOutline16, IconSendOutline14, IconTrashOutline16, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  ApiError, deleteFileEndpointEntries, deleteLocalWorkspaceEntries, loadLocalWorkspaceDirectory, loadLocalWorkspaceFilePreview, loadProfileSftpDirectory, loadProfileSftpFilePreview,
  loadSftpDirectory, loadSftpFilePreview, localWorkspaceFileUrl, profileAddress, profileSftpFileUrl, sftpFileUrl,
  updateActivityDirectory, uploadProfileSftpFile,
  type ActivityProfileView, type ProfileView, type SftpDirectoryView, type SftpEntryView, type SftpFilePreviewView,
} from './client-api.js'
import { REMOTE_FILES_DRAG_TYPE, isNavigableRemoteEntry, parseRemoteFilesDragPayload, remoteDropOperation, type RemoteFilesDragPayload } from './file-transfer-intent.js'
import { executeRemoteFileDrop } from './remote-file-drop.js'
import { FileEntryDeleteDialog } from './file-entry-delete-dialog.js'

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024

interface SftpExplorerProps {
  initialPath: string
  header?: ReactNode
  workspace?: boolean
  loadDirectory(path: string, persist: boolean): Promise<SftpDirectoryView>
  loadPreview(path: string): Promise<SftpFilePreviewView>
  fileUrl(path: string, inline?: boolean): string
  uploadFile?(directory: string, file: File, overwrite: boolean): Promise<unknown>
  operations?: RemoteFileOperations
  deletion?: FileDeletion
}

interface RemoteFileOperations {
  paneId: string
  endpointId: string
  endpointName: string
}

interface FileDeletion {
  locationName: string
  locationKind: 'local' | 'remote'
  remove(directory: string, paths: string[]): Promise<void>
}

interface PendingOverwriteUpload {
  file: File
  remaining: File[]
  directory: string
}

export function LocalWorkspaceBrowser({ sessionId }: { sessionId: string }): JSX.Element {
  const loadDirectory = useCallback((path: string) => loadLocalWorkspaceDirectory(sessionId, path || undefined), [sessionId])
  const loadPreview = useCallback((path: string) => loadLocalWorkspaceFilePreview(sessionId, path), [sessionId])
  const fileUrl = useCallback((path: string, inline = false) => localWorkspaceFileUrl(sessionId, path, inline), [sessionId])
  const remove = useCallback((directory: string, paths: string[]) => deleteLocalWorkspaceEntries(sessionId, directory, paths), [sessionId])
  return <SftpExplorer initialPath="" loadDirectory={loadDirectory} loadPreview={loadPreview} fileUrl={fileUrl} deletion={{ locationName: '本地会话', locationKind: 'local', remove }} />
}

export function ActivitySftpBrowser({ sessionId, profile, profiles, onProfile, onSaved }: { sessionId: string; profile: ActivityProfileView; profiles: ActivityProfileView[]; onProfile(id: string): void; onSaved(): Promise<void> }): JSX.Element {
  const loadDirectory = useCallback(async (target: string, persist: boolean) => {
    const cwd = persist ? (await updateActivityDirectory(sessionId, profile.id, target)).cwd : target
    const directory = await loadSftpDirectory(sessionId, profile.id, cwd)
    if (persist) await onSaved()
    return directory
  }, [onSaved, profile.id, sessionId])
  const loadPreview = useCallback((path: string) => loadSftpFilePreview(sessionId, profile.id, path), [profile.id, sessionId])
  const fileUrl = useCallback((path: string, inline = false) => sftpFileUrl(sessionId, profile.id, path, inline), [profile.id, sessionId])
  const uploadFile = useCallback((directory: string, file: File, overwrite: boolean) => uploadProfileSftpFile(profile.id, directory, file, overwrite), [profile.id])
  const paneId = safePaneId(`activity-sftp-${sessionId}-${profile.id}`)
  const endpointId = `sftp:${profile.id}`
  const remove = useCallback((directory: string, paths: string[]) => deleteFileEndpointEntries({ paneId, endpointId, directory, paths }), [endpointId, paneId])
  const header = <div className="dsh-ssh-sftp-hostbar">
    <span className="dsh-ssh-host-monogram">{profile.name.slice(0, 1).toUpperCase()}</span>
    <label><span className="sr-only">选择远端主机</span><select value={profile.id} onChange={event => onProfile(event.target.value)}>{profiles.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select><small>{profile.username}@{profile.host}:{profile.port}</small></label>
  </div>
  return <SftpExplorer initialPath={profile.cwd} header={header} loadDirectory={loadDirectory} loadPreview={loadPreview} fileUrl={fileUrl} uploadFile={uploadFile} operations={{ paneId, endpointId, endpointName: profile.name }} deletion={{ locationName: profile.name, locationKind: 'remote', remove }} />
}

export function ProfileSftpPane({ profile, initialPath = '~', onEdit, onDelete, embedded = false }: { profile: ProfileView; initialPath?: string; onEdit?(): void; onDelete?(): void; embedded?: boolean }): JSX.Element {
  const loadDirectory = useCallback((path: string) => loadProfileSftpDirectory(profile.id, path), [profile.id])
  const loadPreview = useCallback((path: string) => loadProfileSftpFilePreview(profile.id, path), [profile.id])
  const fileUrl = useCallback((path: string, inline = false) => profileSftpFileUrl(profile.id, path, inline), [profile.id])
  const uploadFile = useCallback((directory: string, file: File, overwrite: boolean) => uploadProfileSftpFile(profile.id, directory, file, overwrite), [profile.id])
  const paneId = safePaneId(`profile-sftp-${profile.id}`)
  const endpointId = `sftp:${profile.id}`
  const remove = useCallback((directory: string, paths: string[]) => deleteFileEndpointEntries({ paneId, endpointId, directory, paths }), [endpointId, paneId])
  return <div className={`dsh-ssh-profile-sftp-pane${embedded ? ' is-embedded' : ''}`}>
    <div className="dsh-ssh-content-heading"><div><h1>{embedded ? 'SFTP' : `${profile.name} · SFTP`}</h1><p>{embedded ? initialPath : `${profileAddress(profile)} · ${initialPath}`}</p></div><div className="dsh-ssh-heading-actions">{onDelete && <button type="button" className="dsh-ssh-icon-button is-danger" aria-label={`删除主机 ${profile.name}`} title="删除主机" onClick={onDelete}><IconTrashOutline16 size={16} /></button>}{onEdit && <button type="button" className="dsh-ssh-secondary-button" onClick={onEdit}><IconEditOutline16 size={16} />编辑主机</button>}</div></div>
    <SftpExplorer workspace initialPath={initialPath} loadDirectory={loadDirectory} loadPreview={loadPreview} fileUrl={fileUrl} uploadFile={uploadFile} operations={{ paneId, endpointId, endpointName: profile.name }} deletion={{ locationName: profile.name, locationKind: 'remote', remove }} />
  </div>
}

function SftpExplorer({ initialPath, header, workspace = false, loadDirectory, loadPreview, fileUrl, uploadFile, operations, deletion }: SftpExplorerProps): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)
  const [directory, setDirectory] = useState<SftpDirectoryView>()
  const [openedFile, setOpenedFile] = useState<SftpEntryView>()
  const [path, setPath] = useState(initialPath)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState<string>()
  const [pendingOverwrite, setPendingOverwrite] = useState<PendingOverwriteUpload>()
  const [draggingFiles, setDraggingFiles] = useState(false)
  const [remoteDragSource, setRemoteDragSource] = useState<RemoteFilesDragPayload>()
  const [remoteDropTarget, setRemoteDropTarget] = useState<string>()
  const [deleteTarget, setDeleteTarget] = useState<SftpEntryView>()
  const [operationMessage, setOperationMessage] = useState<string>()
  const [error, setError] = useState<string>()
  const browse = useCallback(async (target: string, persist: boolean) => {
    setLoading(true); setError(undefined); setOpenedFile(undefined); setPendingOverwrite(undefined)
    try {
      const next = await loadDirectory(target, persist)
      setDirectory(next); setPath(next.path)
    } catch (reason) { setError(errorMessage(reason)) } finally { setLoading(false) }
  }, [loadDirectory])
  useEffect(() => { void browse(initialPath, false) }, [browse, initialPath])
  const submit = (event: FormEvent): void => { event.preventDefault(); void browse(path, true) }
  const uploadFiles = async (files: File[], targetDirectory = directory?.path, overwriteFirst = false): Promise<void> => {
    if (uploadFile === undefined || targetDirectory === undefined || files.length === 0) return
    const accepted = files.filter(file => file.size <= MAX_UPLOAD_BYTES)
    const oversized = files.length - accepted.length
    if (accepted.length === 0) { setError('单个文件不能超过 512 MB'); return }
    setPendingOverwrite(undefined); setError(undefined)
    for (let index = 0; index < accepted.length; index += 1) {
      const file = accepted[index]!
      const overwrite = overwriteFirst && index === 0
      setUploading(file.name)
      try {
        await uploadFile(targetDirectory, file, overwrite)
      } catch (reason) {
        if (!overwrite && reason instanceof ApiError && reason.status === 409) {
          setPendingOverwrite({ file, remaining: accepted.slice(index + 1), directory: targetDirectory })
        } else {
          setError(errorMessage(reason))
        }
        setUploading(undefined)
        return
      }
    }
    setUploading(undefined)
    await browse(targetDirectory, false)
    if (oversized > 0) setError(`已跳过 ${oversized} 个超过 512 MB 的文件`)
  }
  const canDropFiles = uploadFile !== undefined && directory !== undefined && uploading === undefined && pendingOverwrite === undefined
  const isFileDrag = (event: DragEvent<HTMLDivElement>): boolean => Array.from(event.dataTransfer.types).includes('Files')
  const isRemoteDrag = (event: DragEvent<HTMLElement>): boolean => Array.from(event.dataTransfer.types).includes(REMOTE_FILES_DRAG_TYPE)
  const handleDragEnter = (event: DragEvent<HTMLDivElement>): void => {
    if (!canDropFiles || !isFileDrag(event)) return
    event.preventDefault(); dragDepthRef.current += 1; setDraggingFiles(true)
  }
  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (canDropFiles && isFileDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; return }
    if (operations === undefined || directory === undefined || !isRemoteDrag(event)) return
    const operation = remoteDragSource === undefined ? 'copy' : remoteDropOperation(remoteDragSource, { endpointId: operations.endpointId, directory: directory.path })
    if (operation === 'none' || operation === 'invalid') return
    event.preventDefault(); event.dataTransfer.dropEffect = operation
  }
  const handleDragLeave = (event: DragEvent<HTMLDivElement>): void => {
    if (!isFileDrag(event)) return
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDraggingFiles(false)
  }
  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    dragDepthRef.current = 0; setDraggingFiles(false)
    if (canDropFiles && isFileDrag(event)) {
      event.preventDefault()
      const files = Array.from(event.dataTransfer.files)
      if (files.length > 0) void uploadFiles(files)
      return
    }
    if (operations === undefined || directory === undefined || !isRemoteDrag(event)) return
    event.preventDefault()
    const source = parseRemoteFilesDragPayload(event.dataTransfer.getData(REMOTE_FILES_DRAG_TYPE))
    if (source !== undefined) void applyRemoteDrop(source, directory.path)
  }
  const applyRemoteDrop = async (source: RemoteFilesDragPayload, destinationDirectory: string): Promise<void> => {
    if (operations === undefined) return
    setRemoteDropTarget(undefined); setRemoteDragSource(undefined); setOperationMessage(undefined); setError(undefined)
    try {
      const result = await executeRemoteFileDrop(source, { paneId: operations.paneId, endpointId: operations.endpointId, directory: destinationDirectory })
      if (result.operation === 'move') { setOperationMessage('已移动'); await browse(directory?.path ?? destinationDirectory, false) }
      if (result.operation === 'copy') setOperationMessage('已加入传输任务，可在文件传输中查看进度')
    } catch (reason) { setError(errorMessage(reason)) }
  }
  const removeEntry = async (): Promise<void> => {
    if (deletion === undefined || directory === undefined || deleteTarget === undefined) return
    await deletion.remove(directory.path, [deleteTarget.path])
    await browse(directory.path, false)
  }
  return <div className={`dsh-ssh-sftp${workspace ? ' is-workspace' : ''}${draggingFiles ? ' is-dragging-files' : ''}`} onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
    {header}
    {openedFile ? <SftpFilePreview entry={openedFile} loadPreview={loadPreview} fileUrl={fileUrl} onBack={() => setOpenedFile(undefined)} /> : <>
      <form className={`dsh-ssh-sftp-pathbar${uploadFile === undefined ? '' : ' has-upload'}`} onSubmit={submit}>
        <button type="button" aria-label="返回上级目录" title="返回上级目录" disabled={directory?.parent == null || loading} onClick={() => { if (directory?.parent) void browse(directory.parent, true) }}><IconChevronLeftOutline14 size={14} /></button>
        <input aria-label="当前远端目录" value={path} spellCheck={false} onChange={event => setPath(event.target.value)} />
        <button type="button" aria-label="刷新目录" title="刷新目录" disabled={loading} onClick={() => { void browse(directory?.path ?? path, false) }}><IconRefreshOutline16 size={15} /></button>
        {uploadFile !== undefined && <><input ref={fileInputRef} className="sr-only" type="file" multiple tabIndex={-1} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length > 0) void uploadFiles(files) }} /><button type="button" className="dsh-ssh-sftp-upload-button" disabled={directory === undefined || uploading !== undefined || pendingOverwrite !== undefined} onClick={() => fileInputRef.current?.click()}><IconSendOutline14 size={14} />{uploading === undefined ? '上传' : '上传中'}</button></>}
      </form>
      {pendingOverwrite !== undefined && <div className="dsh-ssh-upload-conflict" role="alert"><span><strong>同名文件已存在</strong><small>{pendingOverwrite.file.name}</small></span><span><button type="button" onClick={() => { const pending = pendingOverwrite; setPendingOverwrite(undefined); void uploadFiles(pending.remaining, pending.directory) }}>跳过</button><button type="button" className="is-primary" disabled={uploading !== undefined} onClick={() => { const pending = pendingOverwrite; void uploadFiles([pending.file, ...pending.remaining], pending.directory, true) }}>覆盖上传</button></span></div>}
      {operationMessage && <div className="dsh-ssh-sftp-operation-status" role="status"><span>{operationMessage}</span><button type="button" aria-label="关闭提示" onClick={() => setOperationMessage(undefined)}><IconCloseOutline16 size={14} /></button></div>}
      {error && <p className="dsh-ssh-directory-error" role="alert">{error}</p>}
      <div className="dsh-ssh-sftp-table dsh-ssh-scroll-surface" aria-busy={loading}>
        <div className="dsh-ssh-sftp-columns"><span>名称</span><span>大小</span><span>修改时间</span><span aria-hidden="true" /></div>
        {loading && directory === undefined ? <p className="dsh-ssh-sftp-state">正在读取远端目录…</p>
          : directory?.entries.length === 0 ? <p className="dsh-ssh-sftp-state">此目录为空</p>
            : directory?.entries.map(entry => {
              const directoryEntry = isNavigableRemoteEntry(entry)
              const dragOperation = remoteDragSource === undefined || operations === undefined ? undefined : remoteDropOperation(remoteDragSource, { endpointId: operations.endpointId, directory: entry.path })
              const acceptsRemoteDrop = directoryEntry && dragOperation !== 'none' && dragOperation !== 'invalid'
              return <div role="row" tabIndex={0} aria-label={`${entry.name}${directoryEntry ? '，目录，单击进入；可接收拖放' : '，文件，单击预览'}`} data-ssh-interactive="row" data-ssh-context-row draggable={operations !== undefined && (entry.kind === 'file' || directoryEntry)} className={`dsh-ssh-sftp-row is-${directoryEntry ? 'directory' : entry.kind}${remoteDropTarget === entry.path ? ' is-drop-target' : ''}`} key={entry.path}
                onClick={() => { if (directoryEntry) void browse(entry.path, true); else setOpenedFile(entry) }}
                onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter') { if (directoryEntry) void browse(entry.path, true); else setOpenedFile(entry) } }}
                onDragStart={event => { if (operations === undefined || directory === undefined) return; const source = { paneId: operations.paneId, endpointId: operations.endpointId, directory: directory.path, paths: [entry.path] }; setRemoteDragSource(source); event.dataTransfer.effectAllowed = 'copyMove'; event.dataTransfer.setData(REMOTE_FILES_DRAG_TYPE, JSON.stringify(source)) }}
                onDragEnd={() => { setRemoteDragSource(undefined); setRemoteDropTarget(undefined) }}
                onDragOver={event => { const fileDrop = canDropFiles && isFileDrag(event); if (!directoryEntry || (!fileDrop && !isRemoteDrag(event)) || (!fileDrop && !acceptsRemoteDrop)) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = fileDrop || dragOperation !== 'move' ? 'copy' : 'move'; setRemoteDropTarget(entry.path) }}
                onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setRemoteDropTarget(undefined) }}
                onDrop={event => { if (!directoryEntry) return; event.preventDefault(); event.stopPropagation(); setRemoteDropTarget(undefined); if (canDropFiles && isFileDrag(event)) { const files = Array.from(event.dataTransfer.files); if (files.length > 0) void uploadFiles(files, entry.path); return } const source = parseRemoteFilesDragPayload(event.dataTransfer.getData(REMOTE_FILES_DRAG_TYPE)); if (source !== undefined) void applyRemoteDrop(source, entry.path) }}>
              <span>{directoryEntry ? <IconFolderClose16 size={16} /> : <IconDataOutline16 size={16} />}<strong title={entry.name}>{entry.name}</strong></span>
              <small>{directoryEntry ? '-' : formatBytes(entry.size)}</small>
              <small>{formatFileTime(entry.modifiedAt)}</small>
              {deletion !== undefined && <button type="button" className="dsh-ssh-sftp-row-delete dsh-ssh-context-action" draggable={false} aria-label={`删除 ${entry.name}`} title={`删除 ${entry.name}`} onClick={event => { event.stopPropagation(); setDeleteTarget(entry) }}><IconTrashOutline16 size={14} /></button>}
            </div>})}
      </div>
    </>}
    {draggingFiles && <div className="dsh-ssh-sftp-dropzone" aria-hidden="true"><span><strong>松开以上传</strong><small>上传到 {directory?.path ?? path}</small></span></div>}
    {deleteTarget !== undefined && deletion !== undefined && <FileEntryDeleteDialog locationName={deletion.locationName} locationKind={deletion.locationKind} entries={[deleteTarget]} onClose={() => setDeleteTarget(undefined)} onDelete={removeEntry} />}
  </div>
}

function SftpFilePreview({ entry, loadPreview, fileUrl, onBack }: { entry: SftpEntryView; loadPreview(path: string): Promise<SftpFilePreviewView>; fileUrl(path: string, inline?: boolean): string; onBack(): void }): JSX.Element {
  const [preview, setPreview] = useState<SftpFilePreviewView>()
  const [error, setError] = useState<string>()
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    let cancelled = false
    setPreview(undefined); setError(undefined)
    void loadPreview(entry.path).then(value => { if (!cancelled) setPreview(value) }).catch(reason => { if (!cancelled) setError(errorMessage(reason)) })
    return () => { cancelled = true }
  }, [entry.path, loadPreview])
  const downloadUrl = fileUrl(entry.path)
  return <><section className="dsh-ssh-file-preview">
    <header><button type="button" className="dsh-ssh-icon-button" aria-label="返回目录" title="返回目录" onClick={onBack}><IconChevronLeftOutline14 size={14} /></button><span className="dsh-ssh-file-preview-title"><strong title={entry.name}>{entry.name}</strong><small>{formatBytes(entry.size)}</small></span><span className="dsh-ssh-file-preview-actions"><a href={downloadUrl} aria-label="下载文件" title="下载文件"><IconDownloadOutline16 size={16} /></a><button type="button" aria-label="放大预览" title="放大预览" onClick={() => setExpanded(true)}><IconFullscreenOutline16 size={16} /></button></span></header>
    <div className="dsh-ssh-file-preview-body dsh-ssh-scroll-surface"><SftpPreviewContent entry={entry} preview={preview} error={error} fileUrl={fileUrl} downloadUrl={downloadUrl} /></div>
  </section><Modal open={expanded} onClose={() => setExpanded(false)} title={`预览 ${entry.name}`} headless className="dsh-ssh-preview-modal"><section className="dsh-ssh-preview-modal-shell"><header><span><strong title={entry.name}>{entry.name}</strong><small>{formatBytes(entry.size)}</small></span><span className="dsh-ssh-file-preview-actions"><a href={downloadUrl} aria-label="下载文件" title="下载文件"><IconDownloadOutline16 size={16} /></a><button type="button" aria-label="关闭预览" title="关闭预览" onClick={() => setExpanded(false)}><IconCloseOutline16 size={16} /></button></span></header><div className="dsh-ssh-file-preview-body is-modal dsh-ssh-scroll-surface"><SftpPreviewContent entry={entry} preview={preview} error={error} fileUrl={fileUrl} downloadUrl={downloadUrl} /></div></section></Modal></>
}

function SftpPreviewContent({ entry, preview, error, fileUrl, downloadUrl }: { entry: SftpEntryView; preview: SftpFilePreviewView | undefined; error: string | undefined; fileUrl(path: string, inline?: boolean): string; downloadUrl: string }): JSX.Element {
  if (error) return <p className="dsh-ssh-directory-error" role="alert">{error}</p>
  if (preview === undefined) return <p className="dsh-ssh-sftp-state">正在打开文件…</p>
  if (preview.kind === 'text' && preview.mimeType === 'text/markdown') return <><article className="dsh-ssh-markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: props => <a {...props} target="_blank" rel="noreferrer" /> }}>{preview.text || ''}</ReactMarkdown></article>{preview.truncated && <small>文件较大，仅显示前 1 MB。下载可查看完整内容。</small>}</>
  if (preview.kind === 'text') return <><pre>{preview.text || ''}</pre>{preview.truncated && <small>文件较大，仅显示前 1 MB。下载可查看完整内容。</small>}</>
  if (preview.kind === 'image') return <img src={fileUrl(entry.path, true)} alt={entry.name} />
  if (preview.kind === 'pdf') return <iframe src={fileUrl(entry.path, true)} title={entry.name} />
  return <div className="dsh-ssh-file-binary"><IconDataOutline16 size={24} /><strong>此文件无法直接预览</strong><p>{preview.mimeType}</p><a href={downloadUrl}><IconDownloadOutline16 size={16} />下载文件</a></div>
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let size = value / 1024
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1 }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`
}

function formatFileTime(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(value)
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function safePaneId(value: string): string { return value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100) }
