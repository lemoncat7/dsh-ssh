import { useMemo, useState, type FormEvent } from 'react'
import type { WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconChevronDownOutline14, IconChevronRightOutline14, IconEditOutline16, IconFolderClose16,
  IconFolderOpenOutline16, IconPlusOutline16, IconTrashOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  createRemoteProject, deleteRemoteProject, loadRemoteProjects, updateRemoteProject,
  type InjectionView, type ProfileView, type RemoteProjectView,
} from './client-api.js'
import { ProjectSessionDialog } from './project-session-dialog.js'
import { useBorderGlowSurface } from './border-glow.js'
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
  const panelGlow = useBorderGlowSurface<HTMLElement>()
  const [query, setQuery] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
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
  const selectProfile = (profileId: string): void => {
    setExpanded(new Set([profileId]))
    if (projects[profileId] === undefined) void refreshProjects(profileId)
    props.onSelect({ profileId, path: '~' })
  }
  const toggleProfile = (profileId: string): void => {
    const current = props.access?.profileIds ?? []
    const enabled = current.includes(profileId)
    props.onProfiles(enabled ? current.filter(id => id !== profileId) : [...current, profileId])
    if (enabled) props.onDirectory(profileId, undefined)
  }
  const toggleGroup = (name: string): void => setCollapsedGroups(current => {
    const next = new Set(current)
    if (next.has(name)) next.delete(name); else next.add(name)
    return next
  })

  return <aside ref={panelGlow.ref} onPointerMove={panelGlow.onPointerMove} onPointerLeave={panelGlow.onPointerLeave} className="dsh-ssh-remote-tree dsh-ssh-border-surface">
    <header className="dsh-ssh-tree-header">
      <span><strong>Hosts & projects</strong><small>{props.profiles.length} hosts</small></span>
      <button type="button" className="dsh-ssh-icon-button" onClick={props.onNewProfile} aria-label="New connection" title="New connection"><IconPlusOutline16 size={16} /></button>
    </header>
    <label className="dsh-ssh-search"><span className="sr-only">Search hosts</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search hosts, groups, tags…" /></label>
    <div className="dsh-ssh-tree-scroll dsh-ssh-scroll-surface">
      {groups.map(group => {
        const collapsed = collapsedGroups.has(group.name)
        return <section className="dsh-ssh-tree-group" key={group.name} data-collapsed={collapsed}>
        <h3><button type="button" aria-expanded={!collapsed} onClick={() => toggleGroup(group.name)}>{collapsed ? <IconChevronRightOutline14 size={14} /> : <IconChevronDownOutline14 size={14} />}<span>{group.name}</span><small>{group.profiles.length}</small></button></h3>
        {!collapsed && group.profiles.map(profile => {
          const open = expanded.has(profile.id)
          const enabled = props.access?.profileIds.includes(profile.id) === true
          const children = projects[profile.id] ?? []
          const active = props.selected?.profileId === profile.id && props.selected.projectId === undefined
          return <div className="dsh-ssh-tree-host" key={profile.id} data-open={open}>
            <div data-ssh-interactive="row" data-ssh-context-row className={`dsh-ssh-tree-host-row${enabled ? ' is-authorized' : ''}${active ? ' is-active' : ''}`}>
              <button type="button" className="dsh-ssh-tree-host-main" aria-pressed={active} aria-expanded={open} title={`Select and expand ${profile.name}`} onClick={() => selectProfile(profile.id)}>
                <span className="dsh-ssh-host-monogram">{profile.name.slice(0, 1).toUpperCase()}</span>
                <span><strong>{profile.name}</strong><small>{profile.username}@{profile.host}</small></span>
              </button>
              <button
                type="button"
                data-ssh-interactive="choice"
                className={`dsh-ssh-tree-mount dsh-ssh-context-action${enabled ? ' is-mounted' : ''}`}
                aria-label={`${enabled ? "Unmount" : "Mount"} ${profile.name}`}
                aria-pressed={enabled}
                title={props.access === null ? "Open a DSH session before mounting hosts" : enabled ? "Unmount from current session" : "Mount to current session"}
                disabled={props.access === null || props.accessLoading || props.accessSaving}
                onClick={() => toggleProfile(profile.id)}
              >{enabled ? "Unmount" : "Mount"}</button>
              <button type="button" className="dsh-ssh-tree-add" aria-label={`Add pinned directory for ${profile.name}`} title="Add pinned directory" onClick={() => setEditing({ profile })}><IconPlusOutline16 size={14} /></button>
            </div>
            {open && <div className="dsh-ssh-tree-branches">
              {loadingProfile === profile.id && projects[profile.id] === undefined ? <p className="dsh-ssh-tree-state">Reading pinned directories…</p>
                : children.length === 0 ? <button type="button" className="dsh-ssh-tree-empty" onClick={() => setEditing({ profile })}><IconPlusOutline16 size={13} />Add project directory</button>
                  : children.map(project => {
                    const projectActive = props.selected?.projectId === project.id
                    const bound = props.access?.workingProjectIds[profile.id] === project.id
                    return <div className="dsh-ssh-tree-project" key={project.id}>
                      <div data-ssh-interactive="row" className={`dsh-ssh-tree-project-row${projectActive ? ' is-active' : ''}${bound ? ' is-bound' : ''}`}>
                        <button type="button" className="dsh-ssh-tree-project-main" aria-pressed={props.access === null ? undefined : bound} title={props.access === null ? "No DSH session available to pin a directory to" : !enabled ? "Mount this host first" : bound ? "Unpin directory for current session" : "Pin as current session directory"} onClick={() => {
                          if (enabled && !props.accessLoading && !props.accessSaving) {
                            props.onDirectory(profile.id, bound ? undefined : project.path, bound ? undefined : project.id)
                            props.onSelect(bound ? { profileId: profile.id, path: '~' } : { profileId: profile.id, path: project.path, projectId: project.id })
                          }
                        }}><span>{bound ? <IconFolderOpenOutline16 size={15} /> : <IconFolderClose16 size={15} />}</span><span><strong>{project.name}</strong><small>{project.path}</small>{bound && <em>Pinned to the current session</em>}</span></button>
                        <button type="button" className="dsh-ssh-tree-project-new" aria-label={`New session in ${project.name}`} title="New session" onClick={event => { setError(undefined); setCreatingSession({ profile, project, returnFocus: event.currentTarget }) }}><IconPlusOutline16 size={13} /></button>
                        <button type="button" className="dsh-ssh-tree-project-edit" aria-label={`Edit ${project.name}`} title="Edit pinned directory" onClick={() => setEditing({ profile, project })}><IconEditOutline16 size={13} /></button>
                      </div>
                    </div>
                  })}
            </div>}
          </div>
        })}
      </section>})}
      {groups.length === 0 && <p className="dsh-ssh-tree-no-results">{props.profiles.length === 0 ? "No SSH hosts yet" : "No matching hosts"}</p>}
    </div>
    <SessionAccessFooter access={props.access} loading={props.accessLoading} saving={props.accessSaving} error={props.accessError ?? error} onPermission={props.onPermission} onApproval={props.onApproval} />
    {editing !== undefined && <RemoteProjectDialog profile={editing.profile} project={editing.project} onClose={() => setEditing(undefined)} onSaved={async () => { const profileId = editing.profile.id; setEditing(undefined); await refreshProjects(profileId) }} />}
    {creatingSession !== undefined && <ProjectSessionDialog {...creatingSession} workspaces={props.workspaces} currentWorkspaceId={props.currentWorkspaceId} recentWorkspaceId={props.recentWorkspaceId} onClose={() => setCreatingSession(undefined)} onCreate={props.onCreateSession} />}
  </aside>
}

function SessionAccessFooter({ access, loading, saving, error, onPermission, onApproval }: { access: InjectionView | null; loading: boolean; saving: boolean; error?: string | undefined; onPermission(value: InjectionView['permission']): void; onApproval(value: boolean): void }): JSX.Element {
  return <footer className="dsh-ssh-access-footer">
    <div className="dsh-ssh-access-heading"><span><strong>Current session permissions</strong><small>{access?.profileIds.length ?? 0} hosts available</small></span><em>{loading ? "Loading" : saving ? "Saving" : "Synced"}</em></div>
    <div className="dsh-ssh-access-segments" aria-label="SSH permissions">
      <button type="button" data-ssh-interactive="choice" className={access?.permission === 'exec' ? 'is-active' : ''} aria-pressed={access?.permission === 'exec'} disabled={access === null} onClick={() => onPermission('exec')}>Commands only</button>
      <button type="button" data-ssh-interactive="choice" className={access?.permission === 'terminal' ? 'is-active' : ''} aria-pressed={access?.permission === 'terminal'} disabled={access === null} onClick={() => onPermission('terminal')}>Terminal control</button>
    </div>
    <label className="dsh-ssh-access-approval"><span><strong>Confirm before execution</strong><small>{access?.requireCommandApproval === false ? "When off, runs directly under current session permissions" : "Requires DSH Ask mode; Full Access is rejected outright"}</small></span><input type="checkbox" checked={access?.requireCommandApproval ?? true} disabled={access === null} onChange={event => onApproval(event.target.checked)} /><i aria-hidden="true" /></label>
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
    if (project === undefined || !window.confirm(`Delete pinned directory '${project.name}'? Related DSH sessions will not be deleted.`)) return
    setSaving(true); setError(undefined)
    try { await deleteRemoteProject(profile.id, project.id); await onSaved() } catch (reason) { setError(message(reason)); setSaving(false) }
  }
  return <Dialog className="dsh-ssh-project-dialog" title={project === undefined ? "Add pinned directory" : "Edit pinned directory"} subtitle={`${profile.name} · default remote path for the terminal and SFTP`} onClose={onClose}>
    <form className="dsh-ssh-form" onSubmit={event => { void submit(event) }}>
        <label className="dsh-ssh-field"><span>Name</span><input required maxLength={80} value={name} placeholder="Website project" onChange={event => setName(event.target.value)} /></label>
        <label className="dsh-ssh-field"><span>Remote path</span><input required maxLength={4096} value={path} spellCheck={false} placeholder="/var/www/example" onChange={event => setPath(event.target.value)} /><small>Before saving, the path is verified as accessible in the SFTP pane on the right.</small></label>
        {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
        <div className="dsh-ssh-dialog-actions">{project !== undefined && <button type="button" className="dsh-ssh-danger-button" disabled={saving} onClick={() => { void remove() }}><IconTrashOutline16 size={15} />Delete</button>}<span className="dsh-ssh-dialog-spacer" /><button type="button" className="dsh-ssh-secondary-button" data-ssh-dialog-close disabled={saving} onClick={onClose}>Cancel</button><button className="dsh-ssh-primary-button" disabled={saving}>{saving ? "Saving…" : "Save directory"}</button></div>
    </form>
  </Dialog>
}

function groupProfiles(profiles: ProfileView[]): Array<{ name: string; profiles: ProfileView[] }> {
  const result = new Map<string, ProfileView[]>()
  for (const profile of profiles) {
    const name = profile.group?.trim() || "Ungrouped"
    const current = result.get(name)
    if (current === undefined) result.set(name, [profile]); else current.push(profile)
  }
  return [...result].map(([name, grouped]) => ({ name, profiles: grouped }))
}

function searchText(profile: ProfileView): string { return `${profile.name} ${profile.group ?? ''} ${profile.host} ${profile.username} ${profile.tags.join(' ')}`.toLocaleLowerCase() }
function message(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason) }
