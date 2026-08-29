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
  type ForwardStatus, type ForwardView, type FtpProfileView,
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
import { Dialog, EmptyState, Field, Segment, ServerGlyph, errorMessage } from './ui-components.js'
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
  ctx.effect(() => () => { controller.close(); activityController.close() }, 'dsh-ssh: workspace lifecycle')
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
  const listeners = new Set<() => void>()
  let openSessionId: string | undefined
  let selectedProfileId: string | undefined
  let requestedView: ActivityViewMode | undefined
  let dispose: (() => void) | undefined
  const notify = (): void => { for (const listener of listeners) listener() }
  const controller: ActivityController = {
    open(sessionId, profileId, view) {
      const nextView = view ?? (profileId === undefined ? 'local-directory' : 'remote-directory')
      if (dispose !== undefined && openSessionId === sessionId) {
        if (profileId !== undefined) selectedProfileId = profileId
        requestedView = nextView
        ctx.layout.openDetails()
        notify()
        return
      }
      controller.close()
      activatePluginWorkspace(PLUGIN_ID)
      openSessionId = sessionId
      selectedProfileId = profileId
      requestedView = nextView
      dispose = ctx.slots.register({ name: 'details', priority: -2 }, props => (
        <SshActivityPanel {...props} controller={controller} />
      ))
      ctx.layout.openDetails()
      notify()
    },
    toggle(sessionId) {
      if (dispose !== undefined && openSessionId === sessionId) return controller.close(sessionId)
      controller.open(sessionId)
    },
    close(sessionId) {
      if (sessionId !== undefined && sessionId !== openSessionId) return
      const current = dispose
      dispose = undefined
      openSessionId = undefined
      selectedProfileId = undefined
      requestedView = undefined
      current?.()
      if (current !== undefined) ctx.layout.closeDetails()
      notify()
    },
    isOpen: sessionId => dispose !== undefined && openSessionId === sessionId,
    selected: sessionId => openSessionId === sessionId ? selectedProfileId : undefined,
    requestedView: sessionId => openSessionId === sessionId ? requestedView : undefined,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
  }
  return controller
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
      <button type="button" className={`dsh-ssh-rail-button${activityOpen ? ' is-active' : ''}`} title={currentSessionId === undefined ? '打开会话后可查看 SSH 侧栏' : activityOpen ? '收起 SSH 侧栏' : '展开 SSH 侧栏'} aria-label={activityOpen ? '收起 SSH 侧栏' : '展开 SSH 侧栏'} aria-pressed={activityOpen} disabled={currentSessionId === undefined} onClick={toggleActivity}><ServerGlyph /></button>
    </section>
  }
  return <section ref={ref} className="dsh-ssh-sidebar">
    <div className="dsh-ssh-sidebar-heading">
      <button type="button" className="dsh-ssh-sidebar-title" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span className="dsh-ssh-disclosure" data-open={open}><IconChevronDownOutline14 size={14} /></span><span>远端</span>
      </button>
      <button type="button" className={`dsh-ssh-icon-button${activityOpen ? ' is-active' : ''}`} aria-label={activityOpen ? '收起 SSH 侧栏' : '展开 SSH 侧栏'} title={currentSessionId === undefined ? '打开会话后可查看 SSH 侧栏' : activityOpen ? '收起 SSH 侧栏' : '展开 SSH 侧栏'} aria-pressed={activityOpen} disabled={currentSessionId === undefined} onClick={toggleActivity}><IconPanelLeftOutline16 size={16} className="dsh-ssh-panel-right-icon" /></button>
    </div>
    {open && <div className="dsh-ssh-sidebar-list">
      <button type="button" className="dsh-ssh-sidebar-panel" onClick={openWorkspace}><ServerGlyph /><span>SSH 面板</span></button>
      {currentSessionId === undefined ? <p className="dsh-ssh-sidebar-note">打开会话后显示可用远端</p>
        : availableProfiles.length === 0 ? <p className="dsh-ssh-sidebar-note">当前会话未授权远端</p>
          : availableProfiles.slice(0, 6).map(profile => <button type="button" className={`dsh-ssh-sidebar-row${activityOpen && props.activityController.selected(currentSessionId) === profile.id ? ' is-active' : ''}`} key={profile.id} onClick={() => openActivity(profile.id)}>
            <span className="dsh-ssh-status-dot is-injected" aria-hidden="true" />
            <span className="dsh-ssh-sidebar-copy"><strong>{profile.name}</strong><small>{profile.host}</small></span>
            <span className="dsh-ssh-injected-mark">已挂载</span>
          </button>)}
      {availableProfiles.length > 6 && <button type="button" className="dsh-ssh-sidebar-more" onClick={toggleActivity}>还有 {availableProfiles.length - 6} 台可用远端</button>}
    </div>}
  </section>
}

function RemoteWorkspace(props: ConversationProps & { controller: RemoteController }): JSX.Element {
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
  const toolbar = <header className="dsh-ssh-toolbar">
      <div className="dsh-ssh-brand"><button type="button" className="dsh-ssh-icon-button" aria-label="返回会话" title="返回会话" onClick={() => props.controller.close()}><IconChevronLeftOutline14 size={15} /></button><span className="dsh-ssh-brand-glyph"><ServerGlyph /></span><span><strong>SSH 工作台</strong><small>{view === 'transfer' ? 'FTP · FTPS · SFTP' : selected === undefined ? '选择一台主机' : `${selected.username}@${selected.host}`}</small></span></div>
      <nav className="dsh-ssh-segments" role="tablist" aria-label="SSH 工作台视图">
        <Segment active={view === 'workspace'} onClick={() => setView('workspace')}>终端与文件</Segment>
        <Segment active={view === 'transfer'} onClick={() => setView('transfer')}>文件传输</Segment>
        <Segment active={view === 'forwards'} onClick={() => setView('forwards')}>端口转发</Segment>
        <Segment active={view === 'vault'} onClick={() => setView('vault')}>密钥库</Segment>
        <Segment active={view === 'proxies'} onClick={() => setView('proxies')}>代理库</Segment>
        <Segment active={view === 'settings'} onClick={() => setView('settings')}>设置</Segment>
      </nav>
    </header>
  const notice = error && <div className="dsh-ssh-banner is-error" role="alert"><span>{error}</span><button onClick={() => setError(undefined)} aria-label="关闭"><IconCloseOutline16 size={16} /></button></div>
  return <>
    <AdaptiveWorkspace
      className="dsh-ssh-workspace"
      toolbar={toolbar}
      notice={notice}
      navigationLabel="主机"
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
  return <div className="dsh-ssh-host-workbench">
    <header className="dsh-ssh-workbench-heading">
      <div><span className="dsh-ssh-host-monogram">{profile.name.slice(0, 1).toUpperCase()}</span><span><h1>{profile.name}</h1><p>{profileAddress(profile)} · {proxyLabel(profile)}</p></span></div>
      <div className="dsh-ssh-heading-actions"><button type="button" className="dsh-ssh-icon-button is-danger" aria-label={`删除主机 ${profile.name}`} title="删除主机" onClick={onDelete}><IconTrashOutline16 size={16} /></button><button type="button" className="dsh-ssh-secondary-button" onClick={onEdit}><IconEditOutline16 size={16} />编辑主机</button></div>
    </header>
    <ResizableSplit
      storageKey="dsh-ssh:workbench:sftp-width"
      label="调整终端与 SFTP 的宽度"
      primary={<section className="dsh-ssh-workbench-terminal" aria-label={`${profile.name} 终端`}><TerminalPane profile={profile} onEdit={onEdit} onDelete={onDelete} onConnected={() => setSftpReady(true)} embedded /></section>}
      secondary={<section className="dsh-ssh-workbench-files" aria-label={`${profile.name} SFTP`}>{sftpReady
        ? <ProfileSftpPane key={`${profile.id}:${initialPath}`} profile={profile} initialPath={initialPath} embedded />
        : <div className="dsh-ssh-sftp-deferred"><span>SFTP</span><strong>等待终端连接</strong><p>打开终端后再读取远端目录。</p></div>}
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
        if (value.truncated) terminal.write('\r\n\x1b[33m[较早输出已截断]\x1b[0m\r\n')
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
    setPhase('connecting'); setError(undefined); terminal.clear(); terminal.write(`\x1b[2m正在连接 ${profileAddress(profile)}…\x1b[0m\r\n`)
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
      <div><div className="dsh-ssh-title-line"><span className={`dsh-ssh-live-dot is-${phase}`} /> <h1>{embedded ? '终端' : profile.name}</h1></div><p>{embedded ? profileAddress(profile) : `${profileAddress(profile)} · ${proxyLabel(profile)}`}</p></div>
      <div className="dsh-ssh-heading-actions">
        {!embedded && <><button type="button" className="dsh-ssh-icon-button is-danger" aria-label={`删除主机 ${profile.name}`} title="删除主机" onClick={onDelete}><IconTrashOutline16 size={16} /></button><button type="button" className="dsh-ssh-secondary-button" onClick={onEdit}><IconEditOutline16 size={16} />编辑</button></>}
        {phase === 'connected' ? <button type="button" className="dsh-ssh-danger-button" onClick={() => { void disconnect() }}><IconStopFill16 size={16} />断开</button>
          : <button type="button" className="dsh-ssh-primary-button" disabled={phase === 'connecting'} onClick={() => { void connect() }}>{phase === 'connecting' ? '连接中…' : '打开终端'}</button>}
      </div>
    </div>
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    <div className="dsh-ssh-terminal-frame"><div className="dsh-ssh-xterm"><div ref={hostRef} className="dsh-ssh-terminal-viewport" /></div><div className="dsh-ssh-terminal-status"><span>{phase === 'connected' ? '已连接' : phase === 'connecting' ? '正在建立安全连接' : '终端未连接'}</span><span>UTF-8 · {profile.terminalType}</span></div></div>
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
    <div className="dsh-ssh-content-heading"><div><h1>端口转发</h1><p>{selected.name} · 本地、远程与动态 SOCKS5</p></div><button className="dsh-ssh-primary-button" onClick={() => setEditing('new')}><IconPlusOutline16 size={16} />新建规则</button></div>
    {error && <p className="dsh-ssh-inline-error">{error}</p>}
    <div className="dsh-ssh-forward-list">
      {visible.length === 0 ? <div className="dsh-ssh-table-empty">这台主机还没有端口转发规则。</div> : visible.map(rule => {
        const status = statuses.find(item => item.ruleId === rule.id)
        return <article className="dsh-ssh-forward-row" key={rule.id}>
          <span className={`dsh-ssh-forward-kind is-${rule.kind}`}>{rule.kind === 'local' ? 'L' : rule.kind === 'remote' ? 'R' : 'D'}</span>
          <span className="dsh-ssh-forward-copy"><strong>{rule.name}</strong><small>{forwardSummary(rule, status)}</small></span>
          <span className={`dsh-ssh-state-label is-${status?.state ?? 'stopped'}`}>{forwardState(status)}</span>
          <button className="dsh-ssh-icon-button" onClick={() => setEditing(rule)} aria-label="编辑"><IconEditOutline16 size={16} /></button>
          {status?.state === 'running' ? <button className="dsh-ssh-icon-button" onClick={() => { void action(rule.id, 'stop') }} aria-label="停止"><IconStopFill16 size={16} /></button>
            : <button className="dsh-ssh-small-primary" onClick={() => { void action(rule.id, 'start') }}>启动</button>}
          <button className="dsh-ssh-icon-button is-danger" onClick={() => { void remove(rule.id) }} aria-label="删除"><IconTrashOutline16 size={16} /></button>
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
    if (!window.confirm(`删除密钥库条目“${entry.name}”？此操作无法撤销。`)) return
    try { await api(`/vault/${entry.id}`, { method: 'DELETE' }); onChanged() }
    catch (reason) { setError(message(reason)) }
  }
  return <div className="dsh-ssh-vault-pane">
    <div className="dsh-ssh-content-heading"><div><h1>密钥库</h1><p>集中保存常用账号，连接配置只引用凭据。</p></div><button type="button" className="dsh-ssh-primary-button" onClick={() => setEditing('new')}><IconPlusOutline16 size={16} />新建凭据</button></div>
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    {entries.length === 0 ? <div className="dsh-ssh-vault-empty"><span><IconUserOutline16 size={20} /></span><strong>还没有常用凭据</strong><p>密码和私钥只保存在 DSH 凭据服务中，不写入 SSH 配置文件。</p><button type="button" className="dsh-ssh-secondary-button" onClick={() => setEditing('new')}><IconPlusOutline16 size={15} />添加凭据</button></div>
      : <div className="dsh-ssh-vault-list">{entries.map(entry => <article className="dsh-ssh-vault-row" key={entry.id}><span className="dsh-ssh-vault-glyph"><IconUserOutline16 size={16} /></span><span><strong>{entry.name}</strong><small>{entry.username} · {entry.authType === 'password' ? '密码' : '私钥'}</small></span><span className={`dsh-ssh-vault-state${entry.credential.configured ? ' is-ready' : ''}`}>{entry.credential.configured ? '可用' : '缺少凭据'}</span><small>{entry.references} 个连接</small><button type="button" className="dsh-ssh-icon-button" aria-label={`编辑 ${entry.name}`} onClick={() => setEditing(entry)}><IconEditOutline16 size={16} /></button><button type="button" className="dsh-ssh-icon-button is-danger" disabled={entry.references > 0} aria-label={`删除 ${entry.name}`} title={entry.references > 0 ? '仍有连接正在使用' : '删除凭据'} onClick={() => { void remove(entry) }}><IconTrashOutline16 size={16} /></button></article>)}</div>}
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
  return <Dialog title={value === undefined ? '新建常用凭据' : `编辑 ${value.name}`} subtitle="密码和私钥保存后不会回显" onClose={onClose}><form className="dsh-ssh-form" onSubmit={event => { void submit(event) }}>
    <div className="dsh-ssh-form-grid"><Field label="名称"><input required maxLength={80} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="生产环境运维" /></Field><Field label="用户名"><input required maxLength={128} autoComplete="username" value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} /></Field></div>
    <Field label="认证方式"><select value={form.authType} onChange={event => setForm({ ...form, authType: event.target.value as 'password' | 'private-key' })}><option value="password">密码</option><option value="private-key">私钥</option></select></Field>
    {form.authType === 'password' ? <Field label="密码" hint={value?.credential.fields.includes('password') ? '已保存；留空保持不变' : '必填，保存后不可读回'}><input required={value === undefined || !value.credential.fields.includes('password')} type="password" autoComplete="new-password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /></Field>
      : <><Field label="私钥" hint={value?.credential.fields.includes('privateKey') ? '已保存；留空保持不变' : '粘贴 OpenSSH 或 PEM 私钥'}><textarea required={value === undefined || !value.credential.fields.includes('privateKey')} rows={7} spellCheck={false} value={form.privateKey} onChange={event => setForm({ ...form, privateKey: event.target.value })} /></Field><Field label="私钥口令"><input type="password" autoComplete="new-password" value={form.passphrase} onChange={event => setForm({ ...form, passphrase: event.target.value })} /></Field></>}
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}<div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" onClick={onClose}>取消</button><button className="dsh-ssh-primary-button" disabled={saving}>{saving ? '正在保存…' : '保存凭据'}</button></div>
  </form></Dialog>
}

function ProxyPane({ entries, onChanged }: { entries: ProxyEntryView[]; onChanged(): void }): JSX.Element {
  const [editing, setEditing] = useState<ProxyEntryView | 'new'>()
  const [error, setError] = useState<string>()
  const remove = async (entry: ProxyEntryView): Promise<void> => {
    if (!window.confirm(`删除代理“${entry.name}”？此操作无法撤销。`)) return
    try { await api(`/proxies/${entry.id}`, { method: 'DELETE' }); onChanged() }
    catch (reason) { setError(message(reason)) }
  }
  return <div className="dsh-ssh-proxy-pane">
    <div className="dsh-ssh-content-heading"><div><h1>代理库</h1><p>集中保存常用 HTTP 与 SOCKS5 代理，主机配置只保留引用。</p></div><button type="button" className="dsh-ssh-primary-button" onClick={() => setEditing('new')}><IconPlusOutline16 size={16} />新建代理</button></div>
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    {entries.length === 0 ? <div className="dsh-ssh-vault-empty"><span><IconDataOutline16 size={20} /></span><strong>还没有常用代理</strong><p>保存一次后，多台 SSH 主机可以共用同一条连接路径。</p><button type="button" className="dsh-ssh-secondary-button" onClick={() => setEditing('new')}><IconPlusOutline16 size={15} />添加代理</button></div>
      : <div className="dsh-ssh-proxy-list">{entries.map(entry => <article className="dsh-ssh-proxy-row" key={entry.id}>
        <span className="dsh-ssh-vault-glyph"><IconDataOutline16 size={16} /></span>
        <span><strong>{entry.name}</strong><small>{entry.host}:{entry.port}{entry.username ? ` · ${entry.username}` : ''}</small></span>
        <span className="dsh-ssh-proxy-kind">{entry.proxyType === 'http' ? 'HTTP' : 'SOCKS5'}</span>
        <small>{entry.references} 个连接</small>
        <button type="button" className="dsh-ssh-icon-button" aria-label={`编辑 ${entry.name}`} onClick={() => setEditing(entry)}><IconEditOutline16 size={16} /></button>
        <button type="button" className="dsh-ssh-icon-button is-danger" disabled={entry.references > 0} aria-label={`删除 ${entry.name}`} title={entry.references > 0 ? '仍有连接正在使用' : '删除代理'} onClick={() => { void remove(entry) }}><IconTrashOutline16 size={16} /></button>
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
  return <Dialog title={value === undefined ? '新建常用代理' : `编辑 ${value.name}`} subtitle="代理密码保存后不会回显" onClose={onClose}><form className="dsh-ssh-form" onSubmit={event => { void submit(event) }}>
    <div className="dsh-ssh-form-grid"><Field label="名称"><input required maxLength={80} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="办公室 SOCKS5" /></Field><Field label="代理类型"><select value={form.proxyType} onChange={event => setForm({ ...form, proxyType: event.target.value as 'http' | 'socks5' })}><option value="socks5">SOCKS5</option><option value="http">HTTP CONNECT</option></select></Field></div>
    <div className="dsh-ssh-form-grid is-host"><Field label="代理主机"><input required maxLength={253} value={form.host} onChange={event => setForm({ ...form, host: event.target.value })} placeholder="127.0.0.1" /></Field><Field label="代理端口"><input required type="number" min="1" max="65535" value={form.port} onChange={event => setForm({ ...form, port: event.target.value })} /></Field></div>
    <div className="dsh-ssh-form-grid"><Field label="代理用户名"><input maxLength={128} value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} autoComplete="username" /></Field><Field label="代理密码" hint={value?.credential.fields.includes('proxyPassword') ? '已保存；留空保持不变' : '可选，保存后不可读回'}><input type="password" autoComplete="new-password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /></Field></div>
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    <div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" onClick={onClose}>取消</button><button className="dsh-ssh-primary-button" disabled={saving}>{saving ? '正在保存…' : '保存代理'}</button></div>
  </form></Dialog>
}

function SettingsPane(): JSX.Element {
  const [settings, setSettings] = useState<SettingsView>()
  const [error, setError] = useState<string>()
  useEffect(() => { void api<SettingsView>('/settings').then(setSettings).catch(reason => setError(message(reason))) }, [])
  const save = async (next: SettingsView): Promise<void> => { try { setSettings(await api('/settings', { method: 'PUT', body: JSON.stringify(next) })) } catch (reason) { setError(message(reason)) } }
  return <div className="dsh-ssh-settings-pane"><div className="dsh-ssh-content-heading"><div><h1>SSH 设置</h1><p>安全边界和 AI 命令输出限制</p></div></div>
    {settings && <div className="dsh-ssh-settings-group">
      <label className="dsh-ssh-switch-row"><span><strong>允许公开端口绑定</strong><small>允许转发监听 0.0.0.0 或其他非回环地址。仅在明确配置防火墙后开启。</small></span><input type="checkbox" checked={settings.allowPublicBind} onChange={event => { void save({ ...settings, allowPublicBind: event.target.checked }) }} /></label>
      <label className="dsh-ssh-number-row"><span><strong>默认命令超时</strong><small>AI 的 ssh_exec 最长等待时间</small></span><input type="number" min="1000" max="300000" step="1000" value={settings.defaultCommandTimeoutMs} onChange={event => setSettings({ ...settings, defaultCommandTimeoutMs: Number(event.target.value) })} onBlur={() => { void save(settings) }} /><em>毫秒</em></label>
      <label className="dsh-ssh-number-row"><span><strong>最大命令输出</strong><small>超出后保留最新输出，避免挤占上下文</small></span><input type="number" min="1000" max="1000000" step="1000" value={settings.maxOutputChars} onChange={event => setSettings({ ...settings, maxOutputChars: Number(event.target.value) })} onBlur={() => { void save(settings) }} /><em>字符</em></label>
    </div>}{error && <p className="dsh-ssh-inline-error">{error}</p>}
  </div>
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
  return <Dialog title={value === undefined ? '新建端口转发' : `编辑 ${value.name}`} subtitle={profile.name} onClose={onClose}><form className="dsh-ssh-form" onSubmit={event => { void submit(event) }}>
    <Field label="名称"><input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></Field>
    <Field label="类型"><select value={form.kind} onChange={event => setForm({ ...form, kind: event.target.value as typeof form.kind })}><option value="local">本地转发（L）</option><option value="remote">远程转发（R）</option><option value="dynamic">动态 SOCKS5（D）</option></select></Field>
    <div className="dsh-ssh-form-grid is-host"><Field label="监听地址"><input required value={form.bindHost} onChange={event => setForm({ ...form, bindHost: event.target.value })} /></Field><Field label="监听端口" hint="0 表示自动选择"><input required type="number" min="0" max="65535" value={form.bindPort} onChange={event => setForm({ ...form, bindPort: event.target.value })} /></Field></div>
    {form.kind !== 'dynamic' && <div className="dsh-ssh-form-grid is-host"><Field label="目标主机"><input required value={form.targetHost} onChange={event => setForm({ ...form, targetHost: event.target.value })} /></Field><Field label="目标端口"><input required type="number" min="1" max="65535" value={form.targetPort} onChange={event => setForm({ ...form, targetPort: event.target.value })} /></Field></div>}
    <label className="dsh-ssh-switch-row"><span><strong>自动启动</strong><small>DSH 启动时恢复此转发</small></span><input type="checkbox" checked={form.autoStart} onChange={event => setForm({ ...form, autoStart: event.target.checked })} /></label>
    {error && <p className="dsh-ssh-inline-error">{error}</p>}<div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" onClick={onClose}>取消</button><button className="dsh-ssh-primary-button">保存规则</button></div>
  </form></Dialog>
}

function proxyLabel(profile: ProfileView): string { return profile.proxy.type === 'none' ? '直连' : profile.proxy.type === 'saved' ? '常用代理' : profile.proxy.type === 'jump' ? 'SSH 跳板' : profile.proxy.type === 'http' ? 'HTTP 代理' : 'SOCKS5 代理' }
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
function forwardState(status?: ForwardStatus): string { return status?.state === 'running' ? `运行中 · ${status.connections}` : status?.state === 'starting' ? '启动中' : status?.state === 'error' ? '失败' : '已停止' }

function installStyles(): () => void {
  const previous = document.getElementById(STYLE_ID)
  if (previous !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `${xtermCss}\n${adaptiveUiCss}\n${cssText}\n${remoteWorkspaceCss}\n${hostWorkbenchCss}\n${fileTransferCss}`
  document.head.append(style)
  return () => style.remove()
}
