import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  IconChevronLeftOutline14, IconDataOutline16, IconDownloadOutline16, IconFolderClose16,
  IconRefreshOutline16, IconSendOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  ApiError, loadProfileSftpDirectory, loadProfileSftpFilePreview, loadSftpDirectory, loadSftpFilePreview,
  profileAddress, profileSftpFileUrl, sftpFileUrl, updateActivityDirectory, uploadProfileSftpFile,
  type ActivityProfileView, type ProfileView, type SftpDirectoryView, type SftpEntryView, type SftpFilePreviewView,
} from './client-api.js'

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024

interface SftpExplorerProps {
  initialPath: string
  header?: ReactNode
  workspace?: boolean
  loadDirectory(path: string, persist: boolean): Promise<SftpDirectoryView>
  loadPreview(path: string): Promise<SftpFilePreviewView>
  fileUrl(path: string, inline?: boolean): string
  uploadFile?(directory: string, file: File, overwrite: boolean): Promise<unknown>
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
  const header = <div className="dsh-ssh-sftp-hostbar">
    <span className="dsh-ssh-host-monogram">{profile.name.slice(0, 1).toUpperCase()}</span>
    <label><span className="sr-only">选择远端主机</span><select value={profile.id} onChange={event => onProfile(event.target.value)}>{profiles.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select><small>{profile.username}@{profile.host}:{profile.port}</small></label>
  </div>
  return <SftpExplorer initialPath={profile.cwd} header={header} loadDirectory={loadDirectory} loadPreview={loadPreview} fileUrl={fileUrl} />
}

export function ProfileSftpPane({ profile }: { profile: ProfileView }): JSX.Element {
  const loadDirectory = useCallback((path: string) => loadProfileSftpDirectory(profile.id, path), [profile.id])
  const loadPreview = useCallback((path: string) => loadProfileSftpFilePreview(profile.id, path), [profile.id])
  const fileUrl = useCallback((path: string, inline = false) => profileSftpFileUrl(profile.id, path, inline), [profile.id])
  const uploadFile = useCallback((directory: string, file: File, overwrite: boolean) => uploadProfileSftpFile(profile.id, directory, file, overwrite), [profile.id])
  return <div className="dsh-ssh-profile-sftp-pane">
    <div className="dsh-ssh-content-heading"><div><h1>{profile.name} · SFTP</h1><p>{profileAddress(profile)} · 浏览和传输远端文件</p></div></div>
    <SftpExplorer workspace initialPath="~" loadDirectory={loadDirectory} loadPreview={loadPreview} fileUrl={fileUrl} uploadFile={uploadFile} />
  </div>
}

function SftpExplorer({ initialPath, header, workspace = false, loadDirectory, loadPreview, fileUrl, uploadFile }: SftpExplorerProps): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [directory, setDirectory] = useState<SftpDirectoryView>()
  const [openedFile, setOpenedFile] = useState<SftpEntryView>()
  const [path, setPath] = useState(initialPath)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState<string>()
  const [pendingOverwrite, setPendingOverwrite] = useState<File>()
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
  const upload = async (file: File, overwrite: boolean): Promise<void> => {
    if (uploadFile === undefined || directory === undefined) return
    if (file.size > MAX_UPLOAD_BYTES) { setError('单个文件不能超过 512 MB'); return }
    setUploading(file.name); setError(undefined)
    try {
      await uploadFile(directory.path, file, overwrite)
      setPendingOverwrite(undefined)
      await browse(directory.path, false)
    } catch (reason) {
      if (!overwrite && reason instanceof ApiError && reason.status === 409) setPendingOverwrite(file)
      else setError(errorMessage(reason))
    } finally { setUploading(undefined) }
  }
  return <div className={`dsh-ssh-sftp${workspace ? ' is-workspace' : ''}`}>
    {header}
    {openedFile ? <SftpFilePreview entry={openedFile} loadPreview={loadPreview} fileUrl={fileUrl} onBack={() => setOpenedFile(undefined)} /> : <>
      <form className={`dsh-ssh-sftp-pathbar${uploadFile === undefined ? '' : ' has-upload'}`} onSubmit={submit}>
        <button type="button" aria-label="返回上级目录" title="返回上级目录" disabled={directory?.parent == null || loading} onClick={() => { if (directory?.parent) void browse(directory.parent, true) }}><IconChevronLeftOutline14 size={14} /></button>
        <input aria-label="当前远端目录" value={path} spellCheck={false} onChange={event => setPath(event.target.value)} />
        <button type="button" aria-label="刷新目录" title="刷新目录" disabled={loading} onClick={() => { void browse(directory?.path ?? path, false) }}><IconRefreshOutline16 size={15} /></button>
        {uploadFile !== undefined && <><input ref={fileInputRef} className="sr-only" type="file" tabIndex={-1} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file !== undefined) void upload(file, false) }} /><button type="button" className="dsh-ssh-sftp-upload-button" disabled={directory === undefined || uploading !== undefined} onClick={() => fileInputRef.current?.click()}><IconSendOutline14 size={14} />{uploading === undefined ? '上传' : '上传中'}</button></>}
      </form>
      {pendingOverwrite !== undefined && <div className="dsh-ssh-upload-conflict" role="alert"><span><strong>同名文件已存在</strong><small>{pendingOverwrite.name}</small></span><span><button type="button" onClick={() => setPendingOverwrite(undefined)}>取消</button><button type="button" className="is-primary" disabled={uploading !== undefined} onClick={() => { void upload(pendingOverwrite, true) }}>覆盖上传</button></span></div>}
      {error && <p className="dsh-ssh-directory-error" role="alert">{error}</p>}
      <div className="dsh-ssh-sftp-table" aria-busy={loading}>
        <div className="dsh-ssh-sftp-columns"><span>名称</span><span>大小</span><span>修改时间</span></div>
        {loading && directory === undefined ? <p className="dsh-ssh-sftp-state">正在读取远端目录…</p>
          : directory?.entries.length === 0 ? <p className="dsh-ssh-sftp-state">此目录为空</p>
            : directory?.entries.map(entry => <button type="button" className={`dsh-ssh-sftp-row is-${entry.kind}`} key={entry.path} onClick={() => { if (entry.kind === 'directory') void browse(entry.path, true); else setOpenedFile(entry) }}>
              <span>{entry.kind === 'directory' ? <IconFolderClose16 size={16} /> : <IconDataOutline16 size={16} />}<strong title={entry.name}>{entry.name}</strong></span>
              <small>{entry.kind === 'directory' ? '-' : formatBytes(entry.size)}</small>
              <small>{formatFileTime(entry.modifiedAt)}</small>
            </button>)}
      </div>
    </>}
  </div>
}

function SftpFilePreview({ entry, loadPreview, fileUrl, onBack }: { entry: SftpEntryView; loadPreview(path: string): Promise<SftpFilePreviewView>; fileUrl(path: string, inline?: boolean): string; onBack(): void }): JSX.Element {
  const [preview, setPreview] = useState<SftpFilePreviewView>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let cancelled = false
    setPreview(undefined); setError(undefined)
    void loadPreview(entry.path).then(value => { if (!cancelled) setPreview(value) }).catch(reason => { if (!cancelled) setError(errorMessage(reason)) })
    return () => { cancelled = true }
  }, [entry.path, loadPreview])
  const downloadUrl = fileUrl(entry.path)
  return <section className="dsh-ssh-file-preview">
    <header><button type="button" className="dsh-ssh-icon-button" aria-label="返回目录" title="返回目录" onClick={onBack}><IconChevronLeftOutline14 size={14} /></button><span><strong title={entry.name}>{entry.name}</strong><small>{formatBytes(entry.size)}</small></span><a href={downloadUrl} aria-label="下载文件" title="下载文件"><IconDownloadOutline16 size={16} /></a></header>
    <div className="dsh-ssh-file-preview-body">
      {error ? <p className="dsh-ssh-directory-error" role="alert">{error}</p>
        : preview === undefined ? <p className="dsh-ssh-sftp-state">正在打开文件…</p>
          : preview.kind === 'text' ? <><pre>{preview.text || ''}</pre>{preview.truncated && <small>文件较大，仅显示前 1 MB。下载可查看完整内容。</small>}</>
            : preview.kind === 'image' ? <img src={fileUrl(entry.path, true)} alt={entry.name} />
              : preview.kind === 'pdf' ? <iframe src={fileUrl(entry.path, true)} title={entry.name} />
                : <div className="dsh-ssh-file-binary"><IconDataOutline16 size={24} /><strong>此文件无法直接预览</strong><p>{preview.mimeType}</p><a href={downloadUrl}><IconDownloadOutline16 size={16} />下载文件</a></div>}
    </div>
  </section>
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
