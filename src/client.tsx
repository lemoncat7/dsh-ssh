import { useSshLocale } from './use-ssh-locale.js'
import { t } from './i18n.js'
import { bindHostLocale, type HostLocale } from './ssh-locale-binding.js'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ISessions, SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces, WorkspaceId, WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { SshActivityPanel, type ActivityController, type ActivityViewMode } from './activity-panel.js'
import { AdaptiveWorkspace } from './adaptive-workspace.js'
import adaptiveUiCss from './adaptive-workspace.css'
import borderGlowCss from './border-glow.css'
import { useBorderGlowSurface } from './border-glow.js'
import interactiveSurfacesCss from './interactive-surfaces.css'
import activitySurfaceCss from './activity-surface.css'
import { activatePluginWorkspace, observePluginWorkspace } from './workspace-ownership.js'
import {
  IconChevronDownOutline14, IconCloseOutline16, IconDataOutline16,
  IconEditOutline16, IconPanelLeftOutline16, IconPlusOutline16,
  IconStopFill16, IconTrashOutline16, IconChevronLeftOutline14,
  IconUserOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import xtermCss from '@xterm/xterm/css/xterm.css'
import cssText from './client.css'
import dialogCss from './dialog.css'
import remoteWorkspaceCss from './remote-workspace-tree.css'
import hostWorkbenchCss from './host-workbench.css'
import {
  activityEventStreamUrl, api, loadForwards, loadFtpProfiles, loadInjection, loadProfiles, loadProxyEntries, loadVaultEntries,
  profileAddress,
  type ForwardStatus, type ForwardView, type FtpProfileView, type GistSyncView, type GitHubDeviceFlowStart, type GitHubDeviceFlowStatus,
  saveSessionAccess, type InjectionView, type ProfileView, type ProxyEntryView, type RemoteProjectView, type SettingsView, type TerminalOpenedEvent, type VaultEntryView,
} from './client-api.js'
import { useWorkspaceTopAnchor } from './sidebar-anchor.js'
import { ProfileSftpPane } from './sftp-client.js'
import { TerminalWorkspace } from './terminal-workspace.js'
import { refreshWorkspace, useWorkspaceRefresh } from './use-workspace-refresh.js'
import { GroupProxyEditor } from './group-proxy-editor.js'
import type { GroupProxy } from './domain.js'
import { CommandsPanel } from './commands-panel.js'
import workbenchPagesCss from './workbench-pages.css'
import { RemoteWorkspaceTree, type RemoteTarget } from './remote-workspace-tree.js'
import { emptyAccess, useSessionAccess } from './session-access.js'
import { subscribeSessionAccess } from './session-access-channel.js'
import { ResizableSplit } from './resizable-split.js'
import { Dialog, EmptyState, Field, PasswordInput, Segment, ServerGlyph, errorMessage } from './ui-components.js'
import { useConfirmationDialog } from './confirmation-dialog.js'
import { ProfileDeleteDialog, ProfileEditor } from './profile-editor.js'
import { FileTransferWorkspace } from './file-transfer-workspace.js'
import fileTransferCss from './file-transfer-workspace.css'
import { createDockedPanel, supportsDockedPanels } from './docked-panel-compat.js'
import { registerMainPanel } from './main-panel-compat.js'

const PLUGIN_ID = '@lemoncat7/dsh-ssh'
const STYLE_ID = `${PLUGIN_ID}/client`
type SidebarActionProps = PropsRuntime<'sidebar.footer.action'>
type ConversationProps = PropsRuntime<'conversation'>

interface RemoteController {
  open(profileId?: string): void
  toggle(): void
  close(): void
  isOpen(): boolean
  selected(): string | undefined
  subscribe(listener: () => void): () => void
  createProjectSession(workspaceId: string, project: RemoteProjectView, permission: InjectionView['permission'], requireCommandApproval: boolean): Promise<string>
}

export const inject = ['slots', 'layout', 'sessions', 'workspaces']

export function apply(ctx: ClientContext): void {
  ctx.inject(['locale'], child => {
    child.effect(() => bindHostLocale(child.get('locale') as HostLocale), 'dsh-ssh: display language')
  })
  ctx.effect(installStyles, 'dsh-ssh: styles')
  const docked = supportsDockedPanels(ctx)
  const activityController = createActivityController(ctx)
  const controller = createController(ctx, () => { if (!docked) activityController.close() })
  ctx.effect(() => observePluginWorkspace(PLUGIN_ID, () => { controller.close(); if (!docked) activityController.close() }), 'dsh-ssh: exclusive workspace')
  ctx.effect(() => () => { controller.close(); activityController.dispose() }, 'dsh-ssh: workspace lifecycle')
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'ssh-remote', order: -100,
  }, props => <RemoteSidebar
    {...props}
    controller={controller}
    activityController={activityController}
    collapseSidebar={() => ctx.layout.toggleSidebar()}
  />))
}

function createController(ctx: ClientContext, beforeOpen: () => void): RemoteController {
  const runtime = ctx as unknown as { sessions: ISessions; workspaces: IWorkspaces }
  const listeners = new Set<() => void>()
  let selected: string | undefined
  let dispose: (() => void) | undefined
  const notify = (): void => { for (const listener of listeners) listener() }
  const controller: RemoteController = {
    open(profileId) {
      beforeOpen()
      if (profileId !== undefined) selected = profileId
      if (dispose === undefined) {
        activatePluginWorkspace(PLUGIN_ID)
        dispose = registerMainPanel(ctx, PLUGIN_ID, -2, props => (
          <RemoteWorkspace {...props} controller={controller} />
        ), () => controller.close())
      }
      notify()
    },
    toggle() { if (dispose === undefined) controller.open(); else controller.close() },
    close() { if (dispose === undefined) return; const current = dispose; dispose = undefined; current(); notify() },
    isOpen: () => dispose !== undefined,
    selected: () => selected,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    async createProjectSession(workspaceId, project, permission, requireCommandApproval) {
      const sessionId = await runtime.sessions.create({ workspaceId: workspaceId as WorkspaceId })
      await saveSessionAccess({ ...emptyAccess(String(sessionId)), profileIds: [project.profileId], permission, requireCommandApproval, workingDirectories: { [project.profileId]: project.path }, workingProjectIds: { [project.profileId]: project.id } })
      runtime.sessions.open(sessionId)
      return String(sessionId)
    },
  }
  return controller
}

function createActivityController(ctx: ClientContext): ActivityController {
  if (supportsDockedPanels(ctx)) return createDockedActivityController(ctx)
  const runtime = ctx as unknown as { sessions: ISessions }
  const listeners = new Set<() => void>()
  const states = new Map<string, { open: boolean; selectedProfileId?: string; requestedView: ActivityViewMode }>()
  let currentSessionId = normalizeSessionId(runtime.sessions.list.getSnapshot().current)
  let mountedSessionId: string | undefined
  let restoreFrame: number | undefined
  let dispose: (() => void) | undefined
  const notify = (): void => { for (const listener of listeners) listener() }
  const cancelRestore = (): void => {
    if (restoreFrame === undefined) return
    window.cancelAnimationFrame(restoreFrame)
    restoreFrame = undefined
  }
  const unmount = (): boolean => {
    if (dispose === undefined) return false
    const current = dispose
    dispose = undefined
    mountedSessionId = undefined
    current()
    return true
  }
  const mount = (targetSessionId: string, openDetails = true): void => {
    if (mountedSessionId === targetSessionId && dispose !== undefined) return
    unmount()
    mountedSessionId = targetSessionId
    dispose = ctx.slots.register({ name: 'details', priority: -2 }, props => (
      <SshActivityPanel {...props} controller={controller} />
    ))
    if (openDetails) ctx.layout.openDetails()
  }
  const syncCurrentSession = (): void => {
    const snapshot = runtime.sessions.list.getSnapshot()
    const nextSessionId = normalizeSessionId(snapshot.current)
    if (nextSessionId === currentSessionId) return
    cancelRestore()
    const wasMounted = unmount()
    currentSessionId = nextSessionId
    if (nextSessionId !== undefined && states.get(nextSessionId)?.open === true) {
      mount(nextSessionId, false)
      // DSH intentionally closes details in AppFrame's layout effect whenever
      // the selected session changes. Restore only after that commit, and only
      // if the same session still owns an open SSH panel.
      restoreFrame = window.requestAnimationFrame(() => {
        restoreFrame = undefined
        if (currentSessionId === nextSessionId && mountedSessionId === nextSessionId && states.get(nextSessionId)?.open === true) ctx.layout.openDetails()
      })
    } else if (wasMounted) ctx.layout.closeDetails()
    notify()
  }
  const controller: ActivityController = {
    open(sessionId, profileId, view) {
      const nextView = view ?? (profileId === undefined ? 'local-directory' : 'remote-directory')
      const previous = states.get(sessionId)
      const selectedProfileId = profileId ?? previous?.selectedProfileId
      states.set(sessionId, { open: true, ...(selectedProfileId === undefined ? {} : { selectedProfileId }), requestedView: nextView })
      activatePluginWorkspace(PLUGIN_ID)
      if (sessionId === currentSessionId) { cancelRestore(); mount(sessionId); ctx.layout.openDetails() }
      notify()
    },
    toggle(sessionId) {
      if (states.get(sessionId)?.open === true) return controller.close(sessionId)
      controller.open(sessionId)
    },
    close(sessionId) {
      const targetSessionId = sessionId ?? currentSessionId
      if (targetSessionId === undefined) return
      const previous = states.get(targetSessionId)
      if (previous !== undefined) states.set(targetSessionId, { ...previous, open: false })
      if (targetSessionId === currentSessionId) {
        cancelRestore()
        if (unmount()) ctx.layout.closeDetails()
      }
      notify()
    },
    isOpen: sessionId => states.get(sessionId)?.open === true,
    selected: sessionId => states.get(sessionId)?.selectedProfileId,
    requestedView: sessionId => states.get(sessionId)?.requestedView,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    dispose() {
      disposeSelection()
      cancelRestore()
      unmount()
      states.clear()
      listeners.clear()
    },
  }
  const disposeSelection = runtime.sessions.list.subscribe(syncCurrentSession)
  return controller
}

function normalizeSessionId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function createDockedActivityController(ctx: ClientContext): ActivityController {
  const states = new Map<string, { profileId: string | undefined; view: ActivityViewMode }>()
  const listeners = new Set<() => void>()
  const notify = (): void => { for (const listener of listeners) listener() }
  const panel = createDockedPanel(ctx, '@lemoncat7/dsh-ssh/activity', () => t("activity-panel.sshActivity"),
    props => <SshActivityPanel {...props} controller={controller} />, notify)
  const controller: ActivityController = {
    open(sessionId, profileId, view) {
      states.set(sessionId, { profileId: profileId ?? states.get(sessionId)?.profileId,
        view: view ?? (profileId === undefined ? 'local-directory' : 'remote-directory') })
      panel.open(sessionId)
    },
    toggle(sessionId) { if (panel.isOpen(sessionId)) controller.close(sessionId); else controller.open(sessionId) },
    close(sessionId) {
      const target = sessionId ?? normalizeSessionId((ctx.sessions as unknown as ISessions).list.getSnapshot().current)
      if (target !== undefined) panel.close(target)
    },
    isOpen: panel.isOpen,
    selected: sessionId => states.get(sessionId)?.profileId,
    requestedView: sessionId => states.get(sessionId)?.view,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    dispose() { panel.dispose(); states.clear(); listeners.clear() },
  }
  return controller
}

function RemoteSidebar(props: SidebarActionProps & { controller: RemoteController; activityController: ActivityController; collapseSidebar(): void }): JSX.Element {
  useSshLocale()
  const ref = useRef<HTMLElement>(null)
  useWorkspaceTopAnchor(ref)
  const sessionId = props.useSessions((state: SessionListState) => state.current)
  const currentSessionId = sessionId === undefined ? undefined : String(sessionId)
  const [profiles, setProfiles] = useState<ProfileView[]>([])
  const [injection, setInjection] = useState<InjectionView | null>(null)
  const [open, setOpen] = useState(true)
  const remoteOpen = useSyncExternalStore(props.controller.subscribe, props.controller.isOpen)
  const activityOpen = useSyncExternalStore(
    props.activityController.subscribe,
    () => currentSessionId !== undefined && props.activityController.isOpen(currentSessionId),
  )
  useEffect(() => subscribeSessionAccess(value => {
    if (value.sessionId === currentSessionId) setInjection(value)
  }), [currentSessionId])
  const refresh = useCallback(async () => {
    const next = await loadProfiles().catch(() => [])
    setProfiles(next)
    setInjection(sessionId === undefined ? null : await loadInjection(String(sessionId)).catch(() => null))
  }, [sessionId])
  useEffect(() => { void refresh() }, [refresh, remoteOpen])
  const availableProfiles = injection === null ? [] : injection.profileIds.map(profileId => profiles.find(profile => profile.id === profileId)).filter((profile): profile is ProfileView => profile !== undefined)
  useEffect(() => {
    if (currentSessionId === undefined || injection?.permission !== 'terminal') return
    const source = new EventSource(activityEventStreamUrl(currentSessionId))
    const opened = (raw: Event): void => {
      const event = parseTerminalOpenedEvent(raw)
      if (event === undefined || event.sessionId !== currentSessionId) return
      props.controller.close()
      props.activityController.open(currentSessionId, event.profileId, 'terminals')
    }
    source.addEventListener('terminal-opened', opened)
    return () => {
      source.removeEventListener('terminal-opened', opened)
      source.close()
    }
  }, [currentSessionId, injection?.permission, props.activityController, props.controller])
  const openActivity = (profileId?: string): void => {
    if (currentSessionId === undefined) return
    props.controller.close()
    props.activityController.open(currentSessionId, profileId, profileId === undefined ? 'local-directory' : 'remote-directory')
  }
  const toggleActivity = (): void => {
    if (currentSessionId === undefined) return
    if (activityOpen) props.activityController.close(currentSessionId)
    else openActivity()
  }
  const openWorkspace = (): void => {
    props.controller.open()
    if (props.wide && window.matchMedia('(max-width: 820px)').matches) props.collapseSidebar()
  }

  if (!props.wide) {
    return <section ref={ref} className="dsh-ssh-sidebar is-rail">
      <button type="button" data-ssh-interactive="choice" className={`dsh-ssh-rail-button${activityOpen ? ' is-active' : ''}`} title={currentSessionId === undefined ? t("client.openASessionToSeeTheSshSidebar") : activityOpen ? t("client.collapseSshSidebar") : t("client.expandSshSidebar")} aria-label={activityOpen ? t("client.collapseSshSidebar") : t("client.expandSshSidebar")} aria-pressed={activityOpen} disabled={currentSessionId === undefined} onClick={toggleActivity}><ServerGlyph /></button>
    </section>
  }
  return <section ref={ref} className="dsh-ssh-sidebar">
    <div className="dsh-ssh-sidebar-heading">
      <button type="button" className="dsh-ssh-sidebar-title" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span className="dsh-ssh-disclosure" data-open={open}><IconChevronDownOutline14 size={14} /></span><span>{t("client.theRemote")}</span>
      </button>
      <button type="button" data-ssh-interactive="choice" className={`dsh-ssh-icon-button${activityOpen ? ' is-active' : ''}`} aria-label={activityOpen ? t("client.collapseSshSidebar") : t("client.expandSshSidebar")} title={currentSessionId === undefined ? t("client.openASessionToSeeTheSshSidebar") : activityOpen ? t("client.collapseSshSidebar") : t("client.expandSshSidebar")} aria-pressed={activityOpen} disabled={currentSessionId === undefined} onClick={toggleActivity}><IconPanelLeftOutline16 size={16} className="dsh-ssh-panel-right-icon" /></button>
    </div>
    {open && <div className="dsh-ssh-sidebar-list">
      <button type="button" className="dsh-ssh-sidebar-panel" onClick={openWorkspace}><ServerGlyph /><span>{t("client.sshPanel")}</span></button>
      {currentSessionId === undefined ? <p className="dsh-ssh-sidebar-note">{t("client.availableRemotesAppearOnceASessionIsOpen")}</p>
        : availableProfiles.length === 0 ? <p className="dsh-ssh-sidebar-note">{t("client.noRemotesGrantedToThisSession")}</p>
          : availableProfiles.slice(0, 6).map(profile => <button type="button" data-ssh-interactive="choice" aria-pressed={activityOpen && props.activityController.selected(currentSessionId) === profile.id} className={`dsh-ssh-sidebar-row${activityOpen && props.activityController.selected(currentSessionId) === profile.id ? ' is-active' : ''}`} key={profile.id} onClick={() => openActivity(profile.id)}>
            <span className="dsh-ssh-status-dot is-injected" aria-hidden="true" />
            <span className="dsh-ssh-sidebar-copy"><strong>{profile.name}</strong><small>{profile.host}</small></span>
            <span className="dsh-ssh-injected-mark">{t("client.mounted")}</span>
          </button>)}
      {availableProfiles.length > 6 && <button type="button" className="dsh-ssh-sidebar-more" onClick={toggleActivity}>{t("client.another")} {availableProfiles.length - 6}  {t("client.availableHosts")}</button>}
    </div>}
  </section>
}

function RemoteWorkspace(props: ConversationProps & { controller: RemoteController }): JSX.Element {
  useSshLocale()
  const toolbarGlow = useBorderGlowSurface<HTMLElement>()
  const sessionId = props.useSessions((state: SessionListState) => state.current)
  const workspaceList = props.useWorkspaces((state: WorkspaceSnapshot) => state)
  const [profiles, setProfiles] = useState<ProfileView[]>([])
  const [vaultEntries, setVaultEntries] = useState<VaultEntryView[]>([])
  const [proxyEntries, setProxyEntries] = useState<ProxyEntryView[]>([])
  const [groupProxies, setGroupProxies] = useState<GroupProxy[]>([])
  const [editingGroup, setEditingGroup] = useState<string>()
  const [ftpProfiles, setFtpProfiles] = useState<FtpProfileView[]>([])
  const [target, setTarget] = useState<RemoteTarget | null>(() => props.controller.selected() === undefined ? null : { profileId: props.controller.selected()!, path: '~' })
  const [view, setView] = useState<'workspace' | 'transfer' | 'forwards' | 'vault' | 'proxies' | 'settings' | 'commands'>('workspace')
  const [visitedHosts, setVisitedHosts] = useState<string[]>([])
  const [closeAllRequest, setCloseAllRequest] = useState(0)
  const [closingAllTerminals, setClosingAllTerminals] = useState(false)
  const [terminalCounts, setTerminalCounts] = useState<Record<string, number>>({})
  const reportTerminalCount = useCallback((id: string, count: number) => {
    setTerminalCounts(current => current[id] === count ? current : { ...current, [id]: count })
  }, [])
  const totalTerminals = profiles.reduce((sum, profile) => sum + (terminalCounts[profile.id] ?? 0), 0)
  const [editing, setEditing] = useState<ProfileView | 'new'>()
  const [deleting, setDeleting] = useState<ProfileView>()
  const [refreshKey, setRefreshKey] = useState(0)
  const [error, setError] = useState<string>()
  const access = useSessionAccess(sessionId === undefined ? undefined : String(sessionId))
  const openedSessionRef = useRef(sessionId)
  const refreshGeneration = useRef(0)
  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      const options = { signal: controller.signal, cache: 'no-store' as const }
      const [next, ftp, credentials, proxies, groups] = await Promise.all([api<ProfileView[]>('/profiles', options), api<FtpProfileView[]>('/ftp-profiles', options), api<VaultEntryView[]>('/vault', options), api<ProxyEntryView[]>('/proxies', options), api<GroupProxy[]>('/group-proxies', options)])
      if (generation !== refreshGeneration.current) return false
      setProfiles(next)
      setFtpProfiles(ftp)
      setVaultEntries(credentials)
      setProxyEntries(proxies)
      setGroupProxies(groups)
      setTarget(current => current !== null && next.some(item => item.id === current.profileId) ? current : next[0] === undefined ? null : { profileId: next[0].id, path: '~' })
      setError(undefined)
    } catch (reason) { if (generation === refreshGeneration.current) setError(message(reason)); return false }
    finally { clearTimeout(timeout) }
  }, [])
  useEffect(() => {
    const sync = (): void => {
      const next = props.controller.selected()
      if (next !== undefined) setTarget(current => ({ profileId: next, path: current?.profileId === next ? current.path : '~' }))
    }
    sync()
    return props.controller.subscribe(sync)
  }, [props.controller])
  useEffect(() => { void refresh() }, [refresh, refreshKey])
  useWorkspaceRefresh(refresh)
  useEffect(() => {
    if (openedSessionRef.current !== sessionId) props.controller.close()
  }, [props.controller, sessionId])
  const selected = profiles.find(item => item.id === target?.profileId)
  useEffect(() => {
    if (view === 'workspace' && selected) setVisitedHosts(current => current.includes(selected.id) ? current : [...current, selected.id])
  }, [view, selected?.id])
  const currentWorkspaceId = workspaceList.items.find((item: WorkspaceView) => sessionId !== undefined && item.sessionIds.includes(sessionId))?.workspaceId
  const toolbar = <header ref={toolbarGlow.ref} onPointerMove={toolbarGlow.onPointerMove} onPointerLeave={toolbarGlow.onPointerLeave} className="dsh-ssh-toolbar dsh-ssh-border-surface">
      <div className="dsh-ssh-brand"><button type="button" className="dsh-ssh-icon-button" aria-label={t("client.backToSession")} title={t("client.backToSession")} onClick={() => props.controller.close()}><IconChevronLeftOutline14 size={15} /></button><span className="dsh-ssh-brand-glyph"><ServerGlyph /></span><span><strong>{t("client.sshWorkbench")}</strong><small>{view === 'transfer' ? 'FTP · FTPS · SFTP' : selected === undefined ? t("client.selectAHost") : `${selected.username}@${selected.host}`}</small></span></div>
      <nav className="dsh-ssh-segments" role="tablist" aria-label={t("client.sshWorkbenchView")}>
        <Segment active={view === 'workspace'} onClick={() => setView('workspace')}>{t("client.terminalsFiles")}</Segment>
        <Segment active={view === 'transfer'} onClick={() => setView('transfer')}>{t("client.fileTransfer")}</Segment>
        <Segment active={view === 'commands'} onClick={() => setView('commands')}>{t("client.savedCommands")}</Segment>
        <Segment active={view === 'forwards'} onClick={() => setView('forwards')}>{t("client.portForwarding")}</Segment>
        <Segment active={view === 'vault'} onClick={() => setView('vault')}>{t("client.credentialVault")}</Segment>
        <Segment active={view === 'proxies'} onClick={() => setView('proxies')}>{t("client.proxyVault")}</Segment>
        <Segment active={view === 'settings'} onClick={() => setView('settings')}>{t("client.settings")}</Segment>
      </nav>
    </header>
  const notice = error && <div className="dsh-ssh-banner is-error" role="alert"><span>{error}</span><button onClick={() => setError(undefined)} aria-label={t("client.close")}><IconCloseOutline16 size={16} /></button></div>
  return <>
    <AdaptiveWorkspace
      className={`dsh-ssh-workspace${view === 'transfer' ? ' is-transfer' : ''}`}
      toolbar={toolbar}
      notice={notice}
      navigationLabel={t("client.host")}
      navigationIcon={<IconDataOutline16 size={15} />}
      navigation={controls => <RemoteWorkspaceTree
        profiles={profiles}
        onGroupProxy={setEditingGroup}
        access={access.value}
        accessLoading={access.loading}
        accessSaving={access.saving}
        accessError={access.error}
        workspaces={workspaceList.items}
        currentWorkspaceId={currentWorkspaceId === undefined ? undefined : String(currentWorkspaceId)}
        recentWorkspaceId={workspaceList.recentWorkspaceId === undefined ? undefined : String(workspaceList.recentWorkspaceId)}
        selected={target}
        onSelect={next => { setTarget(next); setView('workspace'); props.controller.open(next.profileId); controls.closePanel() }}
        onProfiles={access.setProfiles}
        onToggleProject={access.toggleProject}
        onProjectsChanged={access.refresh}
        onDirectory={(profileId, path, projectId) => {
          access.setDirectory(profileId, path, projectId)
          if (path !== undefined) { setTarget({ profileId, path, ...(projectId === undefined ? {} : { projectId }) }); setView('workspace') }
        }}
        onPermission={access.setPermission}
        onApproval={access.setRequireCommandApproval}
        onCreateSession={async (project, workspaceId) => {
          await props.controller.createProjectSession(workspaceId, project, access.value?.permission ?? 'exec', access.value?.requireCommandApproval ?? true)
          props.controller.close()
        }}
        onNewProfile={() => { setEditing('new'); controls.closePanel() }}
      />}
    >
      <section className="dsh-ssh-main-panel dsh-ssh-scroll-surface">
        {profiles.filter(profile => visitedHosts.includes(profile.id)).map(profile => <div className="dsh-ssh-host-page" key={profile.id} hidden={view !== 'workspace' || selected?.id !== profile.id}><HostWorkbench profile={profile} initialPath={target?.profileId === profile.id ? target.path : '~'} active={view === 'workspace' && selected?.id === profile.id} onEdit={() => setEditing(profile)} onDelete={() => setDeleting(profile)} closeAllRequest={closeAllRequest} totalTerminals={totalTerminals} onCloseAll={() => setClosingAllTerminals(true)} reportTerminalCount={reportTerminalCount} /></div>)}
        {view === 'workspace' ? (selected === undefined ? <EmptyState /> : null) : view === 'transfer' ? <FileTransferWorkspace ftpProfiles={ftpProfiles} vaultEntries={vaultEntries} proxyEntries={proxyEntries} access={access} onProfilesChanged={() => setRefreshKey(value => value + 1)} />
          : view === 'commands' ? <CommandsPanel />
          : view === 'vault' ? <VaultPane entries={vaultEntries} onChanged={() => setRefreshKey(value => value + 1)} />
          : view === 'proxies' ? <ProxyPane entries={proxyEntries} onChanged={() => setRefreshKey(value => value + 1)} />
          : view === 'settings' ? <SettingsPane />
          : selected === undefined ? <EmptyState />
          : <ForwardPane profiles={profiles} selected={selected} />}
      </section>
    </AdaptiveWorkspace>
{closingAllTerminals && <Dialog variant="confirmation" title={t("client.closeTerminalsOnAllHosts")} subtitle={t("client.thisClosesAllTerminalTabsInThisWorkspaceIncluding", [totalTerminals])} onClose={() => setClosingAllTerminals(false)}><div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" onClick={() => setClosingAllTerminals(false)}>{t("client.cancel")}</button><button type="button" className="dsh-ssh-danger-button" onClick={() => { setCloseAllRequest(value => value + 1); setClosingAllTerminals(false) }}>{t("client.closeAll")}</button></div></Dialog>}
    {editingGroup !== undefined && <GroupProxyEditor key={editingGroup} name={editingGroup} value={groupProxies.find(group => group.name === editingGroup)} proxies={proxyEntries} onClose={() => setEditingGroup(undefined)} onSaved={() => { setEditingGroup(undefined); setRefreshKey(value => value + 1) }} />}
    {editing !== undefined && <ProfileEditor profile={editing === 'new' ? undefined : editing} profiles={profiles} vaultEntries={vaultEntries} proxyEntries={proxyEntries} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); setRefreshKey(value => value + 1) }} />}
    {deleting !== undefined && <ProfileDeleteDialog profile={deleting} dependents={profiles.filter(profile => profile.id !== deleting.id && profile.proxy.type === 'jump' && profile.proxy.profileIds.includes(deleting.id))} onClose={() => setDeleting(undefined)} onDeleted={() => { setDeleting(undefined); setEditing(undefined); setRefreshKey(value => value + 1) }} />}
  </>
}

function HostWorkbench({ profile, initialPath, active, onEdit, onDelete, closeAllRequest, totalTerminals, onCloseAll, reportTerminalCount }: { profile: ProfileView; initialPath: string; active: boolean; onEdit(): void; onDelete(): void; closeAllRequest: number; totalTerminals: number; onCloseAll(): void; reportTerminalCount(id: string, count: number): void }): JSX.Element {
  useSshLocale()
  const [sftpReady, setSftpReady] = useState(false)
  const [sftpHidden, setSftpHidden] = useState(false)
  const [terminalPath, setTerminalPath] = useState<string>()
  const onTerminalCount = useCallback((count: number) => reportTerminalCount(profile.id, count), [profile.id, reportTerminalCount])
  const headingGlow = useBorderGlowSurface<HTMLElement>()
  return <div className="dsh-ssh-host-workbench">
    <header ref={headingGlow.ref} onPointerMove={headingGlow.onPointerMove} onPointerLeave={headingGlow.onPointerLeave} className="dsh-ssh-workbench-heading dsh-ssh-border-surface">
      <div><span className="dsh-ssh-host-monogram">{profile.name.slice(0, 1).toUpperCase()}</span><span><h1>{profile.name}</h1><p>{profileAddress(profile)} · {proxyLabel(profile)}</p></span></div>
      <div className="dsh-ssh-heading-actions dsh-ssh-host-actions" role="group" aria-label={t("client.hostActions")}>
        <button type="button" className="dsh-ssh-secondary-button" aria-label={sftpHidden ? t("client.showSftp") : t("client.hideSftp")} title={sftpHidden ? t("client.showSftp") : t("client.hideSftp")} aria-expanded={!sftpHidden} onClick={() => setSftpHidden(value => !value)}><IconDataOutline16 size={16} />{sftpHidden ? t("client.showSftp") : t("client.hideSftp")}</button>
        <button type="button" className="dsh-ssh-secondary-button" aria-label={t("client.editHost")} title={t("client.editHost")} onClick={onEdit}><IconEditOutline16 size={16} />{t("client.editHost")}</button>
        <span className="dsh-ssh-host-action-divider" aria-hidden="true" />
        <button type="button" className="dsh-ssh-secondary-button" disabled={totalTerminals === 0} aria-label={t("client.closeAllTerminals")} title={t("client.closeTerminalsOnAllHosts2")} onClick={onCloseAll}><IconStopFill16 size={16} />{t("client.closeAllTerminals")}</button>
        <button type="button" className="dsh-ssh-icon-button is-danger" aria-label={t("client.deleteHost", [profile.name])} title={t("client.deleteHost2")} onClick={onDelete}><IconTrashOutline16 size={16} /></button>
      </div>
    </header>
    <ResizableSplit
      storageKey="dsh-ssh:workbench:sftp-width"
      label={t("client.adjustTheTerminalAndSftpWidths")}
      secondaryHidden={sftpHidden}
      primary={<section className="dsh-ssh-workbench-terminal" aria-label={t("client.terminal", [profile.name])}><TerminalWorkspace profile={profile} path={initialPath} onConnected={() => setSftpReady(true)} closeAllRequest={closeAllRequest} onCountChange={onTerminalCount} onDirectory={setTerminalPath} /></section>}
      secondary={<section className="dsh-ssh-workbench-files" aria-label={`${profile.name} SFTP`}>{sftpReady && active
        ? <ProfileSftpPane key={`${profile.id}:${initialPath}`} profile={profile} initialPath={initialPath} terminalPath={terminalPath} embedded />
        : <div className="dsh-ssh-sftp-deferred"><span>SFTP</span><strong>{t("client.waitingForTerminalConnection")}</strong><p>{t("client.theRemoteDirectoryLoadsOnceATerminalIsOpen")}</p></div>}
      </section>}
    />
  </div>
}


function ForwardPane({ profiles, selected }: { profiles: ProfileView[]; selected: ProfileView }): JSX.Element {
  useSshLocale()
  const [rules, setRules] = useState<ForwardView[]>([])
  const [statuses, setStatuses] = useState<ForwardStatus[]>([])
  const [editing, setEditing] = useState<ForwardView | 'new'>()
  const { confirm, confirmation } = useConfirmationDialog()
  const [error, setError] = useState<string>()
  const refresh = useCallback(async () => { try { const result = await loadForwards(); setRules(result.rules); setStatuses(result.statuses) } catch (reason) { setError(message(reason)) } }, [])
  useEffect(() => {
    let disposed = false
    let timer: number | undefined
    const poll = async (): Promise<void> => {
      await refresh()
      if (!disposed) timer = window.setTimeout(() => { void poll() }, document.visibilityState === 'hidden' ? 15000 : 4000)
    }
    void poll()
    return () => {
      disposed = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [refresh])
  const visible = rules.filter(rule => rule.profileId === selected.id)
  const action = async (id: string, name: 'start' | 'stop'): Promise<void> => { try { await api(`/forwards/${id}/${name}`, { method: 'POST', body: '{}' }); await refresh() } catch (reason) { setError(message(reason)) } }
  const remove = (id: string): void => {
    const rule = rules.find(item => item.id === id)
    if (!rule) return
    confirm({ title: t('client.delete2', [rule.name]), description: forwardSummary(rule, statuses.find(item => item.ruleId === id)), onConfirm: async () => { await api(`/forwards/${id}`, { method: 'DELETE' }); await refresh() } })
  }
  return <div className="dsh-ssh-forward-pane">
    {confirmation}
    <div className="dsh-ssh-content-heading"><div><h1>{t("client.portForwarding")}</h1><p>{selected.name}  {t("client.localRemoteAndDynamicSocks5")}</p></div><button className="dsh-ssh-primary-button" onClick={() => setEditing('new')}><IconPlusOutline16 size={16} />{t("client.newRule")}</button></div>
    {error && <p className="dsh-ssh-inline-error">{error}</p>}
    <div className="dsh-ssh-forward-list">
      {visible.length === 0 ? <div className="dsh-ssh-table-empty">{t("client.thisHostHasNoPortForwardingRulesYet")}</div> : visible.map(rule => {
        const status = statuses.find(item => item.ruleId === rule.id)
        return <article className="dsh-ssh-forward-row" key={rule.id}>
          <span className={`dsh-ssh-forward-kind is-${rule.kind}`}>{rule.kind === 'local' ? 'L' : rule.kind === 'remote' ? 'R' : 'D'}</span>
          <span className="dsh-ssh-forward-copy"><strong>{rule.name}</strong><small>{forwardSummary(rule, status)}</small></span>
          <span className={`dsh-ssh-state-label is-${status?.state ?? 'stopped'}`}>{forwardState(status)}</span>
          <button className="dsh-ssh-icon-button" onClick={() => setEditing(rule)} aria-label={t("client.edit")}><IconEditOutline16 size={16} /></button>
          {status?.state === 'running' ? <button className="dsh-ssh-icon-button" onClick={() => { void action(rule.id, 'stop') }} aria-label={t("client.stop")}><IconStopFill16 size={16} /></button>
            : <button className="dsh-ssh-small-primary" onClick={() => { void action(rule.id, 'start') }}>{t("client.start")}</button>}
          <button className="dsh-ssh-icon-button is-danger" onClick={() => { void remove(rule.id) }} aria-label={t("client.delete")}><IconTrashOutline16 size={16} /></button>
        </article>
      })}
    </div>
    {editing !== undefined && <ForwardEditor profile={selected} value={editing === 'new' ? undefined : editing} profiles={profiles} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); void refresh() }} />}
  </div>
}

function VaultPane({ entries, onChanged }: { entries: VaultEntryView[]; onChanged(): void }): JSX.Element {
  useSshLocale()
  const [editing, setEditing] = useState<VaultEntryView | 'new'>()
  const { confirm, confirmation } = useConfirmationDialog()
  const remove = (entry: VaultEntryView): void => confirm({
    title: t("client.delete2", [entry.name]),
    description: t("client.deleteTheCredentialVaultEntryThisActionCannotBe", [entry.name]),
    onConfirm: async () => { await api(`/vault/${entry.id}`, { method: 'DELETE' }); onChanged() },
  })
  return <div className="dsh-ssh-vault-pane">
    <div className="dsh-ssh-content-heading"><div><h1>{t("client.credentialVault")}</h1><p>{t("client.keepCommonAccountsInOnePlaceConnectionConfigsOnly")}</p></div><button type="button" className="dsh-ssh-primary-button" onClick={() => setEditing('new')}><IconPlusOutline16 size={16} />{t("client.newCredential")}</button></div>
    {confirmation}
    {entries.length === 0 ? <div className="dsh-ssh-vault-empty"><span><IconUserOutline16 size={20} /></span><strong>{t("client.noSavedCredentialsYet")}</strong><p>{t("client.passwordsAndPrivateKeysAreStoredOnlyInThe")}</p><button type="button" className="dsh-ssh-secondary-button" onClick={() => setEditing('new')}><IconPlusOutline16 size={15} />{t("client.addCredential")}</button></div>
      : <div className="dsh-ssh-vault-list">{entries.map(entry => <article className="dsh-ssh-vault-row" key={entry.id}><span className="dsh-ssh-vault-glyph"><IconUserOutline16 size={16} /></span><span><strong>{entry.name}</strong><small>{entry.username} · {entry.authType === 'password' ? t("client.password") : t("client.privateKey")}</small></span><span className={`dsh-ssh-vault-state${entry.credential.configured ? ' is-ready' : ''}`}>{entry.credential.configured ? t("client.available") : t("client.missingCredentials")}</span><small>{entry.references}  {t("client.connections")}</small><button type="button" className="dsh-ssh-icon-button" aria-label={t("client.edit2", [entry.name])} onClick={() => setEditing(entry)}><IconEditOutline16 size={16} /></button><button type="button" className="dsh-ssh-icon-button is-danger" disabled={entry.references > 0} aria-label={t("client.delete2", [entry.name])} title={entry.references > 0 ? t("client.stillInUseByConnections") : t("client.deleteCredential")} onClick={() => { void remove(entry) }}><IconTrashOutline16 size={16} /></button></article>)}</div>}
    {editing !== undefined && <VaultEditor value={editing === 'new' ? undefined : editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); onChanged() }} />}
  </div>
}

function VaultEditor({ value, onClose, onSaved }: { value?: VaultEntryView | undefined; onClose(): void; onSaved(): void }): JSX.Element {
  useSshLocale()
  const [form, setForm] = useState<{ name: string; username: string; authType: 'password' | 'private-key'; password: string; privateKey: string; passphrase: string }>({ name: value?.name ?? '', username: value?.username ?? '', authType: value?.authType ?? 'password', password: '', privateKey: '', passphrase: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); setSaving(true); setError(undefined)
    try {
      await api(value === undefined ? '/vault' : `/vault/${value.id}`, { method: value === undefined ? 'POST' : 'PUT', body: JSON.stringify({ entry: { name: form.name, username: form.username, authType: form.authType }, secrets: { password: form.password, privateKey: form.privateKey, passphrase: form.passphrase } }) })
      onSaved()
    } catch (reason) { setError(message(reason)) } finally { setSaving(false) }
  }
  return <Dialog title={value === undefined ? t("client.createCredential") : t("client.edit2", [value.name])} subtitle={t("client.passwordsAndPrivateKeysAreNotShownAgainAfter")} onClose={onClose}><form className="dsh-ssh-form" onSubmit={event => { void submit(event) }}>
    <div className="dsh-ssh-form-grid"><Field label={t("client.name")}><input required maxLength={80} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder={t("client.productionOps")} /></Field><Field label={t("client.username")}><input required maxLength={128} autoComplete="username" value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} /></Field></div>
    <Field label={t("client.authMethod")}><select value={form.authType} onChange={event => setForm({ ...form, authType: event.target.value as 'password' | 'private-key' })}><option value="password">{t("client.password")}</option><option value="private-key">{t("client.privateKey")}</option></select></Field>
    {form.authType === 'password' ? <Field label={t("client.password")} hint={value?.credential.fields.includes('password') ? t("client.savedLeaveBlankToKeepUnchanged") : t("client.requiredCannotBeReadBackAfterSaving")}><PasswordInput required={value === undefined || !value.credential.fields.includes('password')} autoComplete="new-password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /></Field>
      : <><Field label={t("client.privateKey")} hint={value?.credential.fields.includes('privateKey') ? t("client.savedLeaveBlankToKeepUnchanged") : t("client.pasteAnOpensshOrPemPrivateKey")}><textarea required={value === undefined || !value.credential.fields.includes('privateKey')} rows={7} spellCheck={false} value={form.privateKey} onChange={event => setForm({ ...form, privateKey: event.target.value })} /></Field><Field label={t("client.keyPassphrase")}><PasswordInput autoComplete="new-password" value={form.passphrase} onChange={event => setForm({ ...form, passphrase: event.target.value })} /></Field></>}
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}<div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" data-ssh-dialog-close onClick={onClose}>{t("client.cancel")}</button><button className="dsh-ssh-primary-button" disabled={saving}>{saving ? t("client.saving") : t("client.saveCredential")}</button></div>
  </form></Dialog>
}

function ProxyPane({ entries, onChanged }: { entries: ProxyEntryView[]; onChanged(): void }): JSX.Element {
  useSshLocale()
  const [editing, setEditing] = useState<ProxyEntryView | 'new'>()
  const { confirm, confirmation } = useConfirmationDialog()
  const remove = (entry: ProxyEntryView): void => confirm({
    title: t("client.delete2", [entry.name]),
    description: t("client.deleteTheProxyThisActionCannotBeUndone", [entry.name]),
    onConfirm: async () => { await api(`/proxies/${entry.id}`, { method: 'DELETE' }); onChanged() },
  })
  return <div className="dsh-ssh-proxy-pane">
    <div className="dsh-ssh-content-heading"><div><h1>{t("client.proxyVault")}</h1><p>{t("client.keepCommonHttpAndSocks5ProxiesInOnePlace")}</p></div><button type="button" className="dsh-ssh-primary-button" onClick={() => setEditing('new')}><IconPlusOutline16 size={16} />{t("client.newProxy")}</button></div>
    {confirmation}
    {entries.length === 0 ? <div className="dsh-ssh-vault-empty"><span><IconDataOutline16 size={20} /></span><strong>{t("client.noSavedProxiesYet")}</strong><p>{t("client.saveOnceAndMultipleSshHostsCanShareThe")}</p><button type="button" className="dsh-ssh-secondary-button" onClick={() => setEditing('new')}><IconPlusOutline16 size={15} />{t("client.addProxy")}</button></div>
      : <div className="dsh-ssh-proxy-list">{entries.map(entry => <article className="dsh-ssh-proxy-row" key={entry.id}>
        <span className="dsh-ssh-vault-glyph"><IconDataOutline16 size={16} /></span>
        <span><strong>{entry.name}</strong><small>{entry.host}:{entry.port}{entry.username ? ` · ${entry.username}` : ''}</small></span>
        <span className="dsh-ssh-proxy-kind">{entry.proxyType === 'http' ? 'HTTP' : 'SOCKS5'}</span>
        <small>{entry.references}  {t("client.connections")}</small>
        <button type="button" className="dsh-ssh-icon-button" aria-label={t("client.edit2", [entry.name])} onClick={() => setEditing(entry)}><IconEditOutline16 size={16} /></button>
        <button type="button" className="dsh-ssh-icon-button is-danger" disabled={entry.references > 0} aria-label={t("client.delete2", [entry.name])} title={entry.references > 0 ? t("client.stillInUseByConnections") : t("client.deleteProxy")} onClick={() => { void remove(entry) }}><IconTrashOutline16 size={16} /></button>
      </article>)}</div>}
    {editing !== undefined && <ProxyEditor value={editing === 'new' ? undefined : editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); onChanged() }} />}
  </div>
}

function ProxyEditor({ value, onClose, onSaved }: { value?: ProxyEntryView | undefined; onClose(): void; onSaved(): void }): JSX.Element {
  useSshLocale()
  const [form, setForm] = useState({
    name: value?.name ?? '', proxyType: value?.proxyType ?? 'socks5' as 'http' | 'socks5', host: value?.host ?? '', port: String(value?.port ?? 1080), username: value?.username ?? '', password: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); setSaving(true); setError(undefined)
    try {
      await api(value === undefined ? '/proxies' : `/proxies/${value.id}`, {
        method: value === undefined ? 'POST' : 'PUT',
        body: JSON.stringify({ entry: { name: form.name, proxyType: form.proxyType, host: form.host, port: Number(form.port), ...(form.username.trim() ? { username: form.username.trim() } : {}) }, secrets: { proxyPassword: form.password } }),
      })
      onSaved()
    } catch (reason) { setError(message(reason)) } finally { setSaving(false) }
  }
  return <Dialog title={value === undefined ? t("client.createProxy") : t("client.edit2", [value.name])} subtitle={t("client.theProxyPasswordIsNotShownAgainAfterSaving")} onClose={onClose}><form className="dsh-ssh-form" onSubmit={event => { void submit(event) }}>
    <div className="dsh-ssh-form-grid"><Field label={t("client.name")}><input required maxLength={80} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder={t("client.officeSocks5")} /></Field><Field label={t("client.proxyType")}><select value={form.proxyType} onChange={event => setForm({ ...form, proxyType: event.target.value as 'http' | 'socks5' })}><option value="socks5">SOCKS5</option><option value="http">HTTP CONNECT</option></select></Field></div>
    <div className="dsh-ssh-form-grid is-host"><Field label={t("client.proxyHost")}><input required maxLength={253} value={form.host} onChange={event => setForm({ ...form, host: event.target.value })} placeholder="127.0.0.1" /></Field><Field label={t("client.proxyPort")}><input required type="number" min="1" max="65535" value={form.port} onChange={event => setForm({ ...form, port: event.target.value })} /></Field></div>
    <div className="dsh-ssh-form-grid"><Field label={t("client.proxyUsername")}><input maxLength={128} value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} autoComplete="username" /></Field><Field label={t("client.proxyPassword")} hint={value?.credential.fields.includes('proxyPassword') ? t("client.savedLeaveBlankToKeepUnchanged") : t("client.optionalCannotBeReadBackAfterSaving")}><input type="password" autoComplete="new-password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /></Field></div>
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    <div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" data-ssh-dialog-close onClick={onClose}>{t("client.cancel")}</button><button className="dsh-ssh-primary-button" disabled={saving}>{saving ? t("client.saving") : t("client.saveProxy")}</button></div>
  </form></Dialog>
}

function SettingsPane(): JSX.Element {
  useSshLocale()
  const [settings, setSettings] = useState<SettingsView>()
  const [gist, setGist] = useState<GistSyncView>()
  const [token, setToken] = useState('')
  const [encryptionPassphrase, setEncryptionPassphrase] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [oauthFlow, setOauthFlow] = useState<GitHubDeviceFlowStart>()
  const [busy, setBusy] = useState<'save' | 'test' | 'sync' | 'oauth' | 'disconnect' | 'network'>()
  const [notice, setNotice] = useState<string>()
  const [error, setError] = useState<string>()
  const githubAuthError = gist?.authPaused === true || (gist?.tokenConfigured === false && gist.lastError?.startsWith(t("client.githubAuthorizationExpired")) === true) ? gist?.lastError : undefined
  useEffect(() => {
    void Promise.all([api<SettingsView>('/settings'), api<GistSyncView>('/gist-sync')])
      .then(([nextSettings, nextGist]) => { setSettings(nextSettings); setGist(nextGist) })
      .catch(reason => setError(message(reason)))
  }, [])
  useEffect(() => {
    if (oauthFlow === undefined) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      try {
        const status = await api<GitHubDeviceFlowStatus>('/gist-sync/oauth/poll', { method: 'POST', body: JSON.stringify({ id: oauthFlow.id }) })
        if (cancelled) return
        if (status.state === 'complete') {
          setOauthFlow(undefined)
          setGist(await api('/gist-sync'))
          setNotice(t("client.githubConnected", [status.login]))
          return
        }
        timer = setTimeout(() => { void poll() }, Math.max(1_000, status.retryAfterMs))
      } catch (reason) {
        if (cancelled) return
        setOauthFlow(undefined)
        setError(message(reason))
      }
    }
    timer = setTimeout(() => { void poll() }, Math.max(1_000, oauthFlow.retryAfterMs))
    return () => { cancelled = true; if (timer !== undefined) clearTimeout(timer) }
  }, [oauthFlow?.id])
  const save = async (next: SettingsView): Promise<void> => { try { setSettings(await api('/settings', { method: 'PUT', body: JSON.stringify(next) })) } catch (reason) { setError(message(reason)) } }
  const testGitHubNetwork = async (): Promise<void> => {
    if (settings === undefined) return
    setBusy('network'); setError(undefined); setNotice(undefined)
    try {
      const saved = await api<SettingsView>('/settings', { method: 'PUT', body: JSON.stringify(settings) })
      setSettings(saved)
      const result = await api<{ route: 'direct' | 'proxy' }>('/gist-sync/network/test', { method: 'POST' })
      setNotice(t("client.githubReachable", [result.route === 'proxy' ? t("client.viaProxy") : t("client.direct")]))
    } catch (reason) { setError(message(reason)) } finally { setBusy(undefined) }
  }
  const saveGistConfiguration = async (): Promise<GistSyncView> => {
    if (gist === undefined) throw new Error(t("client.gistSyncSettingsAreNotLoadedYet"))
    const next = await api<GistSyncView>('/gist-sync', {
      method: 'PUT',
      body: JSON.stringify({
        settings: {
          autoSync: gist.autoSync, strategy: gist.strategy, backupRetention: gist.backupRetention,
          gistId: gist.gistId ?? '', oauthClientId: gist.oauthClientId ?? '',
        },
        ...(token.trim() ? { token: token.trim() } : {}),
        ...(encryptionPassphrase ? { encryptionPassphrase } : {}),
      }),
    })
    setGist(next); setToken(''); setEncryptionPassphrase('')
    return next
  }
  const persistGist = async (kind: 'save' | 'test' | 'sync'): Promise<GistSyncView | undefined> => {
    if (gist === undefined) return undefined
    setBusy(kind); setError(undefined); setNotice(undefined)
    try {
      const next = await saveGistConfiguration()
      if (kind === 'save') { setNotice(t("client.gistSyncSettingsSaved")); return next }
      if (kind === 'test') {
        const result = await api<{ login: string }>('/gist-sync/test', { method: 'POST' })
        setNotice(t("client.connected", [result.login]))
        setGist(await api('/gist-sync'))
        return next
      }
      const synced = await api<GistSyncView>('/gist-sync/run', { method: 'POST' })
      refreshWorkspace()
      setGist(synced); setNotice(syncResultLabel(synced.lastResult)); return synced
    } catch (reason) {
      setError(message(reason))
      try { setGist(await api('/gist-sync')) } catch {}
      return undefined
    } finally { setBusy(undefined) }
  }
  const connectGitHub = async (): Promise<void> => {
    setBusy('oauth'); setError(undefined); setNotice(undefined)
    try {
      await saveGistConfiguration()
      const flow = await api<GitHubDeviceFlowStart>('/gist-sync/oauth/start', { method: 'POST' })
      setOauthFlow(flow)
      setNotice(t("client.deviceCodeGeneratedCopyItInTheAuthorizationWindow"))
    } catch (reason) { setError(message(reason)) } finally { setBusy(undefined) }
  }
  const disconnectGitHub = async (): Promise<void> => {
    setBusy('disconnect'); setError(undefined); setNotice(undefined); setOauthFlow(undefined)
    try {
      setGist(await api('/gist-sync/oauth/disconnect', { method: 'POST' }))
      setNotice(t("client.githubAccountDisconnectedTheSyncEncryptionPasswordIsStill"))
    } catch (reason) { setError(message(reason)) } finally { setBusy(undefined) }
  }
  return <div className="dsh-ssh-settings-pane"><div className="dsh-ssh-content-heading"><div><h1>{t("client.sshSettings")}</h1><p>{t("client.securityBoundariesCommandLimitsAndCrossDeviceConfigSync")}</p></div></div>
    <div className="dsh-ssh-settings-stack">
      {gist && <section className="dsh-ssh-settings-section" aria-labelledby="dsh-ssh-gist-title">
        <div className="dsh-ssh-settings-section-heading"><span><strong id="dsh-ssh-gist-title">{t("client.githubGistSync")}</strong><small>{t("client.endToEndEncryptedSyncOfHostsFtpFtps")}</small></span><SyncStatus view={gist} /></div>
        <div className={`dsh-ssh-github-auth${githubAuthError === undefined ? '' : ' is-invalid'}`}>
          <span className="dsh-ssh-github-mark" aria-hidden="true">GH</span>
          <span><strong>{githubAuthError !== undefined ? t("client.checkGithubAuthorization") : gist.tokenConfigured ? t("client.connected2", [gist.githubLogin ?? 'GitHub']) : t("client.connectGithub")}</strong><small>{githubAuthError ?? (gist.tokenConfigured ? t("client.authorizationCredentialsAreStoredSecurelyInThisDsh") : t("client.getGistAccessThroughGithubDeviceAuthorization"))}{githubAuthError !== undefined && gist.lastErrorAt ? `（${new Date(gist.lastErrorAt).toLocaleString()}）` : ''}</small></span>
          <span className="dsh-ssh-github-auth-actions">
            <button type="button" className={gist.tokenConfigured ? 'dsh-ssh-secondary-button' : 'dsh-ssh-primary-button'} disabled={busy !== undefined || oauthFlow !== undefined || !gist.oauthClientId} onClick={() => { void connectGitHub() }}>{busy === 'oauth' ? t("client.connecting") : oauthFlow !== undefined ? t("client.waitingForAuthorization") : gist.tokenConfigured ? t("client.reconnect") : t("client.connectGithub")}</button>
            {gist.tokenConfigured && <button type="button" className="dsh-ssh-text-button" disabled={busy !== undefined} onClick={() => { void disconnectGitHub() }}>{busy === 'disconnect' ? t("client.disconnecting") : t("client.disconnect")}</button>}
          </span>
        </div>
        {!gist.oauthClientId && <p className="dsh-ssh-auth-hint">{t("client.onFirstUseEnterYourGithubOauthClientId")}</p>}
        <div className="dsh-ssh-gist-fields is-two">
          <Field label="Gist ID" hint={t("client.leaveEmptyToCreateAPrivateGistAutomaticallyOn")}><input maxLength={64} spellCheck={false} value={gist.gistId ?? ''} onChange={event => setGist(withGistId(gist, event.target.value))} placeholder={t("client.autoCreate")} /></Field>
          <Field label={t("client.syncEncryptionPassword")} hint={gist.encryptionConfigured ? t("client.savedSecurelyEnterTheSamePasswordOnANew") : t("client.atLeast6CharactersALongerPasswordIsRecommended")}><input type="password" minLength={6} maxLength={512} autoComplete="new-password" value={encryptionPassphrase} onChange={event => setEncryptionPassphrase(event.target.value)} placeholder={gist.encryptionConfigured ? t("client.configured") : t("client.setASeparateEncryptionPassword")} /></Field>
        </div>
        <div className="dsh-ssh-sync-meta" aria-label={t("client.syncVersionInfo")}><span><small>{t("client.cloudVersion")}</small><strong title={gist.cloudVersion}>{gist.cloudVersion ? gist.cloudVersion.slice(0, 10) : t("client.notReadYet")}</strong></span><span><small>{t("client.lastSync")}</small><strong>{gist.lastSyncAt ? formatRelativeTime(gist.lastSyncAt) : t("client.neverSynced")}</strong></span></div>
        <fieldset className="dsh-ssh-sync-strategy"><legend>{t("client.syncPolicy")}</legend><div role="group" aria-label={t("client.gistSyncPolicy")}>
          <SyncStrategyButton active={gist.strategy === 'smart'} title={t("client.smart")} description={t("client.detectChangesOnBothSidesAutomaticallyAndMergePer")} onClick={() => setGist({ ...gist, strategy: 'smart' })} />
          <SyncStrategyButton active={gist.strategy === 'local-first'} title={t("client.localFirst")} description={t("client.keepThisDeviceSConfigWhenBothSidesChanged")} onClick={() => setGist({ ...gist, strategy: 'local-first' })} />
          <SyncStrategyButton active={gist.strategy === 'cloud-first'} title={t("client.cloudFirst")} description={t("client.useTheGistConfigWhenBothSidesChanged")} onClick={() => setGist({ ...gist, strategy: 'cloud-first' })} />
        </div></fieldset>
        <div className="dsh-ssh-sync-options">
          <label className="dsh-ssh-switch-row"><span><strong>{t("client.autoSync")}</strong><small>{t("client.checksAfterStartupAfterConfigChangesAndEveryFive")}</small></span><input type="checkbox" checked={gist.autoSync} onChange={event => setGist({ ...gist, autoSync: event.target.checked })} /></label>
          <label className="dsh-ssh-number-row"><span><strong>{t("client.backupsToKeep")}</strong><small>{t("client.explicitHistorySnapshotsKeptInTheMainGistGithub")}</small></span><input type="number" min="0" max="50" step="1" value={gist.backupRetention} onChange={event => setGist({ ...gist, backupRetention: Number(event.target.value) })} /><em>{t("client.copies")}</em></label>
        </div>
        <button type="button" className="dsh-ssh-advanced-toggle" aria-expanded={advanced} onClick={() => setAdvanced(value => !value)}><span>{t("client.advancedAuthorizationSettings")}</span><IconChevronDownOutline14 /></button>
        {advanced && <div className="dsh-ssh-advanced-auth">
          <Field label="GitHub OAuth Client ID" hint={t("client.enableDeviceFlowInTheGithubOauthAppNo")}><input maxLength={128} spellCheck={false} value={gist.oauthClientId ?? ''} onChange={event => setGist(withOauthClientId(gist, event.target.value))} placeholder="Ov23li…" /></Field>
          <Field label={t("client.personalAccessTokenFallback")} hint={gist.tokenConfigured ? t("client.alreadyAuthorizedEnteringATokenReplacesTheCurrentAuthorization") : t("client.fillInOnlyWhenOauthIsUnavailableRequiresThe")}><input type="password" autoComplete="new-password" spellCheck={false} value={token} onChange={event => setToken(event.target.value)} placeholder="ghp_… / github_pat_…" /></Field>
          <p>{t("client.noOauthApp")}<a href="https://github.com/settings/applications/new" target="_blank" rel="noreferrer">{t("client.goToGithubToCreateOne")}</a>{t("client.thenEnableDeviceFlowInTheAppSettings")}</p>
        </div>}
        <p className="dsh-ssh-sync-scope"><strong>{t("client.syncedContent")}</strong>{t("client.hostsFtpFtpsPinnedProjectDirectoriesTheProxyVault")}<br /><strong>{t("client.keptLocalOnly")}</strong>{t("client.sessionGrantsPortForwardingPublicBindsAndCommandLimits")}</p>
        {gist.lastError && githubAuthError === undefined && <p className="dsh-ssh-inline-error" role="alert">{t("client.lastSyncFailed")}{gist.lastError}</p>}
        <div className="dsh-ssh-settings-actions">
          {gist.gistUrl && <a className="dsh-ssh-secondary-button" href={gist.gistUrl} target="_blank" rel="noreferrer">{t("client.openGist")}</a>}
          <button type="button" className="dsh-ssh-secondary-button" disabled={busy !== undefined} onClick={() => { void persistGist('test') }}>{busy === 'test' ? t("client.testing") : t("client.testConnection")}</button>
          <button type="button" className="dsh-ssh-secondary-button" disabled={busy !== undefined} onClick={() => { void persistGist('sync') }}>{busy === 'sync' ? t("client.syncing") : t("client.syncNow")}</button>
          <button type="button" className="dsh-ssh-primary-button" disabled={busy !== undefined} onClick={() => { void persistGist('save') }}>{busy === 'save' ? t("client.saving2") : t("client.saveSyncSettings")}</button>
        </div>
      </section>}
      {settings && <section className="dsh-ssh-settings-section" aria-labelledby="dsh-ssh-local-title"><div className="dsh-ssh-settings-section-heading"><span><strong id="dsh-ssh-local-title">{t("client.localRuntimeSettings")}</strong><small>{t("client.affectsThisDshInstanceOnlyNotSyncedViaGist")}</small></span></div><div className="dsh-ssh-settings-group">
        <Field label={t("client.githubOutboundProxy")} hint={t("client.usedOnlyForOauthAndTheGistApiE")}><div className="dsh-ssh-github-proxy-control"><input maxLength={2048} spellCheck={false} value={settings.githubProxy ?? ''} onChange={event => setSettings(withGitHubProxy(settings, event.target.value))} placeholder={t("client.connectToGithubDirectly")} /><button type="button" className="dsh-ssh-secondary-button" disabled={busy !== undefined} onClick={() => { void testGitHubNetwork() }}>{busy === 'network' ? t("client.testing") : t("client.testGithubNetwork")}</button></div></Field>
        <label className="dsh-ssh-switch-row"><span><strong>{t("client.allowPublicPortBinding")}</strong><small>{t("client.allowsForwardsToListenOn0000")}</small></span><input type="checkbox" checked={settings.allowPublicBind} onChange={event => { void save({ ...settings, allowPublicBind: event.target.checked }) }} /></label>
        <label className="dsh-ssh-number-row"><span><strong>{t("client.defaultCommandTimeout")}</strong><small>{t("client.maximumWaitTimeForTheAiSSshExec")}</small></span><input type="number" min="1000" max="300000" step="1000" value={settings.defaultCommandTimeoutMs} onChange={event => setSettings({ ...settings, defaultCommandTimeoutMs: Number(event.target.value) })} onBlur={() => { void save(settings) }} /><em>{t("client.ms")}</em></label>
        <label className="dsh-ssh-number-row"><span><strong>{t("client.maxCommandOutput")}</strong><small>{t("client.keepsTheNewestOutputBeyondThisLimitSoContext")}</small></span><input type="number" min="1000" max="1000000" step="1000" value={settings.maxOutputChars} onChange={event => setSettings({ ...settings, maxOutputChars: Number(event.target.value) })} onBlur={() => { void save(settings) }} /><em>{t("client.chars")}</em></label>
      </div></section>}
    </div>
    {oauthFlow && <GitHubDeviceAuthorizationDialog flow={oauthFlow} onClose={() => setOauthFlow(undefined)} />}
    {notice && <p className="dsh-ssh-inline-success" role="status">{notice}</p>}{error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
  </div>
}

function GitHubDeviceAuthorizationDialog({ flow, onClose }: { flow: GitHubDeviceFlowStart; onClose(): void }): JSX.Element {
  const sshLocale = useSshLocale()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copyCode = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(flow.userCode)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }
  return <Dialog title={t("client.connectGithub")} subtitle={t("client.copyTheDeviceCodeThenGoToGithubTo")} className="dsh-ssh-device-auth-dialog" onClose={onClose}>
    <div className="dsh-ssh-device-auth-content">
      <div className="dsh-ssh-device-code-block">
        <span><small>{t("client.oneTimeDeviceCode")}</small><code>{flow.userCode}</code></span>
        <button type="button" className="dsh-ssh-secondary-button" onClick={() => { void copyCode() }}>{copyState === 'copied' ? t("client.copied") : t("client.copyCode")}</button>
      </div>
      <ol className="dsh-ssh-device-auth-steps">
        <li><span>1</span><p><strong>{t("client.copyTheCodeAbove")}</strong><small>{t("client.theDeviceCodeIsUsedForThisAuthorizationOnly")}</small></p></li>
        <li><span>2</span><p><strong>{t("client.openTheGithubAuthorizationPage")}</strong><small>{t("client.pasteTheCodeAndConfirmAuthorizationForTheCurrent")}</small></p></li>
        <li><span>3</span><p><strong>{t("client.backToDsh")}</strong><small>{t("client.theConnectionCompletesAutomaticallyOnceAuthorized")}</small></p></li>
      </ol>
      {copyState === 'failed' && <p className="dsh-ssh-inline-error" role="alert">{t("client.theBrowserBlockedAutomaticCopyingSelectTheDeviceCode")}</p>}
      <p className="dsh-ssh-device-auth-expiry">{t("client.deviceCodeExpiry", [new Date(flow.expiresAt).toLocaleTimeString(sshLocale)])}</p>
      <div className="dsh-ssh-dialog-actions">
        <button type="button" className="dsh-ssh-secondary-button" data-ssh-dialog-close onClick={onClose}>{t("client.later")}</button>
        <a className="dsh-ssh-primary-button" href={flow.verificationUri} target="_blank" rel="noreferrer">{t("client.goToGithubToAuthorize")}</a>
      </div>
    </div>
  </Dialog>
}

function SyncStrategyButton({ active, title, description, onClick }: { active: boolean; title: string; description: string; onClick(): void }): JSX.Element {
  return <button type="button" className={active ? 'is-active' : ''} aria-pressed={active} onClick={onClick}><strong>{title}</strong><small>{description}</small></button>
}

function withGistId(view: GistSyncView, value: string): GistSyncView {
  const trimmed = value.trim()
  if (trimmed) return { ...view, gistId: trimmed }
  const { gistId: _gistId, gistUrl: _gistUrl, ...rest } = view
  return rest
}

function withOauthClientId(view: GistSyncView, value: string): GistSyncView {
  const trimmed = value.trim()
  if (trimmed) return { ...view, oauthClientId: trimmed, oauthAvailable: true }
  const { oauthClientId: _oauthClientId, ...rest } = view
  return { ...rest, oauthAvailable: false }
}

function withGitHubProxy(view: SettingsView, value: string): SettingsView {
  if (value !== '') return { ...view, githubProxy: value }
  const { githubProxy: _githubProxy, ...rest } = view
  return rest
}

function SyncStatus({ view }: { view: GistSyncView }): JSX.Element {
  useSshLocale()
  const ready = view.tokenConfigured && view.encryptionConfigured
  const label = view.running ? t("client.syncing2") : view.lastError ? t("client.actionNeeded") : view.lastSyncAt === undefined ? ready ? t("client.waitingForFirstSync") : t("client.notConfigured") : t("client.lastSynced", [formatRelativeTime(view.lastSyncAt)])
  return <span className={`dsh-ssh-sync-status${view.running ? ' is-running' : view.lastError ? ' is-error' : ready ? ' is-ready' : ''}`} role="status"><i aria-hidden="true" />{label}</span>
}

function syncResultLabel(result: GistSyncView['lastResult']): string {
  return result === 'uploaded' ? t("client.localConfigUploaded") : result === 'downloaded' ? t("client.cloudConfigApplied") : result === 'merged' ? t("client.configsFromBothSidesMergedIntelligently") : t("client.configIsAlreadyUpToDate")
}

function formatRelativeTime(value: number): string {
  const elapsed = Math.max(0, Date.now() - value)
  if (elapsed < 60_000) return t("client.justNow")
  if (elapsed < 3_600_000) return t("client.minutesAgo", [Math.floor(elapsed / 60_000)])
  if (elapsed < 86_400_000) return t("client.hoursAgo", [Math.floor(elapsed / 3_600_000)])
  return new Date(value).toLocaleString()
}

function ForwardEditor({ profile, value, onClose, onSaved }: { profile: ProfileView; profiles: ProfileView[]; value?: ForwardView | undefined; onClose(): void; onSaved(): void }): JSX.Element {
  useSshLocale()
  const [form, setForm] = useState({ name: value?.name ?? '', kind: value?.kind ?? 'local', bindHost: value?.bindHost ?? '127.0.0.1', bindPort: String(value?.bindPort ?? 0), targetHost: value?.targetHost ?? '127.0.0.1', targetPort: String(value?.targetPort ?? 80), autoStart: value?.autoStart ?? false })
  const [error, setError] = useState<string>()
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    try {
      await api(value === undefined ? '/forwards' : `/forwards/${value.id}`, { method: value === undefined ? 'POST' : 'PUT', body: JSON.stringify({ rule: { profileId: profile.id, name: form.name, kind: form.kind, bindHost: form.bindHost, bindPort: Number(form.bindPort), ...(form.kind === 'dynamic' ? {} : { targetHost: form.targetHost, targetPort: Number(form.targetPort) }), autoStart: form.autoStart } }) })
      onSaved()
    } catch (reason) { setError(message(reason)) }
  }
  return <Dialog title={value === undefined ? t("client.newPortForward") : t("client.edit2", [value.name])} subtitle={profile.name} onClose={onClose}><form className="dsh-ssh-form" onSubmit={event => { void submit(event) }}>
    <Field label={t("client.name")}><input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></Field>
    <Field label={t("client.type")}><select value={form.kind} onChange={event => setForm({ ...form, kind: event.target.value as typeof form.kind })}><option value="local">{t("client.localForwardL")}</option><option value="remote">{t("client.remoteForwardR")}</option><option value="dynamic">{t("client.dynamicSocks5D")}</option></select></Field>
    <div className="dsh-ssh-form-grid is-host"><Field label={t("client.listenAddress")}><input required value={form.bindHost} onChange={event => setForm({ ...form, bindHost: event.target.value })} /></Field><Field label={t("client.listenPort")} hint={t("client.automaticPortHint")}><input required type="number" min="0" max="65535" value={form.bindPort} onChange={event => setForm({ ...form, bindPort: event.target.value })} /></Field></div>
    {form.kind !== 'dynamic' && <div className="dsh-ssh-form-grid is-host"><Field label={t("client.targetHost")}><input required value={form.targetHost} onChange={event => setForm({ ...form, targetHost: event.target.value })} /></Field><Field label={t("client.targetPort")}><input required type="number" min="1" max="65535" value={form.targetPort} onChange={event => setForm({ ...form, targetPort: event.target.value })} /></Field></div>}
    <label className="dsh-ssh-switch-row"><span><strong>{t("client.autoStart")}</strong><small>{t("client.restoreThisForwardWhenDshStarts")}</small></span><input type="checkbox" checked={form.autoStart} onChange={event => setForm({ ...form, autoStart: event.target.checked })} /></label>
    {error && <p className="dsh-ssh-inline-error">{error}</p>}<div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" data-ssh-dialog-close onClick={onClose}>{t("client.cancel")}</button><button className="dsh-ssh-primary-button">{t("client.saveRule")}</button></div>
  </form></Dialog>
}

function proxyLabel(profile: ProfileView): string { return profile.proxy.type === 'none' ? t("client.direct") : profile.proxy.type === 'saved' ? t("client.commonProxies") : profile.proxy.type === 'jump' ? t("client.sshJumpHost") : profile.proxy.type === 'http' ? t("client.httpProxy") : t("client.socks5Proxy") }
const message = errorMessage
function parseTerminalOpenedEvent(raw: Event): TerminalOpenedEvent | undefined {
  if (!(raw instanceof MessageEvent) || typeof raw.data !== 'string') return undefined
  try {
    const value = JSON.parse(raw.data) as Partial<TerminalOpenedEvent>
    if (
      value.type !== 'terminal-opened' ||
      typeof value.sessionId !== 'string' ||
      typeof value.terminalId !== 'string' ||
      typeof value.profileId !== 'string' ||
      typeof value.createdAt !== 'number'
    ) return undefined
    return value as TerminalOpenedEvent
  } catch { return undefined }
}
function forwardSummary(rule: ForwardView, status?: ForwardStatus): string {
  const bind = `${rule.bindHost}:${status?.bindPort ?? rule.bindPort}`
  return rule.kind === 'dynamic' ? `${bind} → SOCKS5` : `${bind} → ${rule.targetHost}:${rule.targetPort}`
}
function forwardState(status?: ForwardStatus): string { return status?.state === 'running' ? t("client.running", [status.connections]) : status?.state === 'starting' ? t("client.starting") : status?.state === 'error' ? t("client.failed") : t("client.stopped") }

function installStyles(): () => void {
  const text = `${xtermCss}\n${adaptiveUiCss}\n${borderGlowCss}\n${cssText}\n${remoteWorkspaceCss}\n${hostWorkbenchCss}\n${workbenchPagesCss}\n${fileTransferCss}\n${interactiveSurfacesCss}\n${activitySurfaceCss}\n${dialogCss}`
  document.getElementById(STYLE_ID)?.remove()
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = text
  document.head.append(style)
  return () => {
    if (document.getElementById(STYLE_ID) === style) style.remove()
  }
}
