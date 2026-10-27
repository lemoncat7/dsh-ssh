import { useSshLocale } from './use-ssh-locale.js'
import { canSubscribeActivity, currentSession } from './current-session.js'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
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
import { AdaptiveWorkspace, WorkspaceNavigationTrigger } from './adaptive-workspace.js'
import { useResponsiveSftp } from './use-responsive-sftp.js'
import adaptiveUiCss from './adaptive-workspace.css'
import borderGlowCss from './border-glow.css'
import { useBorderGlowSurface } from './border-glow.js'
import interactiveSurfacesCss from './interactive-surfaces.css'
import activitySurfaceCss from './activity-surface.css'
import { activatePluginWorkspace, observePluginWorkspace } from './workspace-ownership.js'
import {
  IconChevronDownOutlineRegular as IconChevronDownOutline14, IconCloseOutlineRegular as IconCloseOutline16, IconDataOutlineRegular as IconDataOutline16,
  IconEditOutlineRegular as IconEditOutline16, IconPanelLeftOutlineRegular as IconPanelLeftOutline16, IconPlusOutlineRegular as IconPlusOutline16,
  IconStopFillRegular as IconStopFill16, IconTrashOutlineRegular as IconTrashOutline16, IconChevronLeftOutlineRegular as IconChevronLeftOutline14,
  IconUserOutlineRegular as IconUserOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import xtermCss from '@xterm/xterm/css/xterm.css'
import cssText from './client.css'
import dialogCss from './dialog.css'
import interactionThemeCss from './interaction-theme.css'
import controlSurfacesCss from './control-surfaces.css'
import remoteWorkspaceCss from './remote-workspace-tree.css'
import hostWorkbenchCss from './host-workbench.css'
import {
  activityEventStreamUrl, api, loadForwards, loadFtpProfiles, loadInjection, loadProfiles, loadProxyEntries, loadVaultEntries, moveProfileToGroup,
  profileAddress,
  type ForwardStatus, type ForwardView, type FtpProfileView,
  saveSessionAccess, type InjectionView, type ProfileView, type ProxyEntryView, type RemoteProjectView, type SettingsView, type TerminalOpenedEvent, type VaultEntryView,
} from './client-api.js'
import { useWorkspaceTopAnchor } from './sidebar-anchor.js'
import { ProfileSftpPane } from './sftp-client.js'
import { TerminalWorkspace } from './terminal-workspace.js'
import { refreshWorkspace, useWorkspaceRefresh } from './use-workspace-refresh.js'
import { GroupProxyEditor } from './group-proxy-editor.js'
import type { GroupProxy } from './domain.js'
import { ConfigBackupPanel } from './config-backup-panel.js'
import { SyncPane } from './sync-panel.js'
import syncCss from './sync-panel.css'
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

export const inject = ['slots', 'layout', 'sessions', 'workspaces', 'uiWorkspace']

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
      if (dispose === undefined || profileId !== undefined) selected = profileId
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
      ctx.uiWorkspace.openSession(sessionId)
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
  let currentSessionId = normalizeSessionId(currentSession(runtime.sessions.list.getSnapshot()))
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
      <SshActivityPanel key={String(props.sessionId)} {...props} controller={controller} />
    ))
    if (openDetails) ctx.layout.openDetails()
  }
  const syncCurrentSession = (): void => {
    const snapshot = runtime.sessions.list.getSnapshot()
    const nextSessionId = normalizeSessionId(currentSession(snapshot))
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
      const previous = states.get(sessionId)
      const nextView = view ?? (profileId === undefined ? previous?.requestedView ?? 'local-directory' : 'remote-directory')
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
    props => <SshActivityPanel key={String(props.sessionId)} {...props} controller={controller} />, notify)
  const controller: ActivityController = {
    open(sessionId, profileId, view) {
      states.set(sessionId, { profileId: profileId ?? states.get(sessionId)?.profileId,
        view: view ?? (profileId === undefined ? states.get(sessionId)?.view ?? 'local-directory' : 'remote-directory') })
      panel.open(sessionId)
    },
    toggle(sessionId) { if (panel.isOpen(sessionId)) controller.close(sessionId); else controller.open(sessionId) },
    close(sessionId) {
      const target = sessionId ?? normalizeSessionId(currentSession((ctx.sessions as unknown as ISessions).list.getSnapshot()))
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
  const sessionId = props.useSessions((state: SessionListState) => currentSession(state))
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
  useEffect(() => {
    let disposed = false
    // Independent reads must not waterfall; a previous session must not win
    // a race and overwrite the current session's mount information.
    void Promise.all([
      loadProfiles().catch(() => []),
      sessionId === undefined ? Promise.resolve(null) : loadInjection(String(sessionId)).catch(() => null),
    ]).then(([next, access]) => { if (!disposed) { setProfiles(next); setInjection(access) } })
    return () => { disposed = true }
  }, [sessionId, remoteOpen])
  const availableProfiles = injection === null || injection.sessionId !== currentSessionId ? [] : injection.profileIds.map(profileId => profiles.find(profile => profile.id === profileId)).filter((profile): profile is ProfileView => profile !== undefined)
  useEffect(() => {
    if (currentSessionId === undefined || !canSubscribeActivity(currentSessionId, injection)) return
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
  }, [currentSessionId, injection?.sessionId, injection?.permission, props.activityController, props.controller])
  const openActivity = (profileId?: string): void => {
    if (currentSessionId === undefined) return
    props.controller.close()
    props.activityController.open(currentSessionId, profileId, profileId === undefined ? 'local-directory' : 'remote-directory')
  }
  const toggleActivity = (): void => {
    if (currentSessionId === undefined) return
    if (activityOpen) props.activityController.close(currentSessionId)
    else { props.controller.close(); props.activityController.open(currentSessionId) }
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
  const sessionId = props.useSessions((state: SessionListState) => currentSession(state))
  const workspaceList = props.useWorkspaces((state: WorkspaceSnapshot) => state)
  const [profiles, setProfiles] = useState<ProfileView[]>([])
  const [vaultEntries, setVaultEntries] = useState<VaultEntryView[]>([])
  const [proxyEntries, setProxyEntries] = useState<ProxyEntryView[]>([])
  const [groupProxies, setGroupProxies] = useState<GroupProxy[]>([])
  const [editingGroup, setEditingGroup] = useState<string | null>(null)
  const [ftpProfiles, setFtpProfiles] = useState<FtpProfileView[]>([])
  const [target, setTarget] = useState<RemoteTarget | null>(() => props.controller.selected() === undefined ? null : { profileId: props.controller.selected()!, path: '~' })
  const [view, setView] = useState<'workspace' | 'transfer' | 'forwards' | 'vault' | 'proxies' | 'settings' | 'sync' | 'commands'>('workspace')
  const [syncMounted, setSyncMounted] = useState(false)
  const [transferMounted, setTransferMounted] = useState(false)
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
  const initialHostChosen = useRef(props.controller.selected() !== undefined)
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
      setTarget(current => current !== null && next.some(item => item.id === current.profileId) ? current : null)
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
    if (initialHostChosen.current || access.loading || profiles.length === 0) return
    const mounted = profiles.find(profile => access.value?.profileIds.includes(profile.id)) ?? profiles[0]
    if (mounted) setTarget({ profileId: mounted.id, path: access.value?.workingDirectories[mounted.id] ?? '~' })
    initialHostChosen.current = true
  }, [access.loading, access.value, profiles])
  useEffect(() => {
    if (view === 'workspace' && selected) setVisitedHosts(current => current.includes(selected.id) ? current : [...current, selected.id])
  }, [view, selected?.id])
  const currentWorkspaceId = workspaceList.items.find((item: WorkspaceView) => sessionId !== undefined && item.sessionIds.includes(sessionId))?.workspaceId
  const toolbar = <header ref={toolbarGlow.ref} onPointerMove={toolbarGlow.onPointerMove} onPointerLeave={toolbarGlow.onPointerLeave} className="dsh-ssh-toolbar dsh-ssh-border-surface">
      <div className="dsh-ssh-brand"><button type="button" className="dsh-ssh-icon-button" aria-label={t("client.backToSession")} title={t("client.backToSession")} onClick={() => props.controller.close()}><IconChevronLeftOutline14 size={15} /></button><span className="dsh-ssh-brand-glyph"><ServerGlyph /></span><span><strong>{t("client.sshWorkbench")}</strong><small>{view === 'transfer' ? 'FTP · FTPS · SFTP' : selected === undefined ? t("client.selectAHost") : `${selected.username}@${selected.host}`}</small></span></div>
      <nav className="dsh-ssh-segments" role="tablist" aria-label={t("client.sshWorkbenchView")}>
        <Segment active={view === 'workspace'} onClick={() => setView('workspace')}>{t("client.terminalsFiles")}</Segment>
        <Segment active={view === 'transfer'} onClick={() => { setTransferMounted(true); setView('transfer') }}>{t("client.fileTransfer")}</Segment>
        <Segment active={view === 'commands'} onClick={() => setView('commands')}>{t("client.savedCommands")}</Segment>
        <Segment active={view === 'forwards'} onClick={() => setView('forwards')}>{t("client.portForwarding")}</Segment>
        <Segment active={view === 'vault'} onClick={() => setView('vault')}>{t("client.credentialVault")}</Segment>
        <Segment active={view === 'proxies'} onClick={() => setView('proxies')}>{t("client.proxyVault")}</Segment>
        <Segment active={view === 'sync'} onClick={() => { setSyncMounted(true); setView('sync') }}>{t("sync.title")}</Segment>
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
      inlineNavigation={view === 'workspace' && selected !== undefined}
      navigationIcon={<IconDataOutline16 size={15} />}
      navigation={controls => <RemoteWorkspaceTree
        profiles={profiles}
        groupConfigs={groupProxies}
        onGroupProxy={setEditingGroup}
        access={access.value}
        accessLoading={access.loading}
        accessSaving={access.saving}
        accessError={access.error}
        workspaces={workspaceList.items}
        currentWorkspaceId={currentWorkspaceId === undefined ? undefined : String(currentWorkspaceId)}
        recentWorkspaceId={workspaceList.recentWorkspaceId === undefined ? undefined : String(workspaceList.recentWorkspaceId)}
        selected={target}
        onSelect={next => { initialHostChosen.current = true; setTarget(next); setView('workspace'); props.controller.open(next.profileId); controls.closePanel() }}
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
          const defaults = await api<{ permission: 'exec' | 'terminal'; requireCommandApproval: boolean }>('/session-defaults')
          await props.controller.createProjectSession(workspaceId, project, defaults.permission, defaults.requireCommandApproval)
          props.controller.close()
        }}
        onNewProfile={() => { setEditing('new'); controls.closePanel() }}
        onNewGroup={() => setEditingGroup('')}
        onEditProfile={profile => { setEditing(profile); controls.closePanel() }}
        onMoveProfile={async (profile, group) => { await moveProfileToGroup(profile.id, group); await refresh() }}
      />}
    >
      <section className="dsh-ssh-main-panel dsh-ssh-scroll-surface">
        {profiles.filter(profile => visitedHosts.includes(profile.id)).map(profile => <div className="dsh-ssh-host-page" key={profile.id} hidden={view !== 'workspace' || selected?.id !== profile.id}><HostWorkbench profile={profile} initialPath={target?.profileId === profile.id ? target.path : '~'} active={view === 'workspace' && selected?.id === profile.id} onDelete={() => setDeleting(profile)} closeAllRequest={closeAllRequest} totalTerminals={totalTerminals} onCloseAll={() => setClosingAllTerminals(true)} reportTerminalCount={reportTerminalCount} /></div>)}
        {view === 'workspace' ? (selected === undefined ? <EmptyState /> : null) : view === 'transfer' ? null : view === 'commands' ? <CommandsPanel />
          : view === 'vault' ? <VaultPane entries={vaultEntries} onChanged={() => setRefreshKey(value => value + 1)} />
          : view === 'proxies' ? <ProxyPane entries={proxyEntries} onChanged={() => setRefreshKey(value => value + 1)} />
          : view === 'sync' ? null
          : view === 'settings' ? <SettingsPane />
          : selected === undefined ? <EmptyState />
          : <ForwardPane profiles={profiles} selected={selected} />}
        {syncMounted && <div className="dsh-ssh-persistent-page" hidden={view !== 'sync'}><SyncPane active={view === 'sync'} /></div>}
        {transferMounted && <div className="dsh-ssh-persistent-page" hidden={view !== 'transfer'}><FileTransferWorkspace ftpProfiles={ftpProfiles} vaultEntries={vaultEntries} proxyEntries={proxyEntries} access={access} onProfilesChanged={() => setRefreshKey(value => value + 1)} /></div>}
      </section>
    </AdaptiveWorkspace>
{closingAllTerminals && <Dialog variant="confirmation" title={t("client.closeTerminalsOnAllHosts")} subtitle={t("client.thisClosesAllTerminalTabsInThisWorkspaceIncluding", [totalTerminals])} onClose={() => setClosingAllTerminals(false)}><div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" onClick={() => setClosingAllTerminals(false)}>{t("client.cancel")}</button><button type="button" className="dsh-ssh-danger-button" onClick={() => { setCloseAllRequest(value => value + 1); setClosingAllTerminals(false) }}>{t("client.closeAll")}</button></div></Dialog>}
    {editingGroup !== null && <GroupProxyEditor key={editingGroup || 'new-group'} name={editingGroup || undefined} value={groupProxies.find(group => group.name === editingGroup)} proxies={proxyEntries} onClose={() => setEditingGroup(null)} onSaved={() => { setEditingGroup(null); setRefreshKey(value => value + 1) }} />}
    {editing !== undefined && <ProfileEditor profile={editing === 'new' ? undefined : editing} profiles={profiles} groups={groupProxies.map(group => group.name)} vaultEntries={vaultEntries} proxyEntries={proxyEntries} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); setRefreshKey(value => value + 1) }} />}
    {deleting !== undefined && <ProfileDeleteDialog profile={deleting} dependents={profiles.filter(profile => profile.id !== deleting.id && profile.proxy.type === 'jump' && profile.proxy.profileIds.includes(deleting.id))} onClose={() => setDeleting(undefined)} onDeleted={() => { setDeleting(undefined); setEditing(undefined); setRefreshKey(value => value + 1) }} />}
  </>
}

function HostWorkbench({ profile, initialPath, active, onDelete, closeAllRequest, totalTerminals, onCloseAll, reportTerminalCount }: { profile: ProfileView; initialPath: string; active: boolean; onDelete(): void; closeAllRequest: number; totalTerminals: number; onCloseAll(): void; reportTerminalCount(id: string, count: number): void }): JSX.Element {
  useSshLocale()
  const [sftpReady, setSftpReady] = useState(false)
  const { ref: workbenchRef, hidden: sftpHidden, setHidden: setSftpHidden } = useResponsiveSftp(active)
  const [terminalPath, setTerminalPath] = useState<string>()
  const onTerminalCount = useCallback((count: number) => reportTerminalCount(profile.id, count), [profile.id, reportTerminalCount])
  const headingGlow = useBorderGlowSurface<HTMLElement>()
  return <div ref={workbenchRef} className="dsh-ssh-host-workbench">
    <header ref={headingGlow.ref} onPointerMove={headingGlow.onPointerMove} onPointerLeave={headingGlow.onPointerLeave} className="dsh-ssh-workbench-heading dsh-ssh-border-surface">
      <div><WorkspaceNavigationTrigger /><span className="dsh-ssh-host-monogram">{profile.name.slice(0, 1).toUpperCase()}</span><span><h1>{profile.name}</h1><p>{profileAddress(profile)} · {proxyLabel(profile)}</p></span></div>
      <div className="dsh-ssh-heading-actions dsh-ssh-host-actions" role="group" aria-label={t("client.hostActions")}>
        <button type="button" className="dsh-ssh-secondary-button" disabled={totalTerminals === 0} aria-label={t("client.closeAllTerminals")} title={t("client.closeTerminalsOnAllHosts2")} onClick={onCloseAll}><IconStopFill16 size={16} />{t("client.closeAllTerminals")}</button>
        <span className="dsh-ssh-host-action-divider" aria-hidden="true" />
        <button type="button" className="dsh-ssh-secondary-button" aria-label={sftpHidden ? t("client.showSftp") : t("client.hideSftp")} title={sftpHidden ? t("client.showSftp") : t("client.hideSftp")} aria-expanded={!sftpHidden} onClick={() => setSftpHidden(value => !value)}><IconDataOutline16 size={16} />{sftpHidden ? t("client.showSftp") : t("client.hideSftp")}</button>
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
  const [error, setError] = useState<string>()
  useEffect(() => { void api<SettingsView>('/settings').then(setSettings).catch(reason => setError(message(reason))) }, [])
  const save = async (next: SettingsView): Promise<void> => {
    try { setSettings(await api('/settings', { method: 'PUT', body: JSON.stringify(next) })); setError(undefined) }
    catch (reason) { setError(message(reason)) }
  }
  return <div className="dsh-ssh-settings-pane"><div className="dsh-ssh-content-heading"><div><h1>{t("client.sshSettings")}</h1><p>{t("sync.localSettingsHint")}</p></div></div>
    <div className="dsh-ssh-settings-stack">
      <ConfigBackupPanel />
      {settings && <section className="dsh-ssh-settings-section" aria-labelledby="dsh-ssh-local-title"><div className="dsh-ssh-settings-section-heading"><span><strong id="dsh-ssh-local-title">{t("client.localRuntimeSettings")}</strong><small>{t("client.affectsThisDshInstanceOnlyNotSyncedViaGist")}</small></span></div><div className="dsh-ssh-settings-group">
        <label className="dsh-ssh-switch-row"><span><strong>{t("client.allowPublicPortBinding")}</strong><small>{t("client.allowsForwardsToListenOn0000")}</small></span><input type="checkbox" checked={settings.allowPublicBind} onChange={event => { void save({ ...settings, allowPublicBind: event.target.checked }) }} /></label>
        <label className="dsh-ssh-number-row"><span><strong>{t("client.defaultCommandTimeout")}</strong><small>{t("client.maximumWaitTimeForTheAiSSshExec")}</small></span><input type="number" min="1000" max="300000" step="1000" value={settings.defaultCommandTimeoutMs} onChange={event => setSettings({ ...settings, defaultCommandTimeoutMs: Number(event.target.value) })} onBlur={() => { void save(settings) }} /><em>{t("client.ms")}</em></label>
        <label className="dsh-ssh-number-row"><span><strong>{t("client.maxCommandOutput")}</strong><small>{t("client.keepsTheNewestOutputBeyondThisLimitSoContext")}</small></span><input type="number" min="1000" max="1000000" step="1000" value={settings.maxOutputChars} onChange={event => setSettings({ ...settings, maxOutputChars: Number(event.target.value) })} onBlur={() => { void save(settings) }} /><em>{t("client.chars")}</em></label>
      </div></section>}
    </div>{error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
  </div>
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
  const text = `${xtermCss}\n${adaptiveUiCss}\n${borderGlowCss}\n${cssText}\n${remoteWorkspaceCss}\n${hostWorkbenchCss}\n${workbenchPagesCss}\n${fileTransferCss}\n${interactiveSurfacesCss}\n${activitySurfaceCss}\n${dialogCss}\n${interactionThemeCss}\n${controlSurfacesCss}\n${syncCss}`
  document.getElementById(STYLE_ID)?.remove()
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = text
  document.head.append(style)
  return () => {
    if (document.getElementById(STYLE_ID) === style) style.remove()
  }
}
