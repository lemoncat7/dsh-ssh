import { useSshLocale } from './use-ssh-locale.js'
import { t } from './i18n.js'
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react'
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
  saveLocalWorkspaceMarkdown, saveActivityMarkdown, saveProfileMarkdown, type MarkdownSaveInput,
  loadLocalWorkspacePathEntry, loadProfileSftpPathEntry, loadSftpPathEntry,
  type ActivityProfileView, type ProfileView, type SftpDirectoryView, type SftpEntryView, type SftpFilePreviewView,
} from './client-api.js'
import { REMOTE_FILES_DRAG_TYPE, isNavigableRemoteEntry, parseRemoteFilesDragPayload, remoteDropOperation, type RemoteFilesDragPayload } from './file-transfer-intent.js'
import { executeRemoteFileDrop } from './remote-file-drop.js'
import { FileEntryDeleteDialog } from './file-entry-delete-dialog.js'
import { explorerInputPath } from './explorer-path.js'
import { FileNameTooltip } from './file-name-tooltip.js'
import { NativeDirectoryButton } from './native-directory-button.js'
import { useFilePreview } from './use-file-preview.js'
import { PreviewRefreshControl } from './preview-refresh-control.js'
import { HtmlFilePreview } from './html-file-preview.js'
import { MarkdownPreviewEditor, supportsMarkdownEditing } from './markdown-preview-editor.js'
import { useMarkdownDraft, type SaveMarkdown } from './use-markdown-draft.js'
import { Dialog } from './ui-components.js'

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024

interface SftpExplorerProps {
  nativeSessionId?: string
  initialPath: string
  followPath?: string | undefined
  followControl?: ReactNode
  header?: ReactNode
  mountedDirectories?: Array<{ id: string; name: string; path: string }> | undefined
  workspace?: boolean
  loadDirectory(path: string, persist: boolean): Promise<SftpDirectoryView>
  loadPreview(path: string, signal?: AbortSignal): Promise<SftpFilePreviewView>
  saveMarkdown?: SaveMarkdown
  loadPathEntry(path: string, signal?: AbortSignal): Promise<SftpEntryView>
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
  useSshLocale()
  const saveMarkdown = useCallback((input: MarkdownSaveInput) => saveLocalWorkspaceMarkdown(sessionId, input), [sessionId])
  const loadPathEntry = useCallback((path: string, signal?: AbortSignal) => loadLocalWorkspacePathEntry(sessionId, path, signal), [sessionId])
  const loadDirectory = useCallback((path: string) => loadLocalWorkspaceDirectory(sessionId, path || undefined), [sessionId])
  const loadPreview = useCallback((path: string, signal?: AbortSignal) => loadLocalWorkspaceFilePreview(sessionId, path, signal), [sessionId])
  const fileUrl = useCallback((path: string, inline = false) => localWorkspaceFileUrl(sessionId, path, inline), [sessionId])
  const remove = useCallback((directory: string, paths: string[]) => deleteLocalWorkspaceEntries(sessionId, directory, paths), [sessionId])
  return <SftpExplorer key={sessionId} nativeSessionId={sessionId} initialPath="" loadPathEntry={loadPathEntry} loadDirectory={loadDirectory} loadPreview={loadPreview} saveMarkdown={saveMarkdown} fileUrl={fileUrl} deletion={{ locationName: t("sftp-client.localSession"), locationKind: 'local', remove }} />
}

export function ActivitySftpBrowser({ sessionId, profile, profiles, onProfile, onSaved }: { sessionId: string; profile: ActivityProfileView; profiles: ActivityProfileView[]; onProfile(id: string): void; onSaved(): Promise<void> }): JSX.Element {
  useSshLocale()
  const saveMarkdown = useCallback((input: MarkdownSaveInput) => saveActivityMarkdown(sessionId, profile.id, input), [sessionId, profile.id])
  const loadPathEntry = useCallback((path: string, signal?: AbortSignal) => loadSftpPathEntry(sessionId, profile.id, path, signal), [sessionId, profile.id])
  const loadDirectory = useCallback(async (target: string, persist: boolean) => {
    const cwd = persist ? (await updateActivityDirectory(sessionId, profile.id, target)).cwd : target
    const directory = await loadSftpDirectory(sessionId, profile.id, cwd)
    if (persist) await onSaved()
    return directory
  }, [onSaved, profile.id, sessionId])
  const loadPreview = useCallback((path: string, signal?: AbortSignal) => loadSftpFilePreview(sessionId, profile.id, path, signal), [profile.id, sessionId])
  const fileUrl = useCallback((path: string, inline = false) => sftpFileUrl(sessionId, profile.id, path, inline), [profile.id, sessionId])
  const uploadFile = useCallback((directory: string, file: File, overwrite: boolean) => uploadProfileSftpFile(profile.id, directory, file, overwrite), [profile.id])
  const paneId = safePaneId(`activity-sftp-${sessionId}-${profile.id}`)
  const endpointId = `sftp:${profile.id}`
  const remove = useCallback((directory: string, paths: string[]) => deleteFileEndpointEntries({ paneId, endpointId, directory, paths }), [endpointId, paneId])
  const header = <div className="dsh-ssh-sftp-hostbar">
    <span className="dsh-ssh-host-monogram">{profile.name.slice(0, 1).toUpperCase()}</span>
    <label><span className="sr-only">{t("sftp-client.selectRemoteHost")}</span><select value={profile.id} onChange={event => onProfile(event.target.value)}>{profiles.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select><small>{profile.username}@{profile.host}:{profile.port}</small></label>
  </div>
  return <SftpExplorer key={`${sessionId}:${profile.id}`} initialPath={profile.cwd} mountedDirectories={profile.mountedDirectories} header={header} loadPathEntry={loadPathEntry} loadDirectory={loadDirectory} loadPreview={loadPreview} saveMarkdown={saveMarkdown} fileUrl={fileUrl} uploadFile={uploadFile} operations={{ paneId, endpointId, endpointName: profile.name }} deletion={{ locationName: profile.name, locationKind: 'remote', remove }} />
}

export function ProfileSftpPane({ profile, initialPath = '~', onEdit, onDelete, embedded = false, terminalPath }: { profile: ProfileView; initialPath?: string; onEdit?(): void; onDelete?(): void; embedded?: boolean; terminalPath?: string | undefined }): JSX.Element {
  useSshLocale()
  const [following, setFollowing] = useState(true)
  const saveMarkdown = useCallback((input: MarkdownSaveInput) => saveProfileMarkdown(profile.id, input), [profile.id])
  const loadPathEntry = useCallback((path: string, signal?: AbortSignal) => loadProfileSftpPathEntry(profile.id, path, signal), [profile.id])
  const loadDirectory = useCallback((path: string) => loadProfileSftpDirectory(profile.id, path), [profile.id])
  const loadPreview = useCallback((path: string, signal?: AbortSignal) => loadProfileSftpFilePreview(profile.id, path, signal), [profile.id])
  const fileUrl = useCallback((path: string, inline = false) => profileSftpFileUrl(profile.id, path, inline), [profile.id])
  const uploadFile = useCallback((directory: string, file: File, overwrite: boolean) => uploadProfileSftpFile(profile.id, directory, file, overwrite), [profile.id])
  const paneId = safePaneId(`profile-sftp-${profile.id}`)
  const endpointId = `sftp:${profile.id}`
  const remove = useCallback((directory: string, paths: string[]) => deleteFileEndpointEntries({ paneId, endpointId, directory, paths }), [endpointId, paneId])
  return <div className={`dsh-ssh-profile-sftp-pane${embedded ? ' is-embedded' : ''}`}>
    <div className="dsh-ssh-content-heading"><div><h1>{embedded ? 'SFTP' : `${profile.name} · SFTP`}</h1><p>{embedded ? initialPath : `${profileAddress(profile)} · ${initialPath}`}</p></div><div className="dsh-ssh-heading-actions">{onDelete && <button type="button" className="dsh-ssh-icon-button is-danger" aria-label={t("client.deleteHost", [profile.name])} title={t("client.deleteHost2")} onClick={onDelete}><IconTrashOutline16 size={16} /></button>}{onEdit && <button type="button" className="dsh-ssh-secondary-button" onClick={onEdit}><IconEditOutline16 size={16} />{t("client.editHost")}</button>}</div></div>
    <SftpExplorer key={profile.id} workspace initialPath={initialPath} followPath={embedded && following ? terminalPath : undefined} followControl={embedded && <button type="button" className="dsh-ssh-follow-directory" aria-label={t('sftp-client.followTerminal')} aria-pressed={following} data-waiting={following && terminalPath === undefined} title={terminalPath === undefined ? t('sftp-client.followWaiting') : t('sftp-client.followHint')} onClick={() => setFollowing(value => !value)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l2-2" /></svg></button>} loadPathEntry={loadPathEntry} loadDirectory={loadDirectory} loadPreview={loadPreview} saveMarkdown={saveMarkdown} fileUrl={fileUrl} uploadFile={uploadFile} operations={{ paneId, endpointId, endpointName: profile.name }} deletion={{ locationName: profile.name, locationKind: 'remote', remove }} />
  </div>
}

function SftpExplorer({ initialPath, followPath, followControl, nativeSessionId, header, mountedDirectories, workspace = false, loadDirectory, loadPreview, saveMarkdown, loadPathEntry, fileUrl, uploadFile, operations, deletion }: SftpExplorerProps): JSX.Element {
  useSshLocale()
  const [expanded, setExpanded] = useState(false)
  const navigationId = useRef(0)
  const errorId = useId()
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
  const lastFollowed = useRef<string>()
  const browse = useCallback(async (target: string, persist: boolean) => {
    const request = ++navigationId.current
    setLoading(true); setError(undefined); setOpenedFile(undefined); setPendingOverwrite(undefined)
    try {
      const next = await loadDirectory(target, persist)
      if (request !== navigationId.current) return
      setDirectory(next); setPath(next.path)
    } catch (reason) { if (request === navigationId.current) setError(errorMessage(reason)) } finally { if (request === navigationId.current) setLoading(false) }
  }, [loadDirectory])
  useEffect(() => { void browse(initialPath, false); return () => { navigationId.current++ } }, [browse, initialPath])
  useEffect(() => {
    if (followPath === undefined) { lastFollowed.current = undefined; return }
    // Never dismiss a preview/draft, a confirmation, a path being typed, or an upload.
    if (loading || openedFile || uploading || pendingOverwrite || deleteTarget || !directory || path !== directory.path || lastFollowed.current === followPath) return
    const timer = window.setTimeout(() => {
      lastFollowed.current = followPath
      if (followPath !== directory.path) void browse(followPath, false)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [followPath, loading, openedFile, uploading, pendingOverwrite, deleteTarget, directory, path, browse])
  const openEntry = (entry: SftpEntryView): void => {
    if (isNavigableRemoteEntry(entry)) { void browse(entry.path, true); return }
    navigationId.current++; setLoading(false); setError(undefined); setPath(directory?.path ?? initialPath); setOpenedFile(entry)
  }
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (loading) return
    const request = ++navigationId.current
    setLoading(true); setError(undefined)
    try {
      const entry = await loadPathEntry(explorerInputPath(path, directory?.path ?? initialPath))
      if (request !== navigationId.current) return
      if (entry.kind !== 'directory' && entry.kind !== 'file') throw new Error(t("sftp-client.thisPathIsNotARegularFileOrDirectory"))
      openEntry(entry)
    } catch (reason) { if (request === navigationId.current) setError(errorMessage(reason)) }
    finally { if (request === navigationId.current) setLoading(false) }
  }
  const uploadFiles = async (files: File[], targetDirectory = directory?.path, overwriteFirst = false): Promise<void> => {
    if (uploadFile === undefined || targetDirectory === undefined || files.length === 0) return
    const accepted = files.filter(file => file.size <= MAX_UPLOAD_BYTES)
    const oversized = files.length - accepted.length
    if (accepted.length === 0) { setError(t("sftp-client.aSingleFileCannotExceed512Mb")); return }
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
    if (oversized > 0) setError(t("sftp-client.skippedFilesLargerThan512Mb", [oversized]))
  }
  const canDropFiles = uploadFile !== undefined && directory !== undefined && uploading === undefined && pendingOverwrite === undefined
  const isFileDrag = (event: DragEvent<HTMLDivElement>): boolean => Array.from(event.dataTransfer.types).includes('Files')
  const isRemoteDrag = (event: DragEvent<HTMLElement>): boolean => Array.from(event.dataTransfer.types).includes(REMOTE_FILES_DRAG_TYPE)
  const handleDragEnter = (event: DragEvent<HTMLDivElement>): void => {
    if (uploadFile === undefined || !isFileDrag(event)) return
    event.preventDefault(); event.stopPropagation()
    dragDepthRef.current += 1
    if (canDropFiles) setDraggingFiles(true)
  }
  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (uploadFile !== undefined && isFileDrag(event)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = canDropFiles ? 'copy' : 'none'; return }
    if (operations === undefined || directory === undefined || !isRemoteDrag(event)) return
    const operation = remoteDragSource === undefined ? 'copy' : remoteDropOperation(remoteDragSource, { endpointId: operations.endpointId, directory: directory.path })
    if (operation === 'none' || operation === 'invalid') return
    event.preventDefault(); event.dataTransfer.dropEffect = operation
  }
  const handleDragLeave = (event: DragEvent<HTMLDivElement>): void => {
    if (uploadFile === undefined || !isFileDrag(event)) return
    event.stopPropagation()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDraggingFiles(false)
  }
  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    dragDepthRef.current = 0; setDraggingFiles(false)
    if (uploadFile !== undefined && isFileDrag(event)) {
      event.preventDefault(); event.stopPropagation()
      if (!canDropFiles) { setError(t("sftp-client.waitForTheDirectoryToLoadOrTheCurrent")); return }
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
      if (result.operation === 'move') { setOperationMessage(t("sftp-client.moved")); await browse(directory?.path ?? destinationDirectory, false) }
      if (result.operation === 'copy') setOperationMessage(t("sftp-client.addedToTheTransferQueueSeeProgressInFile"))
    } catch (reason) { setError(errorMessage(reason)) }
  }
  const removeEntry = async (): Promise<void> => {
    if (deletion === undefined || directory === undefined || deleteTarget === undefined) return
    await deletion.remove(directory.path, [deleteTarget.path])
    await browse(directory.path, false)
  }
  const content = <div className={`dsh-ssh-sftp${workspace || expanded ? ' is-workspace' : ''}${draggingFiles ? ' is-dragging-files' : ''}`} onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
    {header}
    {mountedDirectories && mountedDirectories.length > 0 && <nav className="dsh-ssh-mounted-directories" aria-label={t("sftp-client.mountedDirectories")}>{mountedDirectories.map(project => <button key={project.id} type="button" data-ssh-interactive="choice" className={directory?.path === project.path ? 'is-active' : ''} title={project.path} disabled={loading} onClick={() => { void browse(project.path, true) }}><IconFolderClose16 size={14} /><span>{project.name}</span></button>)}</nav>}
    {openedFile ? <SftpFilePreview key={openedFile.path} entry={openedFile} loadPreview={loadPreview} saveMarkdown={saveMarkdown} loadPathEntry={loadPathEntry} fileUrl={fileUrl} onBack={() => setOpenedFile(undefined)} inDirectoryModal={expanded} /> : <>
      <form className={`dsh-ssh-sftp-pathbar${uploadFile === undefined ? '' : ' has-upload'}${nativeSessionId === undefined ? '' : ' has-native-open'}${followControl ? ' has-follow' : ''}`} aria-busy={loading} onSubmit={event => { void submit(event) }}>
        <button type="button" aria-label={t("sftp-client.goToParentDirectory")} title={t("sftp-client.goToParentDirectory")} disabled={directory?.parent == null || loading} onClick={() => { if (directory?.parent) void browse(directory.parent, true) }}><IconChevronLeftOutline14 size={14} /></button>
        <input aria-label={t("sftp-client.directoryOrFilePath")} title={t("sftp-client.enterADirectoryToBrowseOrAFileTo")} placeholder={t("sftp-client.directoryOrFilePathPressEnterToOpen")} value={path} readOnly={loading} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} spellCheck={false} onChange={event => { setPath(event.target.value); setError(undefined) }} onKeyDown={event => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }} />
        <button type="button" aria-label={t("file-transfer-workspace.refreshDirectory")} title={t("file-transfer-workspace.refreshDirectory")} disabled={loading} onClick={() => { void browse(directory?.path ?? path, false) }}><IconRefreshOutline16 size={15} /></button>
        {followControl}
        <button type="button" aria-label={expanded ? t("sftp-client.closeDirectoryDialog") : t("sftp-client.expandDirectory")} title={expanded ? t("sftp-client.closeDirectoryDialog") : t("sftp-client.openDirectoryInADialog")} disabled={directory === undefined} onClick={() => setExpanded(value => !value)}><IconFullscreenOutline16 size={16} /></button>
        {nativeSessionId !== undefined && <NativeDirectoryButton sessionId={nativeSessionId} path={directory?.path} onMessage={setOperationMessage} />}
        {uploadFile !== undefined && <><input ref={fileInputRef} className="sr-only" type="file" multiple tabIndex={-1} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length > 0) void uploadFiles(files) }} /><button type="button" className="dsh-ssh-sftp-upload-button" disabled={directory === undefined || uploading !== undefined || pendingOverwrite !== undefined} onClick={() => fileInputRef.current?.click()}><IconSendOutline14 size={14} />{uploading === undefined ? t("sftp-client.upload") : t("sftp-client.uploading")}</button></>}
      </form>
      {pendingOverwrite !== undefined && <div className="dsh-ssh-upload-conflict" role="alert"><span><strong>{t("sftp-client.aFileWithTheSameNameExists")}</strong><small>{pendingOverwrite.file.name}</small></span><span><button type="button" onClick={() => { const pending = pendingOverwrite; setPendingOverwrite(undefined); void uploadFiles(pending.remaining, pending.directory) }}>{t("sftp-client.skip")}</button><button type="button" className="is-primary" disabled={uploading !== undefined} onClick={() => { const pending = pendingOverwrite; void uploadFiles([pending.file, ...pending.remaining], pending.directory, true) }}>{t("sftp-client.overwriteAndUpload")}</button></span></div>}
      {operationMessage && <div className="dsh-ssh-sftp-operation-status" role="status"><span>{operationMessage}</span><button type="button" aria-label={t("sftp-client.dismissNotice")} onClick={() => setOperationMessage(undefined)}><IconCloseOutline16 size={14} /></button></div>}
      {error && <p id={errorId} className="dsh-ssh-directory-error" role="alert">{error}</p>}
      <div className="dsh-ssh-sftp-table dsh-ssh-scroll-surface" aria-busy={loading}>
        <div className="dsh-ssh-sftp-columns"><span>{t("client.name")}</span><span>{t("file-transfer-workspace.size")}</span><span>{t("file-transfer-workspace.modified")}</span><span aria-hidden="true" /></div>
        {loading && directory === undefined ? <p className="dsh-ssh-sftp-state">{t("sftp-client.readingRemoteDirectory")}</p>
          : directory?.entries.length === 0 ? <p className="dsh-ssh-sftp-state">{t("sftp-client.thisDirectoryIsEmpty")}</p>
            : directory?.entries.map(entry => {
              const directoryEntry = isNavigableRemoteEntry(entry)
              const dragOperation = remoteDragSource === undefined || operations === undefined ? undefined : remoteDropOperation(remoteDragSource, { endpointId: operations.endpointId, directory: entry.path })
              const acceptsRemoteDrop = directoryEntry && dragOperation !== 'none' && dragOperation !== 'invalid'
              return <div role="row" tabIndex={0} aria-label={`${entry.name}${directoryEntry ? t("file-transfer-workspace.directoryClickToEnterAcceptsDragDrop") : t("sftp-client.fileClickToPreview")}`} data-ssh-interactive="row" data-ssh-context-row draggable={operations !== undefined && (entry.kind === 'file' || directoryEntry)} className={`dsh-ssh-sftp-row is-${directoryEntry ? 'directory' : entry.kind}${remoteDropTarget === entry.path ? ' is-drop-target' : ''}`} key={entry.path}
                onClick={() => openEntry(entry)}
                onKeyDown={event => { if (event.key === 'Enter' && !(event.target instanceof Element && event.target.closest('button, a'))) openEntry(entry) }}
                onDragStart={event => { if (operations === undefined || directory === undefined) return; const source = { paneId: operations.paneId, endpointId: operations.endpointId, directory: directory.path, paths: [entry.path] }; setRemoteDragSource(source); event.dataTransfer.effectAllowed = 'copyMove'; event.dataTransfer.setData(REMOTE_FILES_DRAG_TYPE, JSON.stringify(source)) }}
                onDragEnd={() => { setRemoteDragSource(undefined); setRemoteDropTarget(undefined) }}
                onDragOver={event => { const fileDrop = canDropFiles && isFileDrag(event); if (!directoryEntry || (!fileDrop && !isRemoteDrag(event)) || (!fileDrop && !acceptsRemoteDrop)) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = fileDrop || dragOperation !== 'move' ? 'copy' : 'move'; setRemoteDropTarget(entry.path) }}
                onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setRemoteDropTarget(undefined) }}
                onDrop={event => { if (!directoryEntry) return; event.preventDefault(); event.stopPropagation(); setRemoteDropTarget(undefined); if (canDropFiles && isFileDrag(event)) { const files = Array.from(event.dataTransfer.files); if (files.length > 0) void uploadFiles(files, entry.path); return } const source = parseRemoteFilesDragPayload(event.dataTransfer.getData(REMOTE_FILES_DRAG_TYPE)); if (source !== undefined) void applyRemoteDrop(source, entry.path) }}>
              <FileNameTooltip name={entry.name}>{directoryEntry ? <IconFolderClose16 size={16} /> : <IconDataOutline16 size={16} />}<strong>{entry.name}</strong></FileNameTooltip>
              <small>{directoryEntry ? '-' : formatBytes(entry.size)}</small>
              <small>{formatFileTime(entry.modifiedAt)}</small>
              <div className="dsh-ssh-sftp-row-actions">
                {entry.kind === 'file' && <a className="dsh-ssh-sftp-row-download dsh-ssh-context-action" draggable={false} href={fileUrl(entry.path)} download={entry.name} aria-label={t('sftp-client.downloadEntry', [entry.name])} title={t('sftp-client.downloadEntry', [entry.name])} onClick={event => event.stopPropagation()}><IconDownloadOutline16 size={14} /></a>}
                {deletion !== undefined && <button type="button" className="dsh-ssh-sftp-row-delete dsh-ssh-context-action" draggable={false} aria-label={t("client.delete2", [entry.name])} title={t("client.delete2", [entry.name])} onClick={event => { event.stopPropagation(); setDeleteTarget(entry) }}><IconTrashOutline16 size={14} /></button>}
              </div>
            </div>})}
      </div>
    </>}
    {draggingFiles && <div className="dsh-ssh-sftp-dropzone" aria-hidden="true"><span><strong>{t("sftp-client.releaseToUpload")}</strong><small>{t("sftp-client.uploadTo")} {directory?.path ?? path}</small></span></div>}
    {deleteTarget !== undefined && deletion !== undefined && <FileEntryDeleteDialog locationName={deletion.locationName} locationKind={deletion.locationKind} entries={[deleteTarget]} onClose={() => setDeleteTarget(undefined)} onDelete={removeEntry} />}
  </div>
  return <>{!expanded && content}<Modal open={expanded} onClose={() => setExpanded(false)} title={t("sftp-client.browseDirectory")} headless className="dsh-ssh-preview-modal"><section className="dsh-ssh-preview-modal-shell"><header><span><strong>{t("sftp-client.browseDirectory")}</strong><small title={directory?.path}>{directory?.path}</small></span><span className="dsh-ssh-file-preview-actions"><button type="button" aria-label={t("sftp-client.closeDirectoryDialog2")} onClick={() => setExpanded(false)}><IconCloseOutline16 size={16} /></button></span></header><div className="dsh-ssh-directory-modal-body">{expanded && content}</div></section></Modal></>
}

export function SftpFilePreview({ entry, loadPreview, saveMarkdown, loadPathEntry, fileUrl, onBack, inDirectoryModal = false }: { entry: SftpEntryView; saveMarkdown?: SaveMarkdown | undefined; loadPreview(path: string, signal?: AbortSignal): Promise<SftpFilePreviewView>; loadPathEntry(path: string, signal?: AbortSignal): Promise<SftpEntryView>; fileUrl(path: string, inline?: boolean): string; onBack(): void; inDirectoryModal?: boolean }): JSX.Element {
  const sshLocale = useSshLocale()
  const [expanded, setExpanded] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'leave' | 'discard'>()
  const inlineBody = useRef<HTMLDivElement>(null)
  const modalBody = useRef<HTMLDivElement>(null)
  const { preview, error, busy, locked, setLocked, refresh, revision } = useFilePreview(entry.path, loadPreview, loadPathEntry, [inlineBody, modalBody])
  const draft = useMarkdownDraft(fileUrl(entry.path), entry.path, preview, saveMarkdown, refresh)
  const editableMarkdown = Boolean(saveMarkdown && /\.md$/i.test(entry.path) && preview?.mimeType === 'text/markdown' && preview.contentHash && !preview.truncated && preview.size <= 262144 && supportsMarkdownEditing(preview.text || ''))
  const readOnlyNote = saveMarkdown && /\.md$/i.test(entry.path) && preview && !editableMarkdown ? <p className="dsh-ssh-preview-edit-status">{t("sftp-client.thisDocumentIsReadOnlyItMayExceed256")}</p> : undefined
  const markdownEditor = useMemo(() => editableMarkdown ? <MarkdownPreviewEditor text={draft.text} editable={!locked && !draft.saving && !busy} onChange={draft.change} onSave={() => { if (!locked) void draft.save() }} /> : undefined, [editableMarkdown, draft.text, draft.saving, draft.change, draft.save, locked, busy, sshLocale])
  const saveControls = editableMarkdown ? <button type="button" className="dsh-ssh-preview-save" aria-label={t("sftp-client.saveMarkdown")} title={t("sftp-client.saveBodyCtrlCmdS")} disabled={!draft.dirty || draft.saving || locked || busy} onClick={() => void draft.save()}>{draft.saving ? t("remote-workspace-tree.saving") : draft.dirty ? t("commands-panel.save") : t("sftp-client.saved")}</button> : undefined
  const draftActions = draft.dirty ? <span className="dsh-ssh-draft-actions"><button type="button" onClick={() => {
    const url = URL.createObjectURL(new Blob([draft.text], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = entry.name; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }}>{t("sftp-client.downloadDraft")}</button><button type="button" disabled={draft.saving} onClick={() => setConfirmAction('discard')}>{t("sftp-client.discardDraft")}</button></span> : undefined
  const confirmDialog = confirmAction ? <Dialog title={confirmAction === 'leave' ? t("sftp-client.unsavedChanges") : t("sftp-client.discardUnsavedChanges")} subtitle={confirmAction === 'leave' ? t("sftp-client.theDraftStaysInThisBrowserTabSoYou") : t("sftp-client.thisClearsTheDraftAndReloadsTheFileConsider")} onClose={() => setConfirmAction(undefined)}><div className="dsh-ssh-draft-actions"><button type="button" onClick={() => setConfirmAction(undefined)}>{t("sftp-client.keepEditing")}</button><button type="button" onClick={() => { const action = confirmAction; setConfirmAction(undefined); if (action === 'leave') onBack(); else void draft.discard() }}>{confirmAction === 'leave' ? t("sftp-client.keepDraftAndGoBack") : t("sftp-client.discardAndRefresh")}</button></div></Dialog> : undefined
  const previewUrl = useCallback((path: string, inline?: boolean) => {
    const url = fileUrl(path, inline)
    return inline ? `${url}${url.includes('?') ? '&' : '?'}previewRevision=${revision}` : url
  }, [fileUrl, revision])
  const controls = <>{saveControls}<PreviewRefreshControl busy={busy || draft.saving} blocked={draft.dirty} automatic={locked} available={Boolean(preview && preview.kind !== 'pdf' && !draft.dirty && !draft.saving)} onRefresh={() => void refresh()} onToggle={() => setLocked(value => !value)} /></>
  const downloadUrl = fileUrl(entry.path)
  return <><section className="dsh-ssh-file-preview" style={expanded ? { visibility: 'hidden' } : undefined}>
    <header><button type="button" className="dsh-ssh-icon-button" aria-label={t("sftp-client.backToDirectory")} title={t("sftp-client.backToDirectory")} disabled={draft.saving} onClick={() => draft.dirty ? setConfirmAction('leave') : onBack()}><IconChevronLeftOutline14 size={14} /></button><span className="dsh-ssh-file-preview-title"><strong title={entry.name}>{entry.name}</strong><small>{formatBytes(preview?.size ?? entry.size)}</small></span><span className="dsh-ssh-file-preview-actions">{controls}<a href={downloadUrl} aria-label={t("sftp-client.downloadFile")} title={t("sftp-client.downloadFile")}><IconDownloadOutline16 size={16} /></a>{!inDirectoryModal && <button type="button" aria-label={t("sftp-client.zoomPreview")} title={t("sftp-client.zoomPreview")} onClick={() => setExpanded(true)}><IconFullscreenOutline16 size={16} /></button>}</span></header>{readOnlyNote}{(editableMarkdown || draft.dirty) && <p className="dsh-ssh-preview-edit-status" role="status">{draft.message || (draft.dirty ? t("sftp-client.unsavedDraftKeptInThisBrowserTab") : locked ? t("sftp-client.autoRefreshReadOnly") : t("sftp-client.editDirectlyCtrlCmdSToSave"))}{draftActions}</p>}{error && preview && <p className="dsh-ssh-preview-refresh-error" role="status">{t("sftp-client.refreshFailedPreviousContentKept")}{error}</p>}
    <div ref={inlineBody} className="dsh-ssh-file-preview-body dsh-ssh-scroll-surface"><SftpPreviewContent markdownEditor={markdownEditor} entry={entry} preview={preview} error={preview ? undefined : error} fileUrl={previewUrl} downloadUrl={downloadUrl} /></div>
  </section><Modal open={expanded} onClose={() => setExpanded(false)} title={t("sftp-client.preview", [entry.name])} headless className="dsh-ssh-preview-modal"><section className="dsh-ssh-preview-modal-shell"><header><span><strong title={entry.name}>{entry.name}</strong><small>{formatBytes(preview?.size ?? entry.size)}</small></span><span className="dsh-ssh-file-preview-actions">{controls}<a href={downloadUrl} aria-label={t("sftp-client.downloadFile")} title={t("sftp-client.downloadFile")}><IconDownloadOutline16 size={16} /></a><button type="button" aria-label={t("sftp-client.closePreview")} title={t("sftp-client.closePreview")} onClick={() => setExpanded(false)}><IconCloseOutline16 size={16} /></button></span></header>{readOnlyNote}{(editableMarkdown || draft.dirty) && <p className="dsh-ssh-preview-edit-status" role="status">{draft.message || (draft.dirty ? t("sftp-client.unsavedDraftKeptInThisBrowserTab") : locked ? t("sftp-client.autoRefreshReadOnly") : t("sftp-client.editDirectlyCtrlCmdSToSave"))}{draftActions}</p>}{error && preview && <p className="dsh-ssh-preview-refresh-error" role="status">{t("sftp-client.refreshFailedPreviousContentKept")}{error}</p>}<div ref={modalBody} className="dsh-ssh-file-preview-body is-modal dsh-ssh-scroll-surface"><SftpPreviewContent markdownEditor={markdownEditor} entry={entry} preview={preview} error={preview ? undefined : error} fileUrl={previewUrl} downloadUrl={downloadUrl} /></div></section></Modal>{confirmDialog}</>
}

const SftpPreviewContent = memo(function SftpPreviewContent({ entry, preview, error, fileUrl, downloadUrl, markdownEditor }: { entry: SftpEntryView; preview: SftpFilePreviewView | undefined; error: string | undefined; fileUrl(path: string, inline?: boolean): string; downloadUrl: string; markdownEditor?: ReactNode }): JSX.Element {
  if (error) return <p className="dsh-ssh-directory-error" role="alert">{error}</p>
  if (preview === undefined) return <p className="dsh-ssh-sftp-state">{t("sftp-client.openingFile")}</p>
  if (markdownEditor) return <>{markdownEditor}</>
  if (preview.kind === 'text' && preview.mimeType === 'text/html') return <HtmlFilePreview text={preview.text || ''} name={entry.name} truncated={Boolean(preview.truncated)} />
  if (preview.kind === 'text' && preview.mimeType === 'text/markdown') return <><article className="dsh-ssh-markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: props => <a {...props} target="_blank" rel="noreferrer" /> }}>{preview.text || ''}</ReactMarkdown></article>{preview.truncated && <small>{t("sftp-client.largeFileShowingTheFirst1MbOnlyDownload")}</small>}</>
  if (preview.kind === 'text') return <><pre>{preview.text || ''}</pre>{preview.truncated && <small>{t("sftp-client.largeFileShowingTheFirst1MbOnlyDownload")}</small>}</>
  if (preview.kind === 'image') return <img src={fileUrl(entry.path, true)} alt={entry.name} />
  if (preview.kind === 'pdf') return <iframe src={fileUrl(entry.path, true)} title={entry.name} />
  return <div className="dsh-ssh-file-binary"><IconDataOutline16 size={24} /><strong>{t("sftp-client.thisFileCannotBePreviewedDirectly")}</strong><p>{preview.mimeType}</p><a href={downloadUrl}><IconDownloadOutline16 size={16} />{t("sftp-client.downloadFile")}</a></div>
})

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
