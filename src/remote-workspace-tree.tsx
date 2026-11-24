import { useSshLocale } from './use-ssh-locale.js'
import { t } from './i18n.js'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import {
  IconChevronDownOutlineRegular as IconChevronDownOutline14, IconChevronRightOutlineRegular as IconChevronRightOutline14, IconEditOutlineRegular as IconEditOutline16, IconFolderCloseRegular as IconFolderClose16,
  IconEllipsisOutlineRegular as IconEllipsisOutline16, IconFolderOpenOutlineRegular as IconFolderOpenOutline16, IconPlusOutlineRegular as IconPlusOutline16, IconTrashOutlineRegular as IconTrashOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  createRemoteProject, deleteRemoteProject, loadRemoteProjects, loadWorkspaceMounts, saveWorkspaceMounts, updateRemoteProject,
  type InjectionView, type ProfileView, type RemoteProjectView,
} from './client-api.js'
import { ProjectSessionDialog } from './project-session-dialog.js'
import { RemotePathInput } from './remote-path-input.js'
import { useBorderGlowSurface } from './border-glow.js'
import { Dialog } from './ui-components.js'
import { useConfirmationDialog } from './confirmation-dialog.js'
import { mountedProjects, withMountedProfiles } from './project-mounts.js'
import type { GroupProxy, MountMode, WorkspaceMountConfiguration } from './domain.js'
import { HostActionMenu, TerminalActionIcon } from './host-action-menu.js'
import { SessionDefaults } from './session-defaults-ui.js'

const HOST_DRAG_TYPE = 'application/x-dsh-ssh-profile'

export interface RemoteTarget {
  profileId: string
  path: string
  projectId?: string
  label?: string
}

interface RemoteWorkspaceTreeProps {
  catalogue?: boolean
  active?: boolean
  onOpen?(target: RemoteTarget): void
  onDeleteProfile?(profile: ProfileView): void
  profiles: ProfileView[]
  groupConfigs: GroupProxy[]
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
  onMountMode(workspaceId: string | null, mode: MountMode): Promise<InjectionView>
  onDirectory(profileId: string, path?: string, projectId?: string): void
  onToggleProject(profileId: string, projectId: string, path: string): void
  onPermission(permission: InjectionView['permission']): void
  onApproval(value: boolean): void
  onCreateSession(project: RemoteProjectView, workspaceId: string): Promise<void>
  onNewProfile(): void
  onNewGroup(): void
  onEditProfile(profile: ProfileView): void
  onMoveProfile(profile: ProfileView, group?: string): Promise<void>
  onProjectsChanged(): Promise<void>
  onGroupProxy?(name: string): void
}

export function RemoteWorkspaceTree(props: RemoteWorkspaceTreeProps): JSX.Element {
  useSshLocale()
  const panelGlow = useBorderGlowSurface<HTMLElement>()
  const [query, setQuery] = useState('')
  const [display, setDisplay] = useState<'cards' | 'list'>(() => { try { return localStorage.getItem('dsh-ssh:catalogue-view') === 'list' ? 'list' : 'cards' } catch { return 'cards' } })
  const chooseDisplay = (value: 'cards' | 'list'): void => { setDisplay(value); try { localStorage.setItem('dsh-ssh:catalogue-view', value) } catch {} }
  const [accessOpen, setAccessOpen] = useState(false)
  const groupChoices = useRef(new Set<string>())
  const hostClick = useRef<{ id: string; expanded: boolean }>()
  const menuAnchor = useRef<HTMLButtonElement | null>(null)
  const [collapsedHosts, setCollapsedHosts] = useState<Set<string>>(() => new Set())
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set())
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [projects, setProjects] = useState<Record<string, RemoteProjectView[]>>({})
  const [loadingProfile, setLoadingProfile] = useState<string>()
  const [editing, setEditing] = useState<{ profile: ProfileView; project?: RemoteProjectView }>()
  const [creatingSession, setCreatingSession] = useState<{ profile: ProfileView; project: RemoteProjectView; returnFocus: HTMLButtonElement }>()
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const [hostMenu, setHostMenu] = useState<string>()
  const [projectMenu, setProjectMenu] = useState<string>()
  const [draggedProfileId, setDraggedProfileId] = useState<string>()
  const [dropGroup, setDropGroup] = useState<string | null>(null)
  const [movingProfileId, setMovingProfileId] = useState<string>()
  const [error, setError] = useState<string>()
  const normalized = query.trim().toLocaleLowerCase()
  const groups = useMemo(() => groupProfiles(props.profiles, props.groupConfigs, normalized, projects), [normalized, props.groupConfigs, props.profiles, projects])
  const workspace = props.workspaces.find(item => item.workspaceId === props.currentWorkspaceId)
  const sessionId = props.access?.sessionId
  const workspaceId = workspace?.workspaceId
  const scopeKey = JSON.stringify([sessionId, workspaceId])
  const scopeRef = useRef(scopeKey)
  scopeRef.current = scopeKey
  const [draft, setDraft] = useState<{ key: string; mounts: WorkspaceMountConfiguration }>()
  const [mountRequest, setMountRequest] = useState<'edit' | 'confirm' | MountMode>()
  const [mountError, setMountError] = useState<{ key: string; message: string }>()
  const projectMounts = draft?.key === scopeKey ? draft.mounts : undefined
  const mountBusy = mountRequest !== undefined
  useEffect(() => { setDraft(current => current?.key === scopeKey ? current : undefined) }, [scopeKey])
  const inherited = props.access?.mountMode === 'inherit'
  const pendingMode = mountRequest === 'inherit' || mountRequest === 'independent' ? mountRequest : undefined
  const selectedMode = pendingMode ?? (inherited ? 'inherit' : 'independent')
  const mounts = projectMounts ?? props.access
  const mountedHostCount = mounts?.profileIds.length
  const cannotChangeMounts = mountBusy || props.accessLoading || props.accessSaving || (!projectMounts && (!props.access || inherited))
  const mountedGroups = JSON.stringify([...new Set(props.profiles.filter(profile => mounts?.profileIds.includes(profile.id)).map(profile => profile.group?.trim() || ''))].sort())
  useEffect(() => {
    const names: string[] = JSON.parse(mountedGroups)
    if (names.length) setExpandedGroups(current => new Set([...current, ...names.filter(name => !groupChoices.current.has(name))]))
  }, [mountedGroups, props.catalogue])

  useEffect(() => {
    const closeMenus = (event: PointerEvent): void => {
      if (event.target instanceof Element && event.target.closest('.dsh-ssh-tree-menu-wrap')) return
      setCreateMenuOpen(false); setHostMenu(undefined); setProjectMenu(undefined)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      const trigger = document.querySelector('.dsh-ssh-tree-menu')?.previousElementSibling
      setCreateMenuOpen(false); setHostMenu(undefined); setProjectMenu(undefined)
      if (trigger instanceof HTMLButtonElement) window.requestAnimationFrame(() => trigger.focus())
    }
    document.addEventListener('pointerdown', closeMenus)
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('pointerdown', closeMenus); document.removeEventListener('keydown', closeOnEscape) }
  }, [])

  const refreshProjects = async (profileId: string): Promise<void> => {
    setLoadingProfile(profileId)
    try {
      const next = await loadRemoteProjects(profileId)
      setProjects(current => ({ ...current, [profileId]: next }))
      setError(undefined)
    } catch (reason) { setError(message(reason)) } finally { setLoadingProfile(current => current === profileId ? undefined : current) }
  }
  useEffect(() => {
    if (!props.catalogue || props.active === false) return
    let live = true
    void Promise.allSettled(props.profiles.map(async profile => ({ id: profile.id, projects: await loadRemoteProjects(profile.id) }))).then(results => {
      if (!live) return
      setProjects(current => { const next = { ...current }; for (const result of results) if (result.status === 'fulfilled') next[result.value.id] = result.value.projects; return next })
      const failed = results.find(result => result.status === 'rejected'); if (failed?.status === 'rejected') setError(message(failed.reason))
    })
    return () => { live = false }
  }, [props.catalogue, props.active, props.profiles])
  const selectProfile = (profileId: string, open: boolean): void => {
    setHostMenu(undefined); setProjectMenu(undefined)
    hostClick.current = { id: profileId, expanded: open }
    setExpanded(current => { const next = new Set(current); if (open) next.delete(profileId); else next.add(profileId); return next })
    setCollapsedHosts(current => { const next = new Set(current); if (open) next.add(profileId); else next.delete(profileId); return next })
    if (projects[profileId] === undefined) void refreshProjects(profileId)
    props.onSelect({ profileId, path: '~' })
  }
  const changeMountScope = async (action: 'edit' | 'confirm' | MountMode): Promise<void> => {
    if (sessionId === undefined || mountBusy) return
    setMountRequest(action)
    setMountError(undefined)
    try {
      if (action === 'edit') {
        const project = await loadWorkspaceMounts(sessionId)
        if (project.workspaceId !== workspaceId) throw new Error(t('desk.mountScopeChanged'))
        if (scopeRef.current === scopeKey) setDraft({ key: scopeKey, mounts: project })
      } else if (action === 'confirm') {
        if (!projectMounts) return
        await saveWorkspaceMounts(sessionId, projectMounts)
        setDraft(undefined)
        await props.onProjectsChanged()
      } else {
        await props.onMountMode(workspaceId ?? null, action)
      }
    } catch (reason) { setMountError({ key: scopeKey, message: message(reason) }) }
    finally { setMountRequest(undefined) }
  }
  const changeProfiles = (profileIds: string[]): void => {
    if (cannotChangeMounts) return
    if (projectMounts) setDraft({ key: scopeKey, mounts: withMountedProfiles(projectMounts, profileIds) })
    else props.onProfiles(profileIds)
  }
  const toggleProfile = (profileId: string): void => {
    const current = mounts?.profileIds ?? []
    const enabled = current.includes(profileId)
    const profileIds = enabled ? current.filter(id => id !== profileId) : [...current, profileId]
    changeProfiles(profileIds)
  }
  const changeGroup = (profileIds: string[], enabled: boolean): void => {
    const current = mounts?.profileIds ?? []
    const members = new Set(profileIds)
    changeProfiles(enabled ? [...new Set([...current, ...profileIds])] : current.filter(id => !members.has(id)))
  }
  const toggleDirectory = (profileId: string, project: RemoteProjectView): void => {
    if (!projectMounts) { props.onToggleProject(profileId, project.id, project.path); return }
    const current = projectMounts.mountedProjectIds[profileId] ?? []
    const ids = current.includes(project.id) ? current.filter(id => id !== project.id) : [...current, project.id]
    const workingProjectIds = { ...projectMounts.workingProjectIds }
    if (!ids.includes(workingProjectIds[profileId] ?? '')) {
      if (ids[0] !== undefined) workingProjectIds[profileId] = ids[0]
      else delete workingProjectIds[profileId]
    }
    setDraft({ key: scopeKey, mounts: {
      ...projectMounts, workingProjectIds, mountedProjectIds: { ...projectMounts.mountedProjectIds, [profileId]: ids },
    } })
  }
  const setDefaultDirectory = (profileId: string, project: RemoteProjectView): void => {
    if (projectMounts) {
      setDraft({ key: scopeKey, mounts: { ...projectMounts, workingProjectIds: { ...projectMounts.workingProjectIds, [profileId]: project.id } } })
    } else props.onDirectory(profileId, project.path, project.id)
  }
  const toggleGroup = (name: string): void => setExpandedGroups(current => {
    groupChoices.current.add(name)
    const next = new Set(current)
    if (next.has(name)) next.delete(name); else next.add(name)
    return next
  })
  const moveProfile = async (profile: ProfileView, group: string): Promise<void> => {
    if ((profile.group?.trim() || '') === group || movingProfileId !== undefined) return
    setMovingProfileId(profile.id); setError(undefined)
    try { await props.onMoveProfile(profile, group || undefined) }
    catch (reason) { setError(message(reason)) }
    finally { setMovingProfileId(undefined); setDraggedProfileId(undefined); setDropGroup(null) }
  }

  return <aside ref={panelGlow.ref} onPointerMove={panelGlow.onPointerMove} onPointerLeave={panelGlow.onPointerLeave} className={`dsh-ssh-remote-tree dsh-ssh-border-surface${props.catalogue ? ` dsh-ssh-host-catalogue is-${display}` : ''}`}>
    {props.catalogue ? <>

      <div className="dsh-ssh-catalogue-tools">
        <label className="dsh-ssh-search"><span className="sr-only">{t('remote-workspace-tree.searchHosts')}</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('desk.searchCatalogue')} /></label>
        <p className="dsh-ssh-catalogue-purpose">{t('desk.mountPurpose')}</p>
        <div className="dsh-ssh-catalogue-actions">
          <button type="button" className="dsh-ssh-secondary-button" aria-haspopup="dialog" disabled={!!projectMounts || mountBusy} onClick={() => setAccessOpen(true)}>{t('remote-workspace-tree.currentSessionPermissions')}{props.accessSaving ? ` · ${t('remote-workspace-tree.saving')}` : props.accessError ? ' !' : ''}</button>
          <button type="button" aria-pressed={display === 'list'} onClick={() => chooseDisplay('list')}>{t('desk.list')}</button>
          <button type="button" aria-pressed={display === 'cards'} onClick={() => chooseDisplay('cards')}>{t('desk.cards')}</button>
          <button type="button" className="dsh-ssh-secondary-button" onClick={props.onNewGroup}>{t('remote-workspace-tree.addGroup')}</button>
          <button type="button" className="dsh-ssh-primary-button" onClick={props.onNewProfile}>{t('remote-workspace-tree.addHost')}</button>
        </div>
        <div className="dsh-ssh-catalogue-mount-scope">
          <fieldset disabled={!sessionId || props.accessLoading || props.accessSaving || mountBusy || !!projectMounts} aria-label={t('desk.mountScopeCurrentSession')}>
            <span>{t('desk.mountScopeCurrentSession')}</span>
            <div className="dsh-ssh-mount-scope-options">
              <label className="dsh-ssh-mount-scope-choice">
                <input type="radio" name="dsh-ssh-mount-scope" disabled={!workspace} checked={selectedMode === 'inherit'} onChange={() => void changeMountScope('inherit')} />
                {t('desk.mountScopeInheritProject')}
              </label>
              <label className="dsh-ssh-mount-scope-choice">
                <input type="radio" name="dsh-ssh-mount-scope" checked={!!props.access && selectedMode === 'independent'} onChange={() => void changeMountScope('independent')} />
                {t('desk.mountScopeIndependent')}
              </label>
            </div>
          </fieldset>
          {!!props.access && !props.accessLoading && <div className="dsh-ssh-mount-scope-status" data-editing={!!projectMounts}>
            <p role="status">
              {projectMounts && workspace ? <>
                <strong>{t('desk.mountScopeEditing', [workspace.title || workspace.path])}</strong>
                <span>{t('desk.mountScopeEditingHint')} · {t('desk.mountScopeDraftCount', [mountedHostCount ?? 0])}</span>
              </> : pendingMode ? t('desk.mountScopeSaving') : <>
                {workspace && inherited && <>{t('desk.mountScopeInheritedFrom', [workspace.title || workspace.path])} · </>}
                {t('desk.mountScopeHostCount', [mountedHostCount ?? 0])}
              </>}
            </p>
            {workspace && sessionId && <div className="dsh-ssh-mount-scope-actions" aria-busy={mountBusy}>
              <button type="button" className={projectMounts ? 'dsh-ssh-primary-button' : 'dsh-ssh-secondary-button'} disabled={mountBusy || props.accessSaving} onClick={() => void changeMountScope(projectMounts ? 'confirm' : 'edit')}>
                {projectMounts ? t('desk.mountScopeConfirm') : t('desk.mountScopeEdit')}
              </button>
              {projectMounts && <button type="button" className="dsh-ssh-secondary-button" disabled={mountBusy} onClick={() => { setDraft(undefined); setMountError(undefined) }}>{t('client.cancel')}</button>}
            </div>}
          </div>}
          {mountError?.key === scopeKey && <p className="dsh-ssh-inline-error" role="alert">{mountError.message}</p>}
        </div>
      </div>
      {(error || props.accessError) && <p className="dsh-ssh-inline-error" role="alert">{error || props.accessError}</p>}
    </> : <>
    <header className="dsh-ssh-tree-header">
      <span><strong>{t("remote-workspace-tree.hostsProjects")}</strong><small>{props.profiles.length}  {t("remote-workspace-tree.hosts")}</small></span>
      <div className="dsh-ssh-tree-menu-wrap">
        <button type="button" className="dsh-ssh-icon-button" aria-haspopup="menu" aria-expanded={createMenuOpen} onClick={() => { setCreateMenuOpen(value => !value); setHostMenu(undefined) }} aria-label={t("remote-workspace-tree.addHostOrGroup")} title={t("remote-workspace-tree.addHostOrGroup")}><IconPlusOutline16 size={16} /></button>
        {createMenuOpen && <div className="dsh-ssh-tree-menu is-header" role="menu" aria-label={t("remote-workspace-tree.addHostOrGroup")} onKeyDown={navigateMenu}>
          <button type="button" role="menuitem" autoFocus onClick={() => { setCreateMenuOpen(false); props.onNewProfile() }}><IconPlusOutline16 size={14} />{t("remote-workspace-tree.addHost")}</button>
          <button type="button" role="menuitem" onClick={() => { setCreateMenuOpen(false); props.onNewGroup() }}><IconFolderClose16 size={14} />{t("remote-workspace-tree.addGroup")}</button>
        </div>}
      </div>
    </header>
    <label className="dsh-ssh-search"><span className="sr-only">{t("remote-workspace-tree.searchHosts")}</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t("remote-workspace-tree.searchHostsGroupsTags")} /></label>
    </>}
    <div className="dsh-ssh-tree-scroll dsh-ssh-scroll-surface">
      {normalized && groups.length > 0 && <p className="dsh-ssh-group-search-hint">{t('group-mount.searchHint')}</p>}
      {groups.map(group => {
        const collapsed = !expandedGroups.has(group.name) && !normalized
        const groupName = group.name || t('remote-workspace-tree.ungrouped')
        const mountedCount = group.allProfileIds.filter(id => mounts?.profileIds.includes(id)).length
        const total = group.allProfileIds.length
        const mountHint = !props.access ? t('remote-workspace-tree.openADshSessionBeforeMountingHosts') : projectMounts ? t('desk.mountScopeProjectTarget') : inherited ? t('desk.mountScopeInheritedHint') : t('group-mount.sessionTarget')
        const draggedProfile = props.profiles.find(profile => profile.id === draggedProfileId)
        const acceptsDrop = draggedProfile !== undefined && (draggedProfile.group?.trim() || '') !== group.name
        return <section className={`dsh-ssh-tree-group${dropGroup === group.name && acceptsDrop ? ' is-drop-target' : ''}`} key={group.name} data-collapsed={collapsed}
          onDragOver={event => { if (!acceptsDrop || !event.dataTransfer.types.includes(HOST_DRAG_TYPE)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropGroup(group.name) }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropGroup(current => current === group.name ? null : current) }}
          onDrop={event => { if (!acceptsDrop || draggedProfile === undefined) return; event.preventDefault(); void moveProfile(draggedProfile, group.name) }}>
        <h3><button type="button" aria-expanded={!collapsed} title={groupName} onClick={() => toggleGroup(group.name)}>{collapsed ? <IconChevronRightOutline14 size={14} /> : <IconChevronDownOutline14 size={14} />}<span>{groupName}</span></button>
          <span className="dsh-ssh-group-actions" role="group" aria-label={t('group-mount.actions', [groupName])}>
            {group.name && props.onGroupProxy && <button type="button" className="dsh-ssh-group-proxy-button" aria-label={t('group-proxy.editTitle', [group.name])} title={t('group-proxy.editTitle', [group.name])} onClick={() => props.onGroupProxy?.(group.name)}><IconEditOutline16 size={14} /></button>}
            <button type="button" className="dsh-ssh-group-mount-button" disabled={cannotChangeMounts || mountedCount === total} aria-label={t('group-mount.mountLabel', [groupName, total])} title={`${t('group-mount.mountLabel', [groupName, total])} · ${mountHint}`} onClick={() => changeGroup(group.allProfileIds, true)}>{t('group-mount.mount')}</button>
            <button type="button" className="dsh-ssh-group-mount-button" disabled={cannotChangeMounts || mountedCount === 0} aria-label={t('group-mount.unmountLabel', [groupName, total])} title={`${t('group-mount.unmountLabel', [groupName, total])} · ${mountHint}`} onClick={() => changeGroup(group.allProfileIds, false)}>{t('group-mount.unmount')}</button>
          </span>
          <small className="dsh-ssh-group-mount-count">{t('group-mount.count', [mountedCount, total])}</small>
        </h3>
        {!collapsed && <div className="dsh-ssh-catalogue-group-items">{group.profiles.map(profile => {
          const open = !collapsedHosts.has(profile.id) && (expanded.has(profile.id) || (!!query.trim() && (projects[profile.id] ?? []).some(project => `${project.name} ${project.path}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))))
          const enabled = mounts?.profileIds.includes(profile.id) === true
          const children = projects[profile.id] ?? []
          const active = props.selected?.profileId === profile.id && props.selected.projectId === undefined
          return <div className="dsh-ssh-tree-host" key={profile.id} data-open={open}>
            <div data-ssh-interactive="row" data-ssh-context-row draggable={movingProfileId !== profile.id} className={`dsh-ssh-tree-host-row${enabled ? ' is-authorized' : ''}${active ? ' is-active' : ''}${hostMenu === profile.id ? ' is-menu-open' : ''}${movingProfileId === profile.id ? ' is-moving' : ''}`}
              onDragStart={event => { setDraggedProfileId(profile.id); setHostMenu(undefined); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData(HOST_DRAG_TYPE, profile.id) }}
              onDragEnd={() => { setDraggedProfileId(undefined); setDropGroup(null) }}>
              <button type="button" className="dsh-ssh-tree-host-main" aria-pressed={active} aria-expanded={open} aria-label={`${profile.name} ${profile.username}@${profile.host}`} title={`${profile.name} · ${profile.username}@${profile.host}\n${t('desk.hostClickHint')}`} onClick={event => { if (event.detail <= 1) selectProfile(profile.id, open) }} onDoubleClick={() => {
                // The first click toggles immediately; a double-click restores that
                // disclosure state and opens exactly one terminal.
                const before = hostClick.current
                if (before?.id === profile.id) {
                  setExpanded(current => { const next = new Set(current); if (before.expanded) next.add(profile.id); else next.delete(profile.id); return next })
                  setCollapsedHosts(current => { const next = new Set(current); if (before.expanded) next.delete(profile.id); else next.add(profile.id); return next })
                }
                props.onOpen?.({ profileId: profile.id, path: '~' })
              }} onKeyDown={event => { if (event.key === 'Enter' && props.onOpen) { event.preventDefault(); props.onOpen({ profileId: profile.id, path: '~' }) } }}>
                <span className="dsh-ssh-host-monogram" aria-hidden="true">{profile.name.slice(0, 1).toUpperCase()}</span>
                <span className="dsh-ssh-host-copy"><strong>{profile.name}</strong><small className="dsh-ssh-host-address">{profile.username}@{profile.host}</small>{props.catalogue && <small className="dsh-ssh-host-hover-hint">{t('desk.hostClickHint')}</small>}</span>
              </button>
              <button
                type="button"
                data-ssh-interactive="choice"
                className={`dsh-ssh-tree-mount dsh-ssh-context-action${enabled ? ' is-mounted' : ''}`}
                aria-label={`${enabled ? t("remote-workspace-tree.unmount") : t("remote-workspace-tree.mount")} ${profile.name}`}
                aria-pressed={enabled}
                title={projectMounts ? t('desk.mountScopeProjectTarget') : inherited ? t('desk.mountScopeInheritedHint') : !props.access ? t('remote-workspace-tree.openADshSessionBeforeMountingHosts') : enabled ? t('remote-workspace-tree.unmountFromCurrentSession') : t('remote-workspace-tree.mountToCurrentSession')}
                disabled={cannotChangeMounts}
                onClick={() => toggleProfile(profile.id)}
              >{enabled ? t("remote-workspace-tree.unmount") : t("remote-workspace-tree.mount")}</button>
              <div className="dsh-ssh-tree-menu-wrap is-host dsh-ssh-context-action">
                <button type="button" draggable={false} className="dsh-ssh-tree-more" aria-haspopup="menu" aria-expanded={hostMenu === profile.id} aria-label={t("remote-workspace-tree.hostMenuFor", [profile.name])} title={t("remote-workspace-tree.moreHostActions")} onClick={event => { menuAnchor.current = event.currentTarget; setProjectMenu(undefined); setHostMenu(current => current === profile.id ? undefined : profile.id); setCreateMenuOpen(false) }}><IconEllipsisOutline16 size={15} /></button>
                {hostMenu === profile.id && <HostActionMenu anchor={menuAnchor.current} label={t("remote-workspace-tree.hostMenuFor", [profile.name])} onKeyDown={navigateMenu}>
                  {props.onOpen && <button type="button" role="menuitem" onClick={() => { setHostMenu(undefined); props.onOpen?.({ profileId: profile.id, path: '~' }) }}><TerminalActionIcon />{t('desk.openTerminal')}</button>}
                  <button type="button" role="menuitem" autoFocus onClick={() => { setHostMenu(undefined); props.onEditProfile(profile) }}><IconEditOutline16 size={14} />{t("client.editHost")}</button>
                  {props.onDeleteProfile && <button type="button" role="menuitem" onClick={() => { setHostMenu(undefined); props.onDeleteProfile?.(profile) }}><IconTrashOutline16 size={14} />{t('client.deleteHost2')}</button>}
                  <button type="button" role="menuitem" onClick={() => { setHostMenu(undefined); setEditing({ profile }) }}><IconPlusOutline16 size={14} />{t("remote-workspace-tree.addPinnedDirectory")}</button>
                </HostActionMenu>}
              </div>
            </div>
            {open && <div className="dsh-ssh-tree-branches">
              {loadingProfile === profile.id && projects[profile.id] === undefined ? <p className="dsh-ssh-tree-state">{t("remote-workspace-tree.readingPinnedDirectories")}</p>
                : children.length === 0 ? <button type="button" className="dsh-ssh-tree-empty" onClick={() => setEditing({ profile })}><IconPlusOutline16 size={13} />{t("remote-workspace-tree.addPinnedDirectory")}</button>
                  : children.map(project => {
                    const projectActive = props.selected?.projectId === project.id
                    const bound = mounts !== null && mountedProjects(mounts, profile.id).includes(project.id)
                    const isDefault = mounts?.workingProjectIds[profile.id] === project.id
                    return <div className="dsh-ssh-tree-project" key={project.id}>
                      <div data-ssh-interactive="row" data-ssh-context-row className={`dsh-ssh-tree-project-row${projectActive ? ' is-active' : ''}${bound ? ' is-bound' : ''}${projectMenu === project.id ? ' is-menu-open' : ''}`}>
                        <button type="button" className="dsh-ssh-tree-project-main" aria-pressed={projectActive} title={`${project.name} · ${project.path}\n${t('desk.openProjectHint')}${bound ? ` · ${isDefault ? t('remote-workspace-tree.mountedDefaultWorkingDirectory') : t('client.mounted')}` : ''}`} onClick={() => props.onSelect({ profileId: profile.id, path: project.path, projectId: project.id, label: project.name })} onDoubleClick={() => props.onOpen?.({ profileId: profile.id, path: project.path, projectId: project.id, label: project.name })} onKeyDown={event => { if (event.key === 'Enter' && props.onOpen) { event.preventDefault(); props.onOpen({ profileId: profile.id, path: project.path, projectId: project.id, label: project.name }) } }}><span>{bound ? <IconFolderOpenOutline16 size={15} /> : <IconFolderClose16 size={15} />}</span><span><strong>{project.name}</strong><small>{project.path}</small></span></button>
                        <div className="dsh-ssh-tree-project-actions dsh-ssh-context-action">
                          <button type="button" className="dsh-ssh-tree-mount" aria-pressed={bound} aria-label={`${bound ? t('remote-workspace-tree.unmount') : t('remote-workspace-tree.mount')} ${project.name}`} disabled={!enabled || cannotChangeMounts} title={!enabled ? t('remote-workspace-tree.mountThisHostFirst') : projectMounts ? t('desk.mountScopeProjectTarget') : inherited ? t('desk.mountScopeInheritedHint') : t('desk.manualHint')} onClick={() => toggleDirectory(profile.id, project)}>{bound ? t('remote-workspace-tree.unmount') : t('remote-workspace-tree.mount')}</button>
                          <div className="dsh-ssh-tree-menu-wrap is-project">
                            <button type="button" className="dsh-ssh-tree-more" aria-haspopup="menu" aria-expanded={projectMenu === project.id} aria-label={t('desk.projectActions', [project.name])} onClick={event => { menuAnchor.current = event.currentTarget; setHostMenu(undefined); setProjectMenu(current => current === project.id ? undefined : project.id) }}><IconEllipsisOutline16 size={15} /></button>
                            {projectMenu === project.id && <HostActionMenu anchor={menuAnchor.current} label={t('desk.projectActions', [project.name])} onKeyDown={navigateMenu}>
                              <button type="button" role="menuitem" onClick={() => { setProjectMenu(undefined); props.onOpen?.({ profileId: profile.id, path: project.path, projectId: project.id, label: project.name }) }}><TerminalActionIcon />{t('desk.openTerminal')}</button>
                              {bound && !isDefault && <button type="button" role="menuitem" disabled={cannotChangeMounts} onClick={() => { setProjectMenu(undefined); setDefaultDirectory(profile.id, project) }}><IconFolderOpenOutline16 size={14} />{t('remote-workspace-tree.setAsDefaultWorkingDirectory')}</button>}
                              <button type="button" role="menuitem" onClick={event => { setError(undefined); setCreatingSession({ profile, project, returnFocus: menuAnchor.current ?? event.currentTarget }); setProjectMenu(undefined) }}><IconPlusOutline16 size={14} />{t('remote-workspace-tree.newSession')}</button>
                              <button type="button" role="menuitem" onClick={() => { setProjectMenu(undefined); setEditing({ profile, project }) }}><IconEditOutline16 size={14} />{t('remote-workspace-tree.editPinnedDirectory')}</button>
                            </HostActionMenu>}
                          </div>
                        </div>
                      </div>
                    </div>
                  })}
            </div>}
          </div>
        })}</div>}
      </section>})}
      {groups.length === 0 && <p className="dsh-ssh-tree-no-results">{props.profiles.length === 0 ? t("remote-workspace-tree.noSshHostsYet") : t("remote-workspace-tree.noMatchingHosts")}</p>}
    </div>
    {props.catalogue ? <p className="dsh-ssh-catalogue-hint">{t('desk.catalogueHint')}</p> : <SessionAccessFooter access={props.access} loading={props.accessLoading} saving={props.accessSaving} error={props.accessError ?? error} onPermission={props.onPermission} onApproval={props.onApproval} />}
    {accessOpen && <Dialog title={t('remote-workspace-tree.currentSessionPermissions')} onClose={() => setAccessOpen(false)}><SessionAccessFooter access={props.access} loading={props.accessLoading} saving={props.accessSaving} error={props.accessError} onPermission={props.onPermission} onApproval={props.onApproval} /></Dialog>}
    {editing !== undefined && <RemoteProjectDialog profile={editing.profile} project={editing.project} onClose={() => setEditing(undefined)} onSaved={async () => { const profileId = editing.profile.id; setEditing(undefined); await refreshProjects(profileId); await props.onProjectsChanged() }} />}
    {creatingSession !== undefined && <ProjectSessionDialog {...creatingSession} workspaces={props.workspaces} currentWorkspaceId={props.currentWorkspaceId} recentWorkspaceId={props.recentWorkspaceId} onClose={() => setCreatingSession(undefined)} onCreate={props.onCreateSession} />}
  </aside>
}

function SessionAccessFooter({ access, loading, saving, error, onPermission, onApproval }: { access: InjectionView | null; loading: boolean; saving: boolean; error?: string | undefined; onPermission(value: InjectionView['permission']): void; onApproval(value: boolean): void }): JSX.Element {
  useSshLocale()
  return <footer className="dsh-ssh-access-footer">
    <div className="dsh-ssh-access-heading"><span><strong>{t("remote-workspace-tree.currentSessionPermissions")}</strong><small>{access?.profileIds.length ?? 0}  {t("remote-workspace-tree.availableHosts")}</small></span><em>{loading ? t("remote-workspace-tree.loading") : saving ? t("remote-workspace-tree.saving") : error ? t("remote-workspace-tree.notSynced") : t("remote-workspace-tree.synced")}</em></div>
    <div className="dsh-ssh-access-segments" aria-label={t("remote-workspace-tree.sshPermissions")}>
      <button type="button" data-ssh-interactive="choice" className={access?.permission === 'exec' ? 'is-active' : ''} aria-pressed={access?.permission === 'exec'} disabled={access === null || loading || saving} onClick={() => onPermission('exec')}>{t("remote-workspace-tree.commandsOnly")}</button>
      <button type="button" data-ssh-interactive="choice" className={access?.permission === 'terminal' ? 'is-active' : ''} aria-pressed={access?.permission === 'terminal'} disabled={access === null || loading || saving} onClick={() => onPermission('terminal')}>{t("remote-workspace-tree.terminalControl")}</button>
    </div>
    <label className="dsh-ssh-access-approval"><span><strong>{t("remote-workspace-tree.confirmBeforeRunning")}</strong><small>{access?.requireCommandApproval === false ? t("remote-workspace-tree.whenOffRunsDirectlyUnderCurrentSessionPermissions") : t("remote-workspace-tree.requiresDshAskModeFullAccessIsRejectedOutright")}</small></span><input type="checkbox" checked={access?.requireCommandApproval ?? true} disabled={access === null || loading || saving} onChange={event => onApproval(event.target.checked)} /><i aria-hidden="true" /></label>
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    <SessionDefaults />
  </footer>
}

function RemoteProjectDialog({ profile, project, onClose, onSaved }: { profile: ProfileView; project?: RemoteProjectView | undefined; onClose(): void; onSaved(): Promise<void> }): JSX.Element {
  useSshLocale()
  const { confirm, confirmation } = useConfirmationDialog()
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
    if (project === undefined) return
    confirm({ title: t('client.delete2', [project.name]), description: t('remote-workspace-tree.deletePinnedDirectoryRelatedDshSessionsWillNotBe', [project.name]), onConfirm: async () => { await deleteRemoteProject(profile.id, project.id); await onSaved() } })
  }
  return <Dialog className="dsh-ssh-project-dialog" title={project === undefined ? t("remote-workspace-tree.addPinnedDirectory") : t("remote-workspace-tree.editPinnedDirectory")} subtitle={t("remote-workspace-tree.defaultRemotePathForTheTerminalAndSftp", [profile.name])} onClose={onClose}>
    {confirmation}
    <form className="dsh-ssh-form" onSubmit={event => { void submit(event) }}>
        <label className="dsh-ssh-field"><span>{t("client.name")}</span><input required maxLength={80} value={name} placeholder={t("remote-workspace-tree.websiteProject")} onChange={event => setName(event.target.value)} /></label>
        <RemotePathInput profileId={profile.id} value={path} disabled={saving} onChange={setPath} />
        {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
        <div className="dsh-ssh-dialog-actions">{project !== undefined && <button type="button" className="dsh-ssh-danger-button" disabled={saving} onClick={() => { void remove() }}><IconTrashOutline16 size={15} />{t("client.delete")}</button>}<span className="dsh-ssh-dialog-spacer" /><button type="button" className="dsh-ssh-secondary-button" data-ssh-dialog-close disabled={saving} onClick={onClose}>{t("client.cancel")}</button><button className="dsh-ssh-primary-button" disabled={saving}>{saving ? t("client.saving2") : t("remote-workspace-tree.saveDirectory")}</button></div>
    </form>
  </Dialog>
}

function groupProfiles(profiles: ProfileView[], groupConfigs: GroupProxy[], query: string, projects: Record<string, RemoteProjectView[]> = {}): Array<{ name: string; profiles: ProfileView[]; allProfileIds: string[] }> {
  const result = new Map<string, ProfileView[]>()
  if (profiles.some(profile => !profile.group?.trim())) result.set('', [])
  for (const profile of profiles) {
    const name = profile.group?.trim() || ''
    const current = result.get(name)
    if (current === undefined) result.set(name, [profile]); else current.push(profile)
  }
  for (const group of groupConfigs) if (!result.has(group.name)) result.set(group.name, [])
  return [...result]
    .map(([name, grouped]) => ({ name, allProfileIds: grouped.map(profile => profile.id), profiles: grouped.filter(profile => !query || name.toLocaleLowerCase().includes(query) || searchText(profile).includes(query) || (projects[profile.id] ?? []).some(project => `${project.name} ${project.path}`.toLocaleLowerCase().includes(query))) }))
    .filter(group => !query || group.profiles.length > 0 || group.name.toLocaleLowerCase().includes(query))
}

function searchText(profile: ProfileView): string { return `${profile.name} ${profile.group ?? ''} ${profile.host} ${profile.username} ${profile.tags.join(' ')}`.toLocaleLowerCase() }
function navigateMenu(event: React.KeyboardEvent<HTMLDivElement>): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]
  if (items.length === 0) return
  const current = items.indexOf(document.activeElement as HTMLButtonElement)
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
    : event.key === 'ArrowDown' ? (current + 1 + items.length) % items.length
      : (current - 1 + items.length) % items.length
  items[index]?.focus()
}
function message(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason) }
