import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ISessions, IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
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
import glareHoverCss from './glare-hover.css'
import interactiveSurfacesCss from './interactive-surfaces.css'
import { activatePluginWorkspace, observePluginWorkspace } from './workspace-ownership.js'
import {
  IconChevronDownOutline14, IconCloseOutline16, IconDataOutline16,
  IconEditOutline16, IconPanelLeftOutline16, IconPlusOutline16,
  IconStopFill16, IconTrashOutline16, IconChevronLeftOutline14,
  IconUserOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import xtermCss from '@xterm/xterm/css/xterm.css'
import cssText from './client.css'
import remoteWorkspaceCss from './remote-workspace-tree.css'
import hostWorkbenchCss from './host-workbench.css'
import {
  activityEventStreamUrl, api, browserTerminalStreamUrl, loadForwards, loadFtpProfiles, loadInjection, loadProfiles, loadProxyEntries, loadVaultEntries,
  profileAddress,
  type ForwardStatus, type ForwardView, type FtpProfileView, type GistSyncView, type GitHubDeviceFlowStart, type GitHubDeviceFlowStatus,
  saveSessionAccess, type InjectionView, type ProfileView, type ProxyEntryView, type RemoteProjectView, type SettingsView, type TerminalOpenedEvent, type VaultEntryView,
} from './client-api.js'
import { useWorkspaceTopAnchor } from './sidebar-anchor.js'
import { ProfileSftpPane } from './sftp-client.js'
import { TerminalTransport } from './terminal-transport.js'
import { attachTerminalViewport, createSshTerminal } from './terminal-view.js'
import { RemoteWorkspaceTree, type RemoteTarget } from './remote-workspace-tree.js'
import { emptyAccess, useSessionAccess } from './session-access.js'
import { subscribeSessionAccess } from './session-access-channel.js'
import { ResizableSplit } from './resizable-split.js'
import { Dialog, EmptyState, Field, PasswordInput, Segment, ServerGlyph, errorMessage } from './ui-components.js'
import { ProfileDeleteDialog, ProfileEditor } from './profile-editor.js'
import { FileTransferWorkspace } from './file-transfer-workspace.js'
import fileTransferCss from './file-transfer-workspace.css'

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
  ctx.effect(installStyles, 'dsh-ssh: styles')
  const activityController = createActivityController(ctx)
  const controller = createController(ctx, () => activityController.close())
  ctx.effect(() => observePluginWorkspace(PLUGIN_ID, () => { controller.close(); activityController.close() }), 'dsh-ssh: exclusive workspace')
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
        dispose = ctx.slots.register({ name: 'conversation', priority: -2 }, props => (
          <RemoteWorkspace {...props} controller={controller} />
        ))
      }
      notify()
    },
    toggle() { if (dispose === undefined) controller.open(); else controller.close() },
    close() { if (dispose === undefined) return; const current = dispose; dispose = undefined; current(); notify() },
    isOpen: () => dispose !== undefined,
    selected: () => selected,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    async createProjectSession(workspaceId, project, permission, requireCommandApproval) {
      const sessionId = await runtime.workspaces.connectWorkspace(workspaceId as never)
      await saveSessionAccess({ ...emptyAccess(String(sessionId)), profileIds: [project.profileId], permission, requireCommandApproval, workingDirectories: { [project.profileId]: project.path }, workingProjectIds: { [project.profileId]: project.id } })
      runtime.sessions.open(sessionId)
      return String(sessionId)
    },
  }
  return controller
}

function createActivityController(ctx: ClientContext): ActivityController {
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

function RemoteSidebar(props: SidebarActionProps & { controller: RemoteController; activityController: ActivityController; collapseSidebar(): void }): JSX.Element {
  const ref = useRef<HTMLElement>(null)
  useWorkspaceTopAnchor(ref)
  const sessionId = props.useSessions(state => state.current)
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
      <button type="button" data-ssh-interactive="choice" className={`dsh-ssh-rail-button${activityOpen ? ' is-active' : ''}`} title={currentSessionId === undefined ? "Open a session to see the SSH sidebar" : activityOpen ? "Collapse SSH sidebar" : "Expand SSH sidebar"} aria-label={activityOpen ? "Collapse SSH sidebar" : "Expand SSH sidebar"} aria-pressed={activityOpen} disabled={currentSessionId === undefined} onClick={toggleActivity}><ServerGlyph /></button>
    </section>
  }
  return <section ref={ref} className="dsh-ssh-sidebar">
    <div className="dsh-ssh-sidebar-heading">
      <button type="button" className="dsh-ssh-sidebar-title" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span className="dsh-ssh-disclosure" data-open={open}><IconChevronDownOutline14 size={14} /></span><span>Remote</span>
      </button>
      <button type="button" data-ssh-interactive="choice" className={`dsh-ssh-icon-button${activityOpen ? ' is-active' : ''}`} aria-label={activityOpen ? "Collapse SSH sidebar" : "Expand SSH sidebar"} title={currentSessionId === undefined ? "Open a session to see the SSH sidebar" : activityOpen ? "Collapse SSH sidebar" : "Expand SSH sidebar"} aria-pressed={activityOpen} disabled={currentSessionId === undefined} onClick={toggleActivity}><IconPanelLeftOutline16 size={16} className="dsh-ssh-panel-right-icon" /></button>
    </div>
    {open && <div className="dsh-ssh-sidebar-list">
      <button type="button" className="dsh-ssh-sidebar-panel" onClick={openWorkspace}><ServerGlyph /><span>SSH panel</span></button>
      {currentSessionId === undefined ? <p className="dsh-ssh-sidebar-note">Available remotes appear once a session is open</p>
        : availableProfiles.length === 0 ? <p className="dsh-ssh-sidebar-note">No remotes granted to this session</p>
          : availableProfiles.slice(0, 6).map(profile => <button type="button" data-ssh-interactive="choice" aria-pressed={activityOpen && props.activityController.selected(currentSessionId) === profile.id} className={`dsh-ssh-sidebar-row${activityOpen && props.activityController.selected(currentSessionId) === profile.id ? ' is-active' : ''}`} key={profile.id} onClick={() => openActivity(profile.id)}>
            <span className="dsh-ssh-status-dot is-injected" aria-hidden="true" />
            <span className="dsh-ssh-sidebar-copy"><strong>{profile.name}</strong><small>{profile.host}</small></span>
            <span className="dsh-ssh-injected-mark">Mounted</span>
          </button>)}
      {availableProfiles.length > 6 && <button type="button" className="dsh-ssh-sidebar-more" onClick={toggleActivity}>Plus {availableProfiles.length - 6} remotes available</button>}
    </div>}
  </section>
}

function RemoteWorkspace(props: ConversationProps & { controller: RemoteController }): JSX.Element {
  const toolbarGlow = useBorderGlowSurface<HTMLElement>()
  const sessionId = props.useSessions(state => state.current)
  const workspaceList = props.useWorkspaces(state => state)
  const [profiles, setProfiles] = useState<ProfileView[]>([])
  const [vaultEntries, setVaultEntries] = useState<VaultEntryView[]>([])
  const [proxyEntries, setProxyEntries] = useState<ProxyEntryView[]>([])
  const [ftpProfiles, setFtpProfiles] = useState<FtpProfileView[]>([])
  const [target, setTarget] = useState<RemoteTarget | null>(() => props.controller.selected() === undefined ? null : { profileId: props.controller.selected()!, path: '~' })
  const [view, setView] = useState<'workspace' | 'transfer' | 'forwards' | 'vault' | 'proxies' | 'settings'>('workspace')
  const [editing, setEditing] = useState<ProfileView | 'new'>()
  const [deleting, setDeleting] = useState<ProfileView>()
  const [refreshKey, setRefreshKey] = useState(0)
  const [error, setError] = useState<string>()
  const access = useSessionAccess(sessionId === undefined ? undefined : String(sessionId))
  const openedSessionRef = useRef(sessionId)
  const refresh = useCallback(async () => {
    try {
      const [next, ftp, credentials, proxies] = await Promise.all([loadProfiles(), loadFtpProfiles(), loadVaultEntries(), loadProxyEntries()])
      setProfiles(next)
      setFtpProfiles(ftp)
      setVaultEntries(credentials)
      setProxyEntries(proxies)
      setTarget(current => current !== null && next.some(item => item.id === current.profileId) ? current : next[0] === undefined ? null : { profileId: next[0].id, path: '~' })
      setError(undefined)
    } catch (reason) { setError(message(reason)) }
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
  useEffect(() => {
    if (openedSessionRef.current !== sessionId) props.controller.close()
  }, [props.controller, sessionId])
  const selected = profiles.find(item => item.id === target?.profileId)
  const currentWorkspaceId = workspaceList.items.find(item => sessionId !== undefined && item.sessionIds.includes(sessionId))?.workspaceId
  const toolbar = <header ref={toolbarGlow.ref} onPointerMove={toolbarGlow.onPointerMove} onPointerLeave={toolbarGlow.onPointerLeave} className="dsh-ssh-toolbar dsh-ssh-border-surface">
      <div className="dsh-ssh-brand"><button type="button" className="dsh-ssh-icon-button" aria-label="Back to session" title="Back to session" onClick={() => props.controller.close()}><IconChevronLeftOutline14 size={15} /></button><span className="dsh-ssh-brand-glyph"><ServerGlyph /></span><span><strong>SSH workbench</strong><small>{view === 'transfer' ? 'FTP · FTPS · SFTP' : selected === undefined ? "Select a host" : `${selected.username}@${selected.host}`}</small></span></div>
      <nav className="dsh-ssh-segments" role="tablist" aria-label="SSH workbench view">
        <Segment active={view === 'workspace'} onClick={() => setView('workspace')}>Terminals & files</Segment>
        <Segment active={view === 'transfer'} onClick={() => setView('transfer')}>File Transfer</Segment>
        <Segment active={view === 'forwards'} onClick={() => setView('forwards')}>Port forwarding</Segment>
        <Segment active={view === 'vault'} onClick={() => setView('vault')}>Credential vault</Segment>
        <Segment active={view === 'proxies'} onClick={() => setView('proxies')}>Proxy vault</Segment>
        <Segment active={view === 'settings'} onClick={() => setView('settings')}>Settings</Segment>
      </nav>
    </header>
  const notice = error && <div className="dsh-ssh-banner is-error" role="alert"><span>{error}</span><button onClick={() => setError(undefined)} aria-label="Close"><IconCloseOutline16 size={16} /></button></div>
  return <>
    <AdaptiveWorkspace
      className="dsh-ssh-workspace"
      toolbar={toolbar}
      notice={notice}
      navigationLabel="Host"
      navigationIcon={<IconDataOutline16 size={15} />}
      navigation={controls => <RemoteWorkspaceTree
        profiles={profiles}
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
        {view === 'transfer' ? <FileTransferWorkspace ftpProfiles={ftpProfiles} vaultEntries={vaultEntries} proxyEntries={proxyEntries} access={access} onProfilesChanged={() => setRefreshKey(value => value + 1)} />
          : view === 'vault' ? <VaultPane entries={vaultEntries} onChanged={() => setRefreshKey(value => value + 1)} />
          : view === 'proxies' ? <ProxyPane entries={proxyEntries} onChanged={() => setRefreshKey(value => value + 1)} />
          : selected === undefined ? <EmptyState />
          : view === 'workspace' ? <HostWorkbench key={selected.id} profile={selected} initialPath={target?.path ?? '~'} onEdit={() => setEditing(selected)} onDelete={() => setDeleting(selected)} />
            : view === 'forwards' ? <ForwardPane profiles={profiles} selected={selected} />
                : <SettingsPane />}
      </section>
    </AdaptiveWorkspace>
    {editing !== undefined && <ProfileEditor profile={editing === 'new' ? undefined : editing} profiles={profiles} vaultEntries={vaultEntries} proxyEntries={proxyEntries} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); setRefreshKey(value => value + 1) }} />}
    {deleting !== undefined && <ProfileDeleteDialog profile={deleting} dependents={profiles.filter(profile => profile.id !== deleting.id && profile.proxy.type === 'jump' && profile.proxy.profileIds.includes(deleting.id))} onClose={() => setDeleting(undefined)} onDeleted={() => { setDeleting(undefined); setEditing(undefined); setRefreshKey(value => value + 1) }} />}
  </>
}

function HostWorkbench({ profile, initialPath, onEdit, onDelete }: { profile: ProfileView; initialPath: string; onEdit(): void; onDelete(): void }): JSX.Element {
  const [sftpReady, setSftpReady] = useState(false)
  const headingGlow = useBorderGlowSurface<HTMLElement>()
  return <div className="dsh-ssh-host-workbench">
    <header ref={headingGlow.ref} onPointerMove={headingGlow.onPointerMove} onPointerLeave={headingGlow.onPointerLeave} className="dsh-ssh-workbench-heading dsh-ssh-border-surface">
      <div><span className="dsh-ssh-host-monogram">{profile.name.slice(0, 1).toUpperCase()}</span><span><h1>{profile.name}</h1><p>{profileAddress(profile)} · {proxyLabel(profile)}</p></span></div>
      <div className="dsh-ssh-heading-actions"><button type="button" className="dsh-ssh-icon-button is-danger" aria-label={`Delete host ${profile.name}`} title="Delete host" onClick={onDelete}><IconTrashOutline16 size={16} /></button><button type="button" className="dsh-ssh-secondary-button" onClick={onEdit}><IconEditOutline16 size={16} />Edit host</button></div>
    </header>
    <ResizableSplit
      storageKey="dsh-ssh:workbench:sftp-width"
      label="Adjust the terminal and SFTP widths"
      primary={<section className="dsh-ssh-workbench-terminal" aria-label={`${profile.name} Terminal`}><TerminalPane profile={profile} onEdit={onEdit} onDelete={onDelete} onConnected={() => setSftpReady(true)} embedded /></section>}
      secondary={<section className="dsh-ssh-workbench-files" aria-label={`${profile.name} SFTP`}>{sftpReady
        ? <ProfileSftpPane key={`${profile.id}:${initialPath}`} profile={profile} initialPath={initialPath} embedded />
        : <div className="dsh-ssh-sftp-deferred"><span>SFTP</span><strong>Waiting for terminal connection</strong><p>The remote directory loads once a terminal is open.</p></div>}
      </section>}
    />
  </div>
}

function TerminalPane({ profile, onEdit, onDelete, onConnected, embedded = false }: { profile: ProfileView; onEdit(): void; onDelete(): void; onConnected?(): void; embedded?: boolean }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal>()
  const fitRef = useRef<FitAddon>()
  const terminalIdRef = useRef<string>()
  const [terminalId, setTerminalId] = useState<string>()
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle')
  const [error, setError] = useState<string>()

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const terminal = createSshTerminal({ scrollback: 5000 })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host)
    terminalRef.current = terminal; fitRef.current = fit
    const viewport = attachTerminalViewport(host, terminal, fit, (cols, rows) => {
      const id = terminalIdRef.current
      if (id !== undefined) void api(`/terminals/${id}/resize`, { method: 'POST', body: JSON.stringify({ cols, rows }) }).catch(() => {})
    })
    return () => { viewport.dispose(); terminal.dispose(); terminalRef.current = undefined; fitRef.current = undefined }
  }, [])

  useEffect(() => { terminalIdRef.current = terminalId }, [terminalId])

  useEffect(() => {
    if (terminalId === undefined) return
    const terminal = terminalRef.current
    if (terminal === undefined) return
    const transport = new TerminalTransport({
      streamUrl: browserTerminalStreamUrl(terminalId),
      read: cursor => api(`/terminals/${terminalId}/output?cursor=${cursor}`),
      send: (text, sequence) => api(`/terminals/${terminalId}/input`, { method: 'POST', body: JSON.stringify({ text, sequence }) }),
    })
    const input = terminal.onData(data => transport.sendInput(data, reason => setError(message(reason))))
    const stopOutput = transport.observe({
      output: value => {
        if (value.truncated) terminal.write('\r\n\x1b[33m[Earlier output truncated]\x1b[0m\r\n')
        if (value.data) terminal.write(value.data)
        if (value.closed) { setPhase('idle'); setTerminalId(undefined) }
      },
      error: reason => { setError(message(reason)); setPhase('error') },
    })
    return () => { stopOutput(); transport.dispose(); input.dispose() }
  }, [terminalId])

  useEffect(() => () => { if (terminalId !== undefined) void api(`/terminals/${terminalId}`, { method: 'DELETE' }).catch(() => {}) }, [terminalId])
  useEffect(() => { setTerminalId(undefined); setPhase('idle'); terminalRef.current?.clear() }, [profile.id])

  const connect = async (): Promise<void> => {
    const terminal = terminalRef.current
    if (terminal === undefined) return
    setPhase('connecting'); setError(undefined); terminal.clear(); terminal.write(`\x1b[2mConnecting ${profileAddress(profile)}…\x1b[0m\r\n`)
    try {
      fitRef.current?.fit()
      const result = await api<{ id: string }>('/terminals', { method: 'POST', body: JSON.stringify({ profileId: profile.id, cols: terminal.cols, rows: terminal.rows }) })
      setTerminalId(result.id); setPhase('connected'); onConnected?.(); terminal.focus()
    } catch (reason) { setPhase('error'); setError(message(reason)); terminal.write(`\r\n\x1b[31m${message(reason)}\x1b[0m\r\n`) }
  }
  const disconnect = async (): Promise<void> => {
    if (terminalId !== undefined) await api(`/terminals/${terminalId}`, { method: 'DELETE' }).catch(() => {})
    setTerminalId(undefined); setPhase('idle')
  }
  return <div className={`dsh-ssh-terminal-pane${embedded ? ' is-embedded' : ''}`}>
    <div className="dsh-ssh-content-heading">
      <div><div className="dsh-ssh-title-line"><span className={`dsh-ssh-live-dot is-${phase}`} /> <h1>{embedded ? "Terminal" : profile.name}</h1></div><p>{embedded ? profileAddress(profile) : `${profileAddress(profile)} · ${proxyLabel(profile)}`}</p></div>
      <div className="dsh-ssh-heading-actions">
        {!embedded && <><button type="button" className="dsh-ssh-icon-button is-danger" aria-label={`Delete host ${profile.name}`} title="Delete host" onClick={onDelete}><IconTrashOutline16 size={16} /></button><button type="button" className="dsh-ssh-secondary-button" onClick={onEdit}><IconEditOutline16 size={16} />Edit</button></>}
        {phase === 'connected' ? <button type="button" className="dsh-ssh-danger-button" onClick={() => { void disconnect() }}><IconStopFill16 size={16} />Disconnect</button>
          : <button type="button" className="dsh-ssh-primary-button" disabled={phase === 'connecting'} onClick={() => { void connect() }}>{phase === 'connecting' ? "Connecting…" : "Open terminal"}</button>}
      </div>
    </div>
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    <div className="dsh-ssh-terminal-frame"><div className="dsh-ssh-xterm"><div ref={hostRef} className="dsh-ssh-terminal-viewport" /></div><div className="dsh-ssh-terminal-status"><span>{phase === 'connected' ? "Connected" : phase === 'connecting' ? "Establishing a secure connection" : "Terminal not connected"}</span><span>UTF-8 · {profile.terminalType}</span></div></div>
  </div>
}

function ForwardPane({ profiles, selected }: { profiles: ProfileView[]; selected: ProfileView }): JSX.Element {
  const [rules, setRules] = useState<ForwardView[]>([])
  const [statuses, setStatuses] = useState<ForwardStatus[]>([])
  const [editing, setEditing] = useState<ForwardView | 'new'>()
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
  const remove = async (id: string): Promise<void> => { try { await api(`/forwards/${id}`, { method: 'DELETE' }); await refresh() } catch (reason) { setError(message(reason)) } }
  return <div className="dsh-ssh-forward-pane">
    <div className="dsh-ssh-content-heading"><div><h1>Port forwarding</h1><p>{selected.name} · local, remote, and dynamic SOCKS5</p></div><button className="dsh-ssh-primary-button" onClick={() => setEditing('new')}><IconPlusOutline16 size={16} />New rule</button></div>
    {error && <p className="dsh-ssh-inline-error">{error}</p>}
    <div className="dsh-ssh-forward-list">
      {visible.length === 0 ? <div className="dsh-ssh-table-empty">This host has no port forwarding rules yet.</div> : visible.map(rule => {
        const status = statuses.find(item => item.ruleId === rule.id)
        return <article className="dsh-ssh-forward-row" key={rule.id}>
          <span className={`dsh-ssh-forward-kind is-${rule.kind}`}>{rule.kind === 'local' ? 'L' : rule.kind === 'remote' ? 'R' : 'D'}</span>
          <span className="dsh-ssh-forward-copy"><strong>{rule.name}</strong><small>{forwardSummary(rule, status)}</small></span>
          <span className={`dsh-ssh-state-label is-${status?.state ?? 'stopped'}`}>{forwardState(status)}</span>
          <button className="dsh-ssh-icon-button" onClick={() => setEditing(rule)} aria-label="Edit"><IconEditOutline16 size={16} /></button>
          {status?.state === 'running' ? <button className="dsh-ssh-icon-button" onClick={() => { void action(rule.id, 'stop') }} aria-label="Stop"><IconStopFill16 size={16} /></button>
            : <button className="dsh-ssh-small-primary" onClick={() => { void action(rule.id, 'start') }}>Start</button>}
          <button className="dsh-ssh-icon-button is-danger" onClick={() => { void remove(rule.id) }} aria-label="Delete"><IconTrashOutline16 size={16} /></button>
        </article>
      })}
    </div>
    {editing !== undefined && <ForwardEditor profile={selected} value={editing === 'new' ? undefined : editing} profiles={profiles} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); void refresh() }} />}
  </div>
}

function VaultPane({ entries, onChanged }: { entries: VaultEntryView[]; onChanged(): void }): JSX.Element {
  const [editing, setEditing] = useState<VaultEntryView | 'new'>()
  const [error, setError] = useState<string>()
  const remove = async (entry: VaultEntryView): Promise<void> => {
    if (!window.confirm(`Delete the credential vault entry “${entry.name}”? This action cannot be undone.`)) return
    try { await api(`/vault/${entry.id}`, { method: 'DELETE' }); onChanged() }
    catch (reason) { setError(message(reason)) }
  }
  return <div className="dsh-ssh-vault-pane">
    <div className="dsh-ssh-content-heading"><div><h1>Credential vault</h1><p>Keep common accounts in one place; connection configs only reference credentials.</p></div><button type="button" className="dsh-ssh-primary-button" onClick={() => setEditing('new')}><IconPlusOutline16 size={16} />New credential</button></div>
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    {entries.length === 0 ? <div className="dsh-ssh-vault-empty"><span><IconUserOutline16 size={20} /></span><strong>No saved credentials yet</strong><p>Passwords and private keys are stored only in the DSH credential service, never written to SSH config files.</p><button type="button" className="dsh-ssh-secondary-button" onClick={() => setEditing('new')}><IconPlusOutline16 size={15} />Add credential</button></div>
      : <div className="dsh-ssh-vault-list">{entries.map(entry => <article className="dsh-ssh-vault-row" key={entry.id}><span className="dsh-ssh-vault-glyph"><IconUserOutline16 size={16} /></span><span><strong>{entry.name}</strong><small>{entry.username} · {entry.authType === 'password' ? "Password" : "Private key"}</small></span><span className={`dsh-ssh-vault-state${entry.credential.configured ? ' is-ready' : ''}`}>{entry.credential.configured ? "Available" : "Missing credentials"}</span><small>{entry.references} connections</small><button type="button" className="dsh-ssh-icon-button" aria-label={`Edit ${entry.name}`} onClick={() => setEditing(entry)}><IconEditOutline16 size={16} /></button><button type="button" className="dsh-ssh-icon-button is-danger" disabled={entry.references > 0} aria-label={`Delete ${entry.name}`} title={entry.references > 0 ? "Still in use by connections" : "Delete credential"} onClick={() => { void remove(entry) }}><IconTrashOutline16 size={16} /></button></article>)}</div>}
    {editing !== undefined && <VaultEditor value={editing === 'new' ? undefined : editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); onChanged() }} />}
  </div>
}

function VaultEditor({ value, onClose, onSaved }: { value?: VaultEntryView | undefined; onClose(): void; onSaved(): void }): JSX.Element {
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
  return <Dialog title={value === undefined ? "Create credential" : `Edit ${value.name}`} subtitle="Passwords and private keys are not shown again after saving" onClose={onClose}><form className="dsh-ssh-form" onSubmit={event => { void submit(event) }}>
    <div className="dsh-ssh-form-grid"><Field label="Name"><input required maxLength={80} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Production ops" /></Field><Field label="Username"><input required maxLength={128} autoComplete="username" value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} /></Field></div>
    <Field label="Auth method"><select value={form.authType} onChange={event => setForm({ ...form, authType: event.target.value as 'password' | 'private-key' })}><option value="password">Password</option><option value="private-key">Private key</option></select></Field>
    {form.authType === 'password' ? <Field label="Password" hint={value?.credential.fields.includes('password') ? "Saved; leave blank to keep unchanged" : "Required. Cannot be read back after saving."}><PasswordInput required={value === undefined || !value.credential.fields.includes('password')} autoComplete="new-password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /></Field>
      : <><Field label="Private key" hint={value?.credential.fields.includes('privateKey') ? "Saved; leave blank to keep unchanged" : "Paste an OpenSSH or PEM private key"}><textarea required={value === undefined || !value.credential.fields.includes('privateKey')} rows={7} spellCheck={false} value={form.privateKey} onChange={event => setForm({ ...form, privateKey: event.target.value })} /></Field><Field label="Key passphrase"><PasswordInput autoComplete="new-password" value={form.passphrase} onChange={event => setForm({ ...form, passphrase: event.target.value })} /></Field></>}
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}<div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" data-ssh-dialog-close onClick={onClose}>Cancel</button><button className="dsh-ssh-primary-button" disabled={saving}>{saving ? "Saving…" : "Save credential"}</button></div>
  </form></Dialog>
}

function ProxyPane({ entries, onChanged }: { entries: ProxyEntryView[]; onChanged(): void }): JSX.Element {
  const [editing, setEditing] = useState<ProxyEntryView | 'new'>()
  const [error, setError] = useState<string>()
  const remove = async (entry: ProxyEntryView): Promise<void> => {
    if (!window.confirm(`Delete the proxy “${entry.name}”? This action cannot be undone.`)) return
    try { await api(`/proxies/${entry.id}`, { method: 'DELETE' }); onChanged() }
    catch (reason) { setError(message(reason)) }
  }
  return <div className="dsh-ssh-proxy-pane">
    <div className="dsh-ssh-content-heading"><div><h1>Proxy vault</h1><p>Keep common HTTP and SOCKS5 proxies in one place; host configs only reference them.</p></div><button type="button" className="dsh-ssh-primary-button" onClick={() => setEditing('new')}><IconPlusOutline16 size={16} />New proxy</button></div>
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    {entries.length === 0 ? <div className="dsh-ssh-vault-empty"><span><IconDataOutline16 size={20} /></span><strong>No saved proxies yet</strong><p>Save once and multiple SSH hosts can share the same connection path.</p><button type="button" className="dsh-ssh-secondary-button" onClick={() => setEditing('new')}><IconPlusOutline16 size={15} />Add proxy</button></div>
      : <div className="dsh-ssh-proxy-list">{entries.map(entry => <article className="dsh-ssh-proxy-row" key={entry.id}>
        <span className="dsh-ssh-vault-glyph"><IconDataOutline16 size={16} /></span>
        <span><strong>{entry.name}</strong><small>{entry.host}:{entry.port}{entry.username ? ` · ${entry.username}` : ''}</small></span>
        <span className="dsh-ssh-proxy-kind">{entry.proxyType === 'http' ? 'HTTP' : 'SOCKS5'}</span>
        <small>{entry.references} connections</small>
        <button type="button" className="dsh-ssh-icon-button" aria-label={`Edit ${entry.name}`} onClick={() => setEditing(entry)}><IconEditOutline16 size={16} /></button>
        <button type="button" className="dsh-ssh-icon-button is-danger" disabled={entry.references > 0} aria-label={`Delete ${entry.name}`} title={entry.references > 0 ? "Still in use by connections" : "Delete proxy"} onClick={() => { void remove(entry) }}><IconTrashOutline16 size={16} /></button>
      </article>)}</div>}
    {editing !== undefined && <ProxyEditor value={editing === 'new' ? undefined : editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); onChanged() }} />}
  </div>
}

function ProxyEditor({ value, onClose, onSaved }: { value?: ProxyEntryView | undefined; onClose(): void; onSaved(): void }): JSX.Element {
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
  return <Dialog title={value === undefined ? "Create proxy" : `Edit ${value.name}`} subtitle="The proxy password is not shown again after saving" onClose={onClose}><form className="dsh-ssh-form" onSubmit={event => { void submit(event) }}>
    <div className="dsh-ssh-form-grid"><Field label="Name"><input required maxLength={80} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Office SOCKS5" /></Field><Field label="Proxy type"><select value={form.proxyType} onChange={event => setForm({ ...form, proxyType: event.target.value as 'http' | 'socks5' })}><option value="socks5">SOCKS5</option><option value="http">HTTP CONNECT</option></select></Field></div>
    <div className="dsh-ssh-form-grid is-host"><Field label="Proxy host"><input required maxLength={253} value={form.host} onChange={event => setForm({ ...form, host: event.target.value })} placeholder="127.0.0.1" /></Field><Field label="Proxy port"><input required type="number" min="1" max="65535" value={form.port} onChange={event => setForm({ ...form, port: event.target.value })} /></Field></div>
    <div className="dsh-ssh-form-grid"><Field label="Proxy username"><input maxLength={128} value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} autoComplete="username" /></Field><Field label="Proxy password" hint={value?.credential.fields.includes('proxyPassword') ? "Saved; leave blank to keep unchanged" : "Optional. Cannot be read back after saving."}><input type="password" autoComplete="new-password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /></Field></div>
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    <div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" data-ssh-dialog-close onClick={onClose}>Cancel</button><button className="dsh-ssh-primary-button" disabled={saving}>{saving ? "Saving…" : "Save proxy"}</button></div>
  </form></Dialog>
}

function SettingsPane(): JSX.Element {
  const [settings, setSettings] = useState<SettingsView>()
  const [gist, setGist] = useState<GistSyncView>()
  const [token, setToken] = useState('')
  const [encryptionPassphrase, setEncryptionPassphrase] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [oauthFlow, setOauthFlow] = useState<GitHubDeviceFlowStart>()
  const [busy, setBusy] = useState<'save' | 'test' | 'sync' | 'oauth' | 'disconnect' | 'network'>()
  const [notice, setNotice] = useState<string>()
  const [error, setError] = useState<string>()
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
          setNotice(`GitHub connected · ${status.login}`)
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
      setNotice(`GitHub network OK · ${result.route === 'proxy' ? "Via proxy" : "Direct"}`)
    } catch (reason) { setError(message(reason)) } finally { setBusy(undefined) }
  }
  const saveGistConfiguration = async (): Promise<GistSyncView> => {
    if (gist === undefined) throw new Error("Gist sync settings are not loaded yet")
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
      if (kind === 'save') { setNotice("Gist sync settings saved"); return next }
      if (kind === 'test') {
        const result = await api<{ login: string }>('/gist-sync/test', { method: 'POST' })
        setNotice(`Connected · ${result.login}`)
        setGist(await api('/gist-sync'))
        return next
      }
      const synced = await api<GistSyncView>('/gist-sync/run', { method: 'POST' })
      setGist(synced); setNotice(syncResultLabel(synced.lastResult)); return synced
    } catch (reason) { setError(message(reason)); return undefined } finally { setBusy(undefined) }
  }
  const connectGitHub = async (): Promise<void> => {
    setBusy('oauth'); setError(undefined); setNotice(undefined)
    try {
      await saveGistConfiguration()
      const flow = await api<GitHubDeviceFlowStart>('/gist-sync/oauth/start', { method: 'POST' })
      setOauthFlow(flow)
      setNotice("Device code generated. Copy it in the authorization window, then go to GitHub.")
    } catch (reason) { setError(message(reason)) } finally { setBusy(undefined) }
  }
  const disconnectGitHub = async (): Promise<void> => {
    setBusy('disconnect'); setError(undefined); setNotice(undefined); setOauthFlow(undefined)
    try {
      setGist(await api('/gist-sync/oauth/disconnect', { method: 'POST' }))
      setNotice("GitHub account disconnected. The sync encryption password is still kept on this device.")
    } catch (reason) { setError(message(reason)) } finally { setBusy(undefined) }
  }
  return <div className="dsh-ssh-settings-pane"><div className="dsh-ssh-content-heading"><div><h1>SSH settings</h1><p>Security boundaries, command limits, and cross-device config sync</p></div></div>
    <div className="dsh-ssh-settings-stack">
      {gist && <section className="dsh-ssh-settings-section" aria-labelledby="dsh-ssh-gist-title">
        <div className="dsh-ssh-settings-section-heading"><span><strong id="dsh-ssh-gist-title">GitHub Gist sync</strong><small>End-to-end encrypted sync of hosts, FTP/FTPS, project directories, proxies, and the credential vault</small></span><SyncStatus view={gist} /></div>
        <div className="dsh-ssh-github-auth">
          <span className="dsh-ssh-github-mark" aria-hidden="true">GH</span>
          <span><strong>{gist.tokenConfigured ? `Connected ${gist.githubLogin ?? 'GitHub'}` : "Connect GitHub"}</strong><small>{gist.tokenConfigured ? "Authorization credentials are stored securely in this DSH" : "Get Gist access through GitHub device authorization"}</small></span>
          <span className="dsh-ssh-github-auth-actions">
            <button type="button" className={gist.tokenConfigured ? 'dsh-ssh-secondary-button' : 'dsh-ssh-primary-button'} disabled={busy !== undefined || !gist.oauthClientId} onClick={() => { void connectGitHub() }}>{busy === 'oauth' ? "Connecting…" : gist.tokenConfigured ? "Reconnect" : "Connect GitHub"}</button>
            {gist.tokenConfigured && <button type="button" className="dsh-ssh-text-button" disabled={busy !== undefined} onClick={() => { void disconnectGitHub() }}>{busy === 'disconnect' ? "Disconnecting…" : "Disconnect"}</button>}
          </span>
        </div>
        {!gist.oauthClientId && <p className="dsh-ssh-auth-hint">On first use, enter your GitHub OAuth Client ID under “Advanced authorization settings” below. It is not a secret; it only identifies the authorization app.</p>}
        <div className="dsh-ssh-gist-fields is-two">
          <Field label="Gist ID" hint="Leave empty to create a private Gist automatically on the first sync"><input maxLength={64} spellCheck={false} value={gist.gistId ?? ''} onChange={event => setGist(withGistId(gist, event.target.value))} placeholder="Auto-create" /></Field>
          <Field label="Sync encryption password" hint={gist.encryptionConfigured ? "Saved securely. Enter the same password on a new device." : "At least 6 characters. A longer password is recommended."}><input type="password" minLength={6} maxLength={512} autoComplete="new-password" value={encryptionPassphrase} onChange={event => setEncryptionPassphrase(event.target.value)} placeholder={gist.encryptionConfigured ? "Configured" : "Set a separate encryption password"} /></Field>
        </div>
        <div className="dsh-ssh-sync-meta" aria-label="Sync version info"><span><small>Cloud version</small><strong title={gist.cloudVersion}>{gist.cloudVersion ? gist.cloudVersion.slice(0, 10) : "Not read yet"}</strong></span><span><small>Last sync</small><strong>{gist.lastSyncAt ? formatRelativeTime(gist.lastSyncAt) : "Never synced"}</strong></span></div>
        <fieldset className="dsh-ssh-sync-strategy"><legend>Sync policy</legend><div role="group" aria-label="Gist sync policy">
          <SyncStrategyButton active={gist.strategy === 'smart'} title="Smart" description="Detect changes on both sides automatically and merge per item" onClick={() => setGist({ ...gist, strategy: 'smart' })} />
          <SyncStrategyButton active={gist.strategy === 'local-first'} title="Local first" description="Keep this device's config when both sides changed" onClick={() => setGist({ ...gist, strategy: 'local-first' })} />
          <SyncStrategyButton active={gist.strategy === 'cloud-first'} title="Cloud first" description="Use the Gist config when both sides changed" onClick={() => setGist({ ...gist, strategy: 'cloud-first' })} />
        </div></fieldset>
        <div className="dsh-ssh-sync-options">
          <label className="dsh-ssh-switch-row"><span><strong>Auto sync</strong><small>Checks after startup, after config changes, and every five minutes in the background</small></span><input type="checkbox" checked={gist.autoSync} onChange={event => setGist({ ...gist, autoSync: event.target.checked })} /></label>
          <label className="dsh-ssh-number-row"><span><strong>Backup retention</strong><small>Explicit history snapshots kept in the main Gist; GitHub's own revision history is unaffected</small></span><input type="number" min="0" max="50" step="1" value={gist.backupRetention} onChange={event => setGist({ ...gist, backupRetention: Number(event.target.value) })} /><em>copies</em></label>
        </div>
        <button type="button" className="dsh-ssh-advanced-toggle" aria-expanded={advanced} onClick={() => setAdvanced(value => !value)}><span>Advanced authorization settings</span><IconChevronDownOutline14 /></button>
        {advanced && <div className="dsh-ssh-advanced-auth">
          <Field label="GitHub OAuth Client ID" hint="Enable Device Flow in the GitHub OAuth App; no Client Secret needed"><input maxLength={128} spellCheck={false} value={gist.oauthClientId ?? ''} onChange={event => setGist(withOauthClientId(gist, event.target.value))} placeholder="Ov23li…" /></Field>
          <Field label="Personal Access Token (fallback)" hint={gist.tokenConfigured ? "Already authorized. Entering a token replaces the current authorization." : "Fill in only when OAuth is unavailable. Requires the gist scope."}><input type="password" autoComplete="new-password" spellCheck={false} value={token} onChange={event => setToken(event.target.value)} placeholder="ghp_… / github_pat_…" /></Field>
          <p>No OAuth App?<a href="https://github.com/settings/applications/new" target="_blank" rel="noreferrer">Go to GitHub to create one</a>, then enable Device Flow in the app settings after creating it.</p>
        </div>}
        <p className="dsh-ssh-sync-scope"><strong>Synced content: </strong>Hosts, FTP/FTPS, pinned project directories, the proxy vault, the credential vault, and their passwords and private keys. Sensitive fields are encrypted before upload.<br /><strong>Kept local only: </strong>Current-session grants, port forwards, public binds, and command limits. The GitHub token and the sync passphrase also stay only in the local DSH credential service.</p>
        {gist.lastError && <p className="dsh-ssh-inline-error" role="alert">Last sync failed: {gist.lastError}</p>}
        <div className="dsh-ssh-settings-actions">
          {gist.gistUrl && <a className="dsh-ssh-secondary-button" href={gist.gistUrl} target="_blank" rel="noreferrer">Open Gist</a>}
          <button type="button" className="dsh-ssh-secondary-button" disabled={busy !== undefined} onClick={() => { void persistGist('test') }}>{busy === 'test' ? "Testing…" : "Test connection"}</button>
          <button type="button" className="dsh-ssh-secondary-button" disabled={busy !== undefined} onClick={() => { void persistGist('sync') }}>{busy === 'sync' ? "Syncing…" : "Sync now"}</button>
          <button type="button" className="dsh-ssh-primary-button" disabled={busy !== undefined} onClick={() => { void persistGist('save') }}>{busy === 'save' ? "Saving…" : "Save sync settings"}</button>
        </div>
      </section>}
      {settings && <section className="dsh-ssh-settings-section" aria-labelledby="dsh-ssh-local-title"><div className="dsh-ssh-settings-section-heading"><span><strong id="dsh-ssh-local-title">Local runtime settings</strong><small>Affects this DSH instance only; not synced via Gist</small></span></div><div className="dsh-ssh-settings-group">
        <Field label="GitHub outbound proxy" hint="Used only for OAuth and the Gist API; e.g. http://host.docker.internal:7893. Falls back to the system HTTPS_PROXY when left empty."><div className="dsh-ssh-github-proxy-control"><input maxLength={2048} spellCheck={false} value={settings.githubProxy ?? ''} onChange={event => setSettings(withGitHubProxy(settings, event.target.value))} placeholder="Connect to GitHub directly" /><button type="button" className="dsh-ssh-secondary-button" disabled={busy !== undefined} onClick={() => { void testGitHubNetwork() }}>{busy === 'network' ? "Testing…" : "Test GitHub network"}</button></div></Field>
        <label className="dsh-ssh-switch-row"><span><strong>Allow public port binding</strong><small>Allows forwards to listen on 0.0.0.0 or other non-loopback addresses. Enable only with a properly configured firewall.</small></span><input type="checkbox" checked={settings.allowPublicBind} onChange={event => { void save({ ...settings, allowPublicBind: event.target.checked }) }} /></label>
        <label className="dsh-ssh-number-row"><span><strong>Default command timeout</strong><small>Maximum wait time for the AI's ssh_exec</small></span><input type="number" min="1000" max="300000" step="1000" value={settings.defaultCommandTimeoutMs} onChange={event => setSettings({ ...settings, defaultCommandTimeoutMs: Number(event.target.value) })} onBlur={() => { void save(settings) }} /><em>ms</em></label>
        <label className="dsh-ssh-number-row"><span><strong>Max command output</strong><small>Keeps the newest output beyond the limit to avoid crowding out context</small></span><input type="number" min="1000" max="1000000" step="1000" value={settings.maxOutputChars} onChange={event => setSettings({ ...settings, maxOutputChars: Number(event.target.value) })} onBlur={() => { void save(settings) }} /><em>chars</em></label>
      </div></section>}
    </div>
    {oauthFlow && <GitHubDeviceAuthorizationDialog flow={oauthFlow} onClose={() => setOauthFlow(undefined)} />}
    {notice && <p className="dsh-ssh-inline-success" role="status">{notice}</p>}{error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
  </div>
}

function GitHubDeviceAuthorizationDialog({ flow, onClose }: { flow: GitHubDeviceFlowStart; onClose(): void }): JSX.Element {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copyCode = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(flow.userCode)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }
  return <Dialog title="Connect GitHub" subtitle="Copy the device code, then go to GitHub to finish authorizing" className="dsh-ssh-device-auth-dialog" onClose={onClose}>
    <div className="dsh-ssh-device-auth-content">
      <div className="dsh-ssh-device-code-block">
        <span><small>One-time device code</small><code>{flow.userCode}</code></span>
        <button type="button" className="dsh-ssh-secondary-button" onClick={() => { void copyCode() }}>{copyState === 'copied' ? "Copied" : "Copy code"}</button>
      </div>
      <ol className="dsh-ssh-device-auth-steps">
        <li><span>1</span><p><strong>Copy the code above</strong><small>The device code is for this authorization only</small></p></li>
        <li><span>2</span><p><strong>Open the GitHub authorization page</strong><small>Paste the code and confirm authorization for the current OAuth App</small></p></li>
        <li><span>3</span><p><strong>Back to DSH</strong><small>The connection completes automatically once authorized</small></p></li>
      </ol>
      {copyState === 'failed' && <p className="dsh-ssh-inline-error" role="alert">The browser blocked auto-copy; select the device code and copy it manually.</p>}
      <p className="dsh-ssh-device-auth-expiry">The code expires {new Date(flow.expiresAt).toLocaleTimeString()}</p>
      <div className="dsh-ssh-dialog-actions">
        <button type="button" className="dsh-ssh-secondary-button" data-ssh-dialog-close onClick={onClose}>Later</button>
        <a className="dsh-ssh-primary-button" href={flow.verificationUri} target="_blank" rel="noreferrer">Go to GitHub to authorize</a>
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
  const ready = view.tokenConfigured && view.encryptionConfigured
  const label = view.running ? "Syncing" : view.lastError ? "Action needed" : view.lastSyncAt === undefined ? ready ? "Waiting for first sync" : "Not configured" : `Last synced ${formatRelativeTime(view.lastSyncAt)}`
  return <span className={`dsh-ssh-sync-status${view.running ? ' is-running' : view.lastError ? ' is-error' : ready ? ' is-ready' : ''}`} role="status"><i aria-hidden="true" />{label}</span>
}

function syncResultLabel(result: GistSyncView['lastResult']): string {
  return result === 'uploaded' ? "Local config uploaded" : result === 'downloaded' ? "Cloud config applied" : result === 'merged' ? "Configs from both sides merged intelligently" : "Config is already up to date"
}

function formatRelativeTime(value: number): string {
  const elapsed = Math.max(0, Date.now() - value)
  if (elapsed < 60_000) return "Just now"
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} minutes ago`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} hours ago`
  return new Date(value).toLocaleString()
}

function ForwardEditor({ profile, value, onClose, onSaved }: { profile: ProfileView; profiles: ProfileView[]; value?: ForwardView | undefined; onClose(): void; onSaved(): void }): JSX.Element {
  const [form, setForm] = useState({ name: value?.name ?? '', kind: value?.kind ?? 'local', bindHost: value?.bindHost ?? '127.0.0.1', bindPort: String(value?.bindPort ?? 0), targetHost: value?.targetHost ?? '127.0.0.1', targetPort: String(value?.targetPort ?? 80), autoStart: value?.autoStart ?? false })
  const [error, setError] = useState<string>()
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    try {
      await api(value === undefined ? '/forwards' : `/forwards/${value.id}`, { method: value === undefined ? 'POST' : 'PUT', body: JSON.stringify({ rule: { profileId: profile.id, name: form.name, kind: form.kind, bindHost: form.bindHost, bindPort: Number(form.bindPort), ...(form.kind === 'dynamic' ? {} : { targetHost: form.targetHost, targetPort: Number(form.targetPort) }), autoStart: form.autoStart } }) })
      onSaved()
    } catch (reason) { setError(message(reason)) }
  }
  return <Dialog title={value === undefined ? "New port forward" : `Edit ${value.name}`} subtitle={profile.name} onClose={onClose}><form className="dsh-ssh-form" onSubmit={event => { void submit(event) }}>
    <Field label="Name"><input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></Field>
    <Field label="Type"><select value={form.kind} onChange={event => setForm({ ...form, kind: event.target.value as typeof form.kind })}><option value="local">Local forward (L)</option><option value="remote">Remote forward (R)</option><option value="dynamic">Dynamic SOCKS5 (D)</option></select></Field>
    <div className="dsh-ssh-form-grid is-host"><Field label="Listen address"><input required value={form.bindHost} onChange={event => setForm({ ...form, bindHost: event.target.value })} /></Field><Field label="Listen port" hint="0 means choose automatically"><input required type="number" min="0" max="65535" value={form.bindPort} onChange={event => setForm({ ...form, bindPort: event.target.value })} /></Field></div>
    {form.kind !== 'dynamic' && <div className="dsh-ssh-form-grid is-host"><Field label="Target host"><input required value={form.targetHost} onChange={event => setForm({ ...form, targetHost: event.target.value })} /></Field><Field label="Target port"><input required type="number" min="1" max="65535" value={form.targetPort} onChange={event => setForm({ ...form, targetPort: event.target.value })} /></Field></div>}
    <label className="dsh-ssh-switch-row"><span><strong>Auto start</strong><small>Restore this forward when DSH starts</small></span><input type="checkbox" checked={form.autoStart} onChange={event => setForm({ ...form, autoStart: event.target.checked })} /></label>
    {error && <p className="dsh-ssh-inline-error">{error}</p>}<div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" data-ssh-dialog-close onClick={onClose}>Cancel</button><button className="dsh-ssh-primary-button">Save rule</button></div>
  </form></Dialog>
}

function proxyLabel(profile: ProfileView): string { return profile.proxy.type === 'none' ? "Direct" : profile.proxy.type === 'saved' ? "Common proxies" : profile.proxy.type === 'jump' ? "SSH jump host" : profile.proxy.type === 'http' ? "HTTP proxy" : "SOCKS5 proxy" }
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
function forwardState(status?: ForwardStatus): string { return status?.state === 'running' ? `Running · ${status.connections}` : status?.state === 'starting' ? "Starting" : status?.state === 'error' ? "Failed" : "Stopped" }

function installStyles(): () => void {
  const previous = document.getElementById(STYLE_ID)
  if (previous !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `${xtermCss}\n${adaptiveUiCss}\n${borderGlowCss}\n${glareHoverCss}\n${cssText}\n${remoteWorkspaceCss}\n${hostWorkbenchCss}\n${fileTransferCss}\n${interactiveSurfacesCss}`
  document.head.append(style)
  return () => style.remove()
}
