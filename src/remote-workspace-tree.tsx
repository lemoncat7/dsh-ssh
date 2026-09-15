import { useSshLocale } from './use-ssh-locale.js'
import { t } from './i18n.js'
import { useMemo, useState, type FormEvent } from 'react'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import {
  IconChevronDownOutline14, IconChevronRightOutline14, IconEditOutline16, IconFolderClose16,
  IconFolderOpenOutline16, IconPlusOutline16, IconTrashOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  createRemoteProject, deleteRemoteProject, loadRemoteProjects, updateRemoteProject,
  type InjectionView, type ProfileView, type RemoteProjectView,
} from './client-api.js'
import { ProjectSessionDialog } from './project-session-dialog.js'
import { RemotePathInput } from './remote-path-input.js'
import { useBorderGlowSurface } from './border-glow.js'
import { Dialog } from './ui-components.js'
import { mountedProjects } from './project-mounts.js'

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
  onToggleProject(profileId: string, projectId: string, path: string): void
  onPermission(permission: InjectionView['permission']): void
  onApproval(value: boolean): void
  onCreateSession(project: RemoteProjectView, workspaceId: string): Promise<void>
  onNewProfile(): void
  onProjectsChanged(): Promise<void>
}

export function RemoteWorkspaceTree(props: RemoteWorkspaceTreeProps): JSX.Element {
  useSshLocale()
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
      <span><strong>{t("remote-workspace-tree.hostsProjects")}</strong><small>{props.profiles.length}  {t("remote-workspace-tree.hosts")}</small></span>
      <button type="button" className="dsh-ssh-icon-button" onClick={props.onNewProfile} aria-label={t("remote-workspace-tree.newConnection")} title={t("remote-workspace-tree.newConnection")}><IconPlusOutline16 size={16} /></button>
    </header>
    <label className="dsh-ssh-search"><span className="sr-only">{t("remote-workspace-tree.searchHosts")}</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t("remote-workspace-tree.searchHostsGroupsTags")} /></label>
    <div className="dsh-ssh-tree-scroll dsh-ssh-scroll-surface">
      {groups.map(group => {
        const collapsed = collapsedGroups.has(group.name)
        return <section className="dsh-ssh-tree-group" key={group.name} data-collapsed={collapsed}>
        <h3><button type="button" aria-expanded={!collapsed} onClick={() => toggleGroup(group.name)}>{collapsed ? <IconChevronRightOutline14 size={14} /> : <IconChevronDownOutline14 size={14} />}<span>{group.name || t("remote-workspace-tree.ungrouped")}</span><small>{group.profiles.length}</small></button></h3>
        {!collapsed && group.profiles.map(profile => {
          const open = expanded.has(profile.id)
          const enabled = props.access?.profileIds.includes(profile.id) === true
          const children = projects[profile.id] ?? []
          const active = props.selected?.profileId === profile.id && props.selected.projectId === undefined
          return <div className="dsh-ssh-tree-host" key={profile.id} data-open={open}>
            <div data-ssh-interactive="row" data-ssh-context-row className={`dsh-ssh-tree-host-row${enabled ? ' is-authorized' : ''}${active ? ' is-active' : ''}`}>
              <button type="button" className="dsh-ssh-tree-host-main" aria-pressed={active} aria-expanded={open} title={t("remote-workspace-tree.selectAndExpand", [profile.name])} onClick={() => selectProfile(profile.id)}>
                <span className="dsh-ssh-host-monogram">{profile.name.slice(0, 1).toUpperCase()}</span>
                <span><strong>{profile.name}</strong><small>{profile.username}@{profile.host}</small></span>
              </button>
              <button
                type="button"
                data-ssh-interactive="choice"
                className={`dsh-ssh-tree-mount dsh-ssh-context-action${enabled ? ' is-mounted' : ''}`}
                aria-label={`${enabled ? t("remote-workspace-tree.unmount") : t("remote-workspace-tree.mount")} ${profile.name}`}
                aria-pressed={enabled}
                title={props.access === null ? t("remote-workspace-tree.openADshSessionBeforeMountingHosts") : enabled ? t("remote-workspace-tree.unmountFromCurrentSession") : t("remote-workspace-tree.mountToCurrentSession")}
                disabled={props.access === null || props.accessLoading || props.accessSaving}
                onClick={() => toggleProfile(profile.id)}
              >{enabled ? t("remote-workspace-tree.unmount") : t("remote-workspace-tree.mount")}</button>
              <button type="button" className="dsh-ssh-tree-add" aria-label={t("remote-workspace-tree.addPinnedDirectoryFor", [profile.name])} title={t("remote-workspace-tree.addPinnedDirectory")} onClick={() => setEditing({ profile })}><IconPlusOutline16 size={14} /></button>
            </div>
            {open && <div className="dsh-ssh-tree-branches">
              {loadingProfile === profile.id && projects[profile.id] === undefined ? <p className="dsh-ssh-tree-state">{t("remote-workspace-tree.readingPinnedDirectories")}</p>
                : children.length === 0 ? <button type="button" className="dsh-ssh-tree-empty" onClick={() => setEditing({ profile })}><IconPlusOutline16 size={13} />{t("remote-workspace-tree.addProjectDirectory")}</button>
                  : children.map(project => {
                    const projectActive = props.selected?.projectId === project.id
                    const bound = props.access !== null && mountedProjects(props.access, profile.id).includes(project.id)
                    const isDefault = props.access?.workingProjectIds[profile.id] === project.id
                    return <div className="dsh-ssh-tree-project" key={project.id}>
                      <div data-ssh-interactive="row" className={`dsh-ssh-tree-project-row${projectActive ? ' is-active' : ''}${bound ? ' is-bound' : ''}`}>
                        <button type="button" className="dsh-ssh-tree-project-main" aria-pressed={props.access === null ? undefined : bound} title={props.access === null ? t("remote-workspace-tree.noDshSessionIsAvailableToMountADirectory") : !enabled ? t("remote-workspace-tree.mountThisHostFirst") : bound ? t("remote-workspace-tree.unmountThisDirectoryFromTheCurrentSession") : t("remote-workspace-tree.mountDirectoryMultipleSelectionsAreAllowed")} onClick={() => {
                          if (enabled && !props.accessLoading && !props.accessSaving) {
                            props.onToggleProject(profile.id, project.id, project.path)
                            props.onSelect(bound ? { profileId: profile.id, path: '~' } : { profileId: profile.id, path: project.path, projectId: project.id })
                          }
                        }}><span>{bound ? <IconFolderOpenOutline16 size={15} /> : <IconFolderClose16 size={15} />}</span><span><strong>{project.name}</strong><small>{project.path}</small>{bound && <em>{isDefault ? t("remote-workspace-tree.mountedDefaultWorkingDirectory") : t("client.mounted")}</em>}</span></button>
                        <div className="dsh-ssh-tree-project-actions">{bound && !isDefault && <button type="button" className="dsh-ssh-tree-project-edit" disabled={props.accessSaving} title={t("remote-workspace-tree.setAsDefaultWorkingDirectory")} aria-label={t("remote-workspace-tree.setAsTheDefaultDirectory", [project.name])} onClick={() => props.onDirectory(profile.id, project.path, project.id)}><IconFolderOpenOutline16 size={13} /></button>}
                        <button type="button" className="dsh-ssh-tree-project-new" aria-label={t("remote-workspace-tree.newSessionIn", [project.name])} title={t("remote-workspace-tree.newSession")} onClick={event => { setError(undefined); setCreatingSession({ profile, project, returnFocus: event.currentTarget }) }}><IconPlusOutline16 size={13} /></button>
                        <button type="button" className="dsh-ssh-tree-project-edit" aria-label={t("client.edit2", [project.name])} title={t("remote-workspace-tree.editPinnedDirectory")} onClick={() => setEditing({ profile, project })}><IconEditOutline16 size={13} /></button></div>
                      </div>
                    </div>
                  })}
            </div>}
          </div>
        })}
      </section>})}
      {groups.length === 0 && <p className="dsh-ssh-tree-no-results">{props.profiles.length === 0 ? t("remote-workspace-tree.noSshHostsYet") : t("remote-workspace-tree.noMatchingHosts")}</p>}
    </div>
    <SessionAccessFooter access={props.access} loading={props.accessLoading} saving={props.accessSaving} error={props.accessError ?? error} onPermission={props.onPermission} onApproval={props.onApproval} />
    {editing !== undefined && <RemoteProjectDialog profile={editing.profile} project={editing.project} onClose={() => setEditing(undefined)} onSaved={async () => { const profileId = editing.profile.id; setEditing(undefined); await refreshProjects(profileId); await props.onProjectsChanged() }} />}
    {creatingSession !== undefined && <ProjectSessionDialog {...creatingSession} workspaces={props.workspaces} currentWorkspaceId={props.currentWorkspaceId} recentWorkspaceId={props.recentWorkspaceId} onClose={() => setCreatingSession(undefined)} onCreate={props.onCreateSession} />}
  </aside>
}

function SessionAccessFooter({ access, loading, saving, error, onPermission, onApproval }: { access: InjectionView | null; loading: boolean; saving: boolean; error?: string | undefined; onPermission(value: InjectionView['permission']): void; onApproval(value: boolean): void }): JSX.Element {
  useSshLocale()
  return <footer className="dsh-ssh-access-footer">
    <div className="dsh-ssh-access-heading"><span><strong>{t("remote-workspace-tree.currentSessionPermissions")}</strong><small>{access?.profileIds.length ?? 0}  {t("remote-workspace-tree.availableHosts")}</small></span><em>{loading ? t("remote-workspace-tree.loading") : saving ? t("remote-workspace-tree.saving") : error ? t("remote-workspace-tree.notSynced") : t("remote-workspace-tree.synced")}</em></div>
    <div className="dsh-ssh-access-segments" aria-label={t("remote-workspace-tree.sshPermissions")}>
      <button type="button" data-ssh-interactive="choice" className={access?.permission === 'exec' ? 'is-active' : ''} aria-pressed={access?.permission === 'exec'} disabled={access === null} onClick={() => onPermission('exec')}>{t("remote-workspace-tree.commandsOnly")}</button>
      <button type="button" data-ssh-interactive="choice" className={access?.permission === 'terminal' ? 'is-active' : ''} aria-pressed={access?.permission === 'terminal'} disabled={access === null} onClick={() => onPermission('terminal')}>{t("remote-workspace-tree.terminalControl")}</button>
    </div>
    <label className="dsh-ssh-access-approval"><span><strong>{t("remote-workspace-tree.confirmBeforeRunning")}</strong><small>{access?.requireCommandApproval === false ? t("remote-workspace-tree.whenOffRunsDirectlyUnderCurrentSessionPermissions") : t("remote-workspace-tree.requiresDshAskModeFullAccessIsRejectedOutright")}</small></span><input type="checkbox" checked={access?.requireCommandApproval ?? true} disabled={access === null} onChange={event => onApproval(event.target.checked)} /><i aria-hidden="true" /></label>
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
  </footer>
}

function RemoteProjectDialog({ profile, project, onClose, onSaved }: { profile: ProfileView; project?: RemoteProjectView | undefined; onClose(): void; onSaved(): Promise<void> }): JSX.Element {
  useSshLocale()
  const [name, setName] = useState(project?.name ?? '')
  const [path, setPath] = useState(project?.path ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSaving(true); setError(undefined)
    try {
      if (project === undefined) await createRemoteProject(profile.id, { name, path })
      else await updateRemoteProject(profile.id, project.id, { name, path })
      await onSaved()
    } catch (reason) { setError(message(reason)); setSaving(false) }
  }
  const remove = async (): Promise<void> => {
    if (project === undefined || !window.confirm(t("remote-workspace-tree.deletePinnedDirectoryRelatedDshSessionsWillNotBe", [project.name]))) return
    setSaving(true); setError(undefined)
    try { await deleteRemoteProject(profile.id, project.id); await onSaved() } catch (reason) { setError(message(reason)); setSaving(false) }
  }
  return <Dialog className="dsh-ssh-project-dialog" title={project === undefined ? t("remote-workspace-tree.addPinnedDirectory") : t("remote-workspace-tree.editPinnedDirectory")} subtitle={t("remote-workspace-tree.defaultRemotePathForTheTerminalAndSftp", [profile.name])} onClose={onClose}>
    <form className="dsh-ssh-form" onSubmit={event => { void submit(event) }}>
        <label className="dsh-ssh-field"><span>{t("client.name")}</span><input required maxLength={80} value={name} placeholder={t("remote-workspace-tree.websiteProject")} onChange={event => setName(event.target.value)} /></label>
        <RemotePathInput profileId={profile.id} value={path} disabled={saving} onChange={setPath} />
        {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
        <div className="dsh-ssh-dialog-actions">{project !== undefined && <button type="button" className="dsh-ssh-danger-button" disabled={saving} onClick={() => { void remove() }}><IconTrashOutline16 size={15} />{t("client.delete")}</button>}<span className="dsh-ssh-dialog-spacer" /><button type="button" className="dsh-ssh-secondary-button" data-ssh-dialog-close disabled={saving} onClick={onClose}>{t("client.cancel")}</button><button className="dsh-ssh-primary-button" disabled={saving}>{saving ? t("client.saving2") : t("remote-workspace-tree.saveDirectory")}</button></div>
    </form>
  </Dialog>
}

function groupProfiles(profiles: ProfileView[]): Array<{ name: string; profiles: ProfileView[] }> {
  const result = new Map<string, ProfileView[]>()
  for (const profile of profiles) {
    const name = profile.group?.trim() || ''
    const current = result.get(name)
    if (current === undefined) result.set(name, [profile]); else current.push(profile)
  }
  return [...result].map(([name, grouped]) => ({ name, profiles: grouped }))
}

function searchText(profile: ProfileView): string { return `${profile.name} ${profile.group ?? ''} ${profile.host} ${profile.username} ${profile.tags.join(' ')}`.toLocaleLowerCase() }
function message(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason) }
