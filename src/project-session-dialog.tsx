import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import { IconCloseOutline16, IconFolderClose16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ProfileView, RemoteProjectView } from './client-api.js'

interface ProjectSessionDialogProps {
  profile: ProfileView
  project: RemoteProjectView
  workspaces: readonly WorkspaceView[]
  currentWorkspaceId?: string | undefined
  recentWorkspaceId?: string | undefined
  returnFocus: HTMLButtonElement
  onClose(): void
  onCreate(project: RemoteProjectView, workspaceId: string): Promise<void>
}

export function ProjectSessionDialog({ profile, project, workspaces, currentWorkspaceId, recentWorkspaceId, returnFocus, onClose, onCreate }: ProjectSessionDialogProps): JSX.Element {
  const preferredWorkspaceId = workspaces.some(workspace => String(workspace.workspaceId) === currentWorkspaceId)
    ? currentWorkspaceId
    : workspaces.some(workspace => String(workspace.workspaceId) === recentWorkspaceId) ? recentWorkspaceId : workspaces[0] === undefined ? undefined : String(workspaces[0].workspaceId)
  const [workspaceId, setWorkspaceId] = useState(preferredWorkspaceId)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string>()
  const preferredOptionRef = useRef<HTMLInputElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const initialFocus = preferredOptionRef.current ?? closeButtonRef.current
    initialFocus?.focus()
    return () => { if (returnFocus.isConnected) returnFocus.focus() }
  }, [returnFocus])

  const close = (): void => { if (!creating) onClose() }
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (workspaceId === undefined) return
    setCreating(true); setError(undefined)
    try { await onCreate(project, workspaceId) } catch (reason) { setError(message(reason)); setCreating(false) }
  }

  return <Modal open onClose={close} title="选择会话归属空间" closeLabel="关闭" headless className="dsh-ssh-session-create-modal">
    <section className="dsh-ssh-session-create-shell" onKeyDown={trapDialogFocus}>
      <header><span><h2>新建远端会话</h2><p>选择这个会话在 DSH 中归属的本地项目</p></span><button ref={closeButtonRef} type="button" className="dsh-ssh-icon-button" disabled={creating} onClick={close} aria-label="关闭"><IconCloseOutline16 size={16} /></button></header>
      <form onSubmit={event => { void submit(event) }}>
        <dl className="dsh-ssh-session-create-target"><div><dt>远端主机</dt><dd>{profile.name}<small>{profile.username}@{profile.host}:{profile.port}</small></dd></div><div><dt>远端工作目录</dt><dd>{project.name}<small title={project.path}>{project.path}</small></dd></div></dl>
        <fieldset className="dsh-ssh-workspace-picker"><legend>会话归属空间</legend><p>会话记录保存在所选 DSH 项目中，SSH 命令与终端固定使用上面的远端目录。</p>
          {workspaces.length === 0 ? <div className="dsh-ssh-workspace-picker-empty"><IconFolderClose16 size={18} /><span><strong>还没有可用的 DSH 项目</strong><small>请先关闭此窗口，在 DSH 左侧空间中新建或添加项目。</small></span></div>
            : <div className="dsh-ssh-workspace-options dsh-ssh-scroll-surface" role="radiogroup" aria-label="选择 DSH 项目">{workspaces.map(workspace => {
              const id = String(workspace.workspaceId)
              const status = id === currentWorkspaceId ? '当前项目' : id === recentWorkspaceId ? '最近使用' : undefined
              return <label className="dsh-ssh-workspace-option" key={id}><input ref={id === preferredWorkspaceId ? preferredOptionRef : undefined} className="sr-only" type="radio" name="dsh-ssh-session-workspace" value={id} checked={workspaceId === id} disabled={creating} onChange={() => setWorkspaceId(id)} /><span><span className="dsh-ssh-workspace-option-icon"><IconFolderClose16 size={16} /></span><span className="dsh-ssh-workspace-option-copy"><strong>{workspace.title}</strong><small title={workspace.path}>{workspace.path}</small></span>{status && <em>{status}</em>}<i aria-hidden="true" /></span></label>
            })}</div>}
        </fieldset>
        {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
        <div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" disabled={creating} onClick={close}>取消</button><button type="submit" className="dsh-ssh-primary-button" disabled={creating || workspaceId === undefined}>{creating ? '正在新建…' : '新建并打开'}</button></div>
      </form>
    </section>
  </Modal>
}

function trapDialogFocus(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab') return
  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')).filter(control => control.getClientRects().length > 0)
  const first = controls[0]
  const last = controls[controls.length - 1]
  if (first === undefined || last === undefined) return
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}

function message(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason) }
