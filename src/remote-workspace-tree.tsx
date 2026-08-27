import { useMemo, useState, type FormEvent } from 'react'
import type { WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconChevronDownOutline14, IconEditOutline16, IconFolderClose16,
  IconFolderOpenOutline16, IconPlusOutline16, IconTrashOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  createRemoteProject, deleteRemoteProject, loadRemoteProjects, updateRemoteProject,
  type InjectionView, type ProfileView, type RemoteProjectView,
} from './client-api.js'
import { ProjectSessionDialog } from './project-session-dialog.js'
import { Dialog } from './ui-components.js'

export interface RemoteTarget {
  profileId: string
  path: string
  projectId?: string
}

interface RemoteWorkspaceTreeProps {
  profiles: ProfileView[]
  access: InjectionView | null
  accessLoading: boolean
  accessSaving: boolean
  accessError?: string | undefined
  workspaces: readonly WorkspaceView[]
  currentWorkspaceId?: string | undefined
  recentWorkspaceId?: string | undefined
  selected: RemoteTarget | null
  onSelect(target: RemoteTarget): void
  onProfiles(profileIds: string[]): void
  onDirectory(profileId: string, path?: string, projectId?: string): void
  onPermission(permission: InjectionView['permission']): void
  onApproval(value: boolean): void
  onCreateSession(project: RemoteProjectView, workspaceId: string): Promise<void>
  onNewProfile(): void
}

export function RemoteWorkspaceTree(props: RemoteWorkspaceTreeProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [projects, setProjects] = useState<Record<string, RemoteProjectView[]>>({})
  const [loadingProfile, setLoadingProfile] = useState<string>()
  const [editing, setEditing] = useState<{ profile: ProfileView; project?: RemoteProjectView }>()
  const [creatingSession, setCreatingSession] = useState<{ profile: ProfileView; project: RemoteProjectView; returnFocus: HTMLButtonElement }>()
  const [error, setError] = useState<string>()
  const normalized = query.trim().toLocaleLowerCase()
  const groups = useMemo(() => groupProfiles(props.profiles.filter(profile => searchText(profile).includes(normalized))), [normalized, props.profiles])

  const refreshProjects = async (profileId: string): Promise<void> => {
    setLoadingProfile(profileId)
    try {
      const next = await loadRemoteProjects(profileId)
      setProjects(current => ({ ...current, [profileId]: next }))
      setError(undefined)
    } catch (reason) { setError(message(reason)) } finally { setLoadingProfile(current => current === profileId ? undefined : current) }
  }
  const toggleExpanded = (profileId: string): void => {
    setExpanded(current => {
      const next = new Set(current)
      if (next.has(profileId)) next.delete(profileId)
      else next.add(profileId)
      return next
    })
    if (projects[profileId] === undefined) void refreshProjects(profileId)
  }
  const toggleProfile = (profileId: string): void => {
    const current = props.access?.profileIds ?? []
    const enabled = current.includes(profileId)
    props.onProfiles(enabled ? current.filter(id => id !== profileId) : [...current, profileId])
    if (enabled) props.onDirectory(profileId, undefined)
  }

  return <aside className="dsh-ssh-remote-tree">
    <header className="dsh-ssh-tree-header">
      <span><strong>主机与项目</strong><small>{props.profiles.length} 台主机</small></span>
      <button type="button" className="dsh-ssh-icon-button" onClick={props.onNewProfile} aria-label="新建连接" title="新建连接"><IconPlusOutline16 size={16} /></button>
    </header>
    <label className="dsh-ssh-search"><span className="sr-only">搜索主机</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索主机、分组、标签…" /></label>
    <div className="dsh-ssh-tree-scroll dsh-ssh-scroll-surface">
      {groups.map(group => <section className="dsh-ssh-tree-group" key={group.name}>
        <h3><span>{group.name}</span><small>{group.profiles.length}</small></h3>
        {group.profiles.map(profile => {
          const open = expanded.has(profile.id)
          const enabled = props.access?.profileIds.includes(profile.id) === true
          const children = projects[profile.id] ?? []
          const active = props.selected?.profileId === profile.id && props.selected.projectId === undefined
          return <div className="dsh-ssh-tree-host" key={profile.id} data-open={open}>
            <div className={`dsh-ssh-tree-host-row${enabled ? ' is-authorized' : ''}${active ? ' is-active' : ''}`}>
              <button type="button" className="dsh-ssh-tree-disclosure" aria-label={`${open ? '收起' : '展开'} ${profile.name} 的固定目录`} aria-expanded={open} onClick={() => toggleExpanded(profile.id)}>
                <span className="dsh-ssh-tree-chevron"><IconChevronDownOutline14 size={12} /></span>
              </button>
              <button type="button" className="dsh-ssh-tree-host-main" aria-pressed={props.access === null ? undefined : enabled} title={props.access === null ? '当前没有可授权的 DSH 会话' : enabled ? '撤销当前会话访问' : '允许当前会话访问'} onClick={() => {
                if (props.access !== null && !props.accessLoading) toggleProfile(profile.id)
                props.onSelect({ profileId: profile.id, path: '~' })
              }}>
                <span className="dsh-ssh-host-monogram">{profile.name.slice(0, 1).toUpperCase()}</span>
                <span><strong>{profile.name}</strong><small>{profile.username}@{profile.host}</small></span>
              </button>
              {enabled && <span className="dsh-ssh-mount-state">已挂载</span>}
              <button type="button" className="dsh-ssh-tree-add" aria-label={`为 ${profile.name} 添加固定目录`} title="添加固定目录" onClick={() => setEditing({ profile })}><IconPlusOutline16 size={14} /></button>
            </div>
            {open && <div className="dsh-ssh-tree-branches">
              {loadingProfile === profile.id && projects[profile.id] === undefined ? <p className="dsh-ssh-tree-state">正在读取固定目录…</p>
                : children.length === 0 ? <button type="button" className="dsh-ssh-tree-empty" onClick={() => setEditing({ profile })}><IconPlusOutline16 size={13} />添加项目目录</button>
                  : children.map(project => {
                    const projectActive = props.selected?.projectId === project.id
                    const bound = props.access?.workingProjectIds[profile.id] === project.id
                    return <div className="dsh-ssh-tree-project" key={project.id}>
                      <div className={`dsh-ssh-tree-project-row${projectActive ? ' is-active' : ''}${bound ? ' is-bound' : ''}`}>
                        <button type="button" className="dsh-ssh-tree-project-main" aria-pressed={props.access === null ? undefined : bound} title={props.access === null ? '当前没有可固定目录的 DSH 会话' : !enabled ? '请先挂载该主机' : bound ? '取消当前会话的固定目录' : '固定为当前会话目录'} onClick={() => {
                          if (enabled && !props.accessLoading && !props.accessSaving) {
                            props.onDirectory(profile.id, bound ? undefined : project.path, bound ? undefined : project.id)
                            props.onSelect(bound ? { profileId: profile.id, path: '~' } : { profileId: profile.id, path: project.path, projectId: project.id })
                          }
                        }}><span>{bound ? <IconFolderOpenOutline16 size={15} /> : <IconFolderClose16 size={15} />}</span><span><strong>{project.name}</strong><small>{project.path}</small>{bound && <em>当前会话已固定该路径</em>}</span></button>
                        <button type="button" className="dsh-ssh-tree-project-new" aria-label={`在 ${project.name} 新建会话`} title="新建会话" onClick={event => { setError(undefined); setCreatingSession({ profile, project, returnFocus: event.currentTarget }) }}><IconPlusOutline16 size={13} /></button>
                        <button type="button" className="dsh-ssh-tree-project-edit" aria-label={`编辑 ${project.name}`} title="编辑固定目录" onClick={() => setEditing({ profile, project })}><IconEditOutline16 size={13} /></button>
                      </div>
                    </div>
                  })}
            </div>}
          </div>
        })}
      </section>)}
      {groups.length === 0 && <p className="dsh-ssh-tree-no-results">{props.profiles.length === 0 ? '还没有 SSH 主机' : '没有匹配的主机'}</p>}
    </div>
    <SessionAccessFooter access={props.access} loading={props.accessLoading} saving={props.accessSaving} error={props.accessError ?? error} onPermission={props.onPermission} onApproval={props.onApproval} />
    {editing !== undefined && <RemoteProjectDialog profile={editing.profile} project={editing.project} onClose={() => setEditing(undefined)} onSaved={async () => { const profileId = editing.profile.id; setEditing(undefined); await refreshProjects(profileId) }} />}
    {creatingSession !== undefined && <ProjectSessionDialog {...creatingSession} workspaces={props.workspaces} currentWorkspaceId={props.currentWorkspaceId} recentWorkspaceId={props.recentWorkspaceId} onClose={() => setCreatingSession(undefined)} onCreate={props.onCreateSession} />}
  </aside>
}

function SessionAccessFooter({ access, loading, saving, error, onPermission, onApproval }: { access: InjectionView | null; loading: boolean; saving: boolean; error?: string | undefined; onPermission(value: InjectionView['permission']): void; onApproval(value: boolean): void }): JSX.Element {
  return <footer className="dsh-ssh-access-footer">
    <div className="dsh-ssh-access-heading"><span><strong>当前会话权限</strong><small>{access?.profileIds.length ?? 0} 台主机可用</small></span><em>{loading ? '读取中' : saving ? '保存中' : '已同步'}</em></div>
    <div className="dsh-ssh-access-segments" aria-label="SSH 权限">
      <button type="button" className={access?.permission === 'exec' ? 'is-active' : ''} aria-pressed={access?.permission === 'exec'} disabled={access === null} onClick={() => onPermission('exec')}>仅命令</button>
      <button type="button" className={access?.permission === 'terminal' ? 'is-active' : ''} aria-pressed={access?.permission === 'terminal'} disabled={access === null} onClick={() => onPermission('terminal')}>终端控制</button>
    </div>
    <label className="dsh-ssh-access-approval"><span><strong>执行前确认</strong><small>{access?.requireCommandApproval === false ? '关闭后按当前会话权限直接执行' : '需 DSH 使用 Ask；Full Access 会直接拒绝'}</small></span><input type="checkbox" checked={access?.requireCommandApproval ?? true} disabled={access === null} onChange={event => onApproval(event.target.checked)} /><i aria-hidden="true" /></label>
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
  </footer>
}

function RemoteProjectDialog({ profile, project, onClose, onSaved }: { profile: ProfileView; project?: RemoteProjectView | undefined; onClose(): void; onSaved(): Promise<void> }): JSX.Element {
  const [name, setName] = useState(project?.name ?? '')
  const [path, setPath] = useState(project?.path ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); setSaving(true); setError(undefined)
    try {
      if (project === undefined) await createRemoteProject(profile.id, { name, path })
      else await updateRemoteProject(profile.id, project.id, { name, path })
      await onSaved()
    } catch (reason) { setError(message(reason)); setSaving(false) }
  }
  const remove = async (): Promise<void> => {
    if (project === undefined || !window.confirm(`删除固定目录“${project.name}”？相关 DSH 会话不会删除。`)) return
    setSaving(true); setError(undefined)
    try { await deleteRemoteProject(profile.id, project.id); await onSaved() } catch (reason) { setError(message(reason)); setSaving(false) }
  }
  return <Dialog className="dsh-ssh-project-dialog" title={project === undefined ? '添加固定目录' : '编辑固定目录'} subtitle={`${profile.name} · 终端与 SFTP 的默认远端路径`} onClose={onClose}>
    <form className="dsh-ssh-form" onSubmit={event => { void submit(event) }}>
        <label className="dsh-ssh-field"><span>名称</span><input required maxLength={80} value={name} placeholder="网站项目" onChange={event => setName(event.target.value)} /></label>
        <label className="dsh-ssh-field"><span>远端路径</span><input required maxLength={4096} value={path} spellCheck={false} placeholder="/var/www/example" onChange={event => setPath(event.target.value)} /><small>保存前会在右侧 SFTP 中验证路径是否可访问。</small></label>
        {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
        <div className="dsh-ssh-dialog-actions">{project !== undefined && <button type="button" className="dsh-ssh-danger-button" disabled={saving} onClick={() => { void remove() }}><IconTrashOutline16 size={15} />删除</button>}<span className="dsh-ssh-dialog-spacer" /><button type="button" className="dsh-ssh-secondary-button" disabled={saving} onClick={onClose}>取消</button><button className="dsh-ssh-primary-button" disabled={saving}>{saving ? '保存中…' : '保存目录'}</button></div>
    </form>
  </Dialog>
}

function groupProfiles(profiles: ProfileView[]): Array<{ name: string; profiles: ProfileView[] }> {
  const result = new Map<string, ProfileView[]>()
  for (const profile of profiles) {
    const name = profile.group?.trim() || '未分组'
    const current = result.get(name)
    if (current === undefined) result.set(name, [profile]); else current.push(profile)
  }
  return [...result].map(([name, grouped]) => ({ name, profiles: grouped }))
}

function searchText(profile: ProfileView): string { return `${profile.name} ${profile.group ?? ''} ${profile.host} ${profile.username} ${profile.tags.join(' ')}`.toLocaleLowerCase() }
function message(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason) }
