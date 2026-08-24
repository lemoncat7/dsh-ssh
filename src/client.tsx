import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { AdaptiveWorkspace } from '@lemoncat7/dsh-plugin-ui'
import adaptiveUiCss from '@lemoncat7/dsh-plugin-ui/styles.css'
import {
  IconCheckOutline14, IconChevronDownOutline14, IconCloseOutline16, IconCodeOutline16, IconDataOutline16,
  IconEditOutline16, IconFolderClose16, IconFolderOpenOutline16, IconPanelLeftOutline16, IconPlusOutline16,
  IconSettingsOutline16, IconStopFill16, IconTrashOutline16, IconChevronLeftOutline14,
  IconChevronUpOutline14,
  IconUserOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import xtermCss from '@xterm/xterm/css/xterm.css'
import cssText from './client.css'
import {
  ApiError, api, loadActivity, loadForwards, loadInjection, loadProfiles, loadVaultEntries,
  profileAddress, resizeActivityTerminal, sendActivityTerminalInput,
  type ActivityProfileView, type ActivityTerminalView, type ActivityView, type ForwardStatus, type ForwardView,
  type InjectionView, type ProfileView, type SettingsView, type VaultEntryView,
} from './client-api.js'
import { useWorkspaceTopAnchor } from './sidebar-anchor.js'
import { ActivitySftpBrowser, ProfileSftpPane } from './sftp-client.js'

const PLUGIN_ID = '@lemoncat7/dsh-ssh'
const STYLE_ID = `${PLUGIN_ID}/client`
type SidebarActionProps = PropsRuntime<'sidebar.footer.action'>
type ConversationProps = PropsRuntime<'conversation'>
type DetailsProps = PropsRuntime<'details'>

interface RemoteController {
  open(profileId?: string): void
  toggle(): void
  close(): void
  isOpen(): boolean
  selected(): string | undefined
  subscribe(listener: () => void): () => void
}

interface ActivityController {
  open(sessionId: string, profileId?: string): void
  toggle(sessionId: string): void
  close(sessionId?: string): void
  isOpen(sessionId: string): boolean
  selected(sessionId: string): string | undefined
  subscribe(listener: () => void): () => void
}

export const inject = ['slots', 'layout']

export function apply(ctx: ClientContext): void {
  ctx.effect(installStyles, 'dsh-ssh: styles')
  const activityController = createActivityController(ctx)
  const controller = createController(ctx, () => activityController.close())
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
  const listeners = new Set<() => void>()
  let selected: string | undefined
  let dispose: (() => void) | undefined
  const notify = (): void => { for (const listener of listeners) listener() }
  const controller: RemoteController = {
    open(profileId) {
      beforeOpen()
      if (profileId !== undefined) selected = profileId
      if (dispose === undefined) {
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
  }
  return controller
}

function createActivityController(ctx: ClientContext): ActivityController {
  const listeners = new Set<() => void>()
  let openSessionId: string | undefined
  let selectedProfileId: string | undefined
  let dispose: (() => void) | undefined
  const notify = (): void => { for (const listener of listeners) listener() }
  const controller: ActivityController = {
    open(sessionId, profileId) {
      if (dispose !== undefined && openSessionId === sessionId) {
        if (profileId !== undefined) selectedProfileId = profileId
        ctx.layout.openDetails()
        notify()
        return
      }
      controller.close()
      openSessionId = sessionId
      selectedProfileId = profileId
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
      current?.()
      if (current !== undefined) ctx.layout.closeDetails()
      notify()
    },
    isOpen: sessionId => dispose !== undefined && openSessionId === sessionId,
    selected: sessionId => openSessionId === sessionId ? selectedProfileId : undefined,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
  }
  return controller
}

function SshActivityPanel(props: DetailsProps & { controller: ActivityController }): JSX.Element {
  const sessionId = String(props.sessionId)
  const [activity, setActivity] = useState<ActivityView>()
  const [view, setView] = useState<'directory' | 'terminals'>('directory')
  const [error, setError] = useState<string>()
  const [, setRevision] = useState(0)
  useEffect(() => props.controller.subscribe(() => setRevision(value => value + 1)), [props.controller])
  const refresh = useCallback(async () => {
    try {
      const next = await loadActivity(sessionId)
      setActivity(next)
      if (next.injection?.permission !== 'terminal') setView('directory')
      setError(undefined)
    } catch (reason) { setError(message(reason)) }
  }, [props.controller, sessionId])
  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, view === 'terminals' ? 800 : 2500)
    return () => clearInterval(timer)
  }, [refresh, view])
  return <section className="dsh-ssh-activity-panel" aria-label="SSH 活动">
    <header className="dsh-ssh-activity-header">
      <span><strong>SSH 活动</strong><small>当前会话 · {shortId(sessionId)}</small></span>
      <button type="button" className="dsh-ssh-icon-button" aria-label="关闭 SSH 活动" onClick={() => props.controller.close(sessionId)}><IconCloseOutline16 size={16} /></button>
    </header>
    {activity?.injection && <nav className="dsh-ssh-activity-tabs" aria-label="SSH 活动视图">
      <button type="button" className={view === 'directory' ? 'is-active' : ''} aria-pressed={view === 'directory'} onClick={() => setView('directory')}><IconFolderOpenOutline16 size={16} />目录</button>
      {activity.injection.permission === 'terminal' && <button type="button" className={view === 'terminals' ? 'is-active' : ''} aria-pressed={view === 'terminals'} onClick={() => setView('terminals')}><IconCodeOutline16 size={16} />终端{activity.terminals.length > 0 && <em>{activity.terminals.length}</em>}</button>}
    </nav>}
    <div className="dsh-ssh-activity-body">
      {activity === undefined ? <p className="dsh-ssh-activity-state">正在读取 SSH 会话…</p>
        : activity.injection === null ? <div className="dsh-ssh-activity-empty"><IconFolderOpenOutline16 size={22} /><strong>当前会话尚未连接远端</strong><p>从左侧「远端」列表打开一台主机，并授权给当前会话后即可浏览目录和终端。</p></div>
          : view === 'directory' ? <DirectoryActivity sessionId={sessionId} profiles={activity.profiles} selectedProfileId={props.controller.selected(sessionId)} onProfile={profileId => props.controller.open(sessionId, profileId)} onSaved={refresh} />
            : <TerminalActivity sessionId={sessionId} terminals={activity.terminals} />}
      {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    </div>
  </section>
}

function DirectoryActivity({ sessionId, profiles, selectedProfileId, onProfile, onSaved }: { sessionId: string; profiles: ActivityProfileView[]; selectedProfileId?: string | undefined; onProfile(id: string): void; onSaved(): Promise<void> }): JSX.Element {
  const profile = profiles.find(item => item.id === selectedProfileId) ?? profiles[0]
  if (profile === undefined) return <div className="dsh-ssh-activity-empty"><IconFolderOpenOutline16 size={22} /><strong>没有可浏览的远端</strong><p>请先向当前会话注入一个 SSH 连接。</p></div>
  return <ActivitySftpBrowser key={profile.id} sessionId={sessionId} profile={profile} profiles={profiles} onProfile={onProfile} onSaved={onSaved} />
}

function TerminalActivity({ sessionId, terminals }: { sessionId: string; terminals: ActivityTerminalView[] }): JSX.Element {
  const preferred = [...terminals].reverse().find(item => item.status.kind === 'running') ?? terminals.at(-1)
  const [selectedId, setSelectedId] = useState(preferred?.terminalId)
  const [error, setError] = useState<string>()
  const terminal = terminals.find(item => item.terminalId === selectedId) ?? preferred
  useEffect(() => {
    if (selectedId === undefined || !terminals.some(item => item.terminalId === selectedId)) setSelectedId(preferred?.terminalId)
  }, [preferred?.terminalId, selectedId, terminals])
  if (terminal === undefined) return <div className="dsh-ssh-activity-empty"><IconCodeOutline16 size={22} /><strong>还没有打开的终端</strong><p>AI 打开交互终端后，会直接显示在这里。</p></div>
  return <div className="dsh-ssh-terminal-workbench">
    {terminals.length > 1 && <nav className="dsh-ssh-terminal-switcher" aria-label="SSH 终端">{terminals.map((item, index) => <button type="button" className={item.terminalId === terminal.terminalId ? 'is-active' : ''} aria-pressed={item.terminalId === terminal.terminalId} key={item.terminalId} onClick={() => setSelectedId(item.terminalId)}><span className={`dsh-ssh-terminal-state-dot is-${item.status.kind}`} />{item.name || `终端 ${index + 1}`}</button>)}</nav>}
    <div className="dsh-ssh-terminal-observer">
      <div className="dsh-ssh-terminal-observer-heading"><span><strong>{terminal.name}</strong><small>{terminal.cwd}</small></span><span className={`dsh-ssh-terminal-state is-${terminal.status.kind}`}>{terminal.status.kind === 'running' ? '运行中' : '已退出'}</span></div>
      <InteractiveTerminal key={terminal.terminalId} sessionId={sessionId} terminal={terminal} onError={setError} />
    </div>
    {error && <p className="dsh-ssh-terminal-input-error" role="alert">{error}</p>}
  </div>
}

function InteractiveTerminal({ sessionId, terminal: activity, onError }: { sessionId: string; terminal: ActivityTerminalView; onError(value: string | undefined): void }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal>()
  const previousRef = useRef('')
  const inputQueueRef = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const terminal = new Terminal({
      convertEol: true, disableStdin: activity.status.kind !== 'running', cursorBlink: activity.status.kind === 'running', cursorInactiveStyle: 'outline', fontSize: 11, lineHeight: 1.35, scrollback: 4000,
      fontFamily: '"SFMono-Regular", "Cascadia Code", "Liberation Mono", monospace',
      theme: { background: '#111817', foreground: '#dce5e1', cursor: '#77b6a5', selectionBackground: '#547d7855', black: '#111817', green: '#75a998', brightGreen: '#9acabb' },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit); terminal.open(host); fit.fit(); terminalRef.current = terminal; terminal.focus()
    let inputBuffer = ''
    let inputTimer: number | undefined
    let resizeTimer: number | undefined
    let lastSize = ''
    const flushInput = (): void => {
      inputTimer = undefined
      const text = inputBuffer
      inputBuffer = ''
      if (!text) return
      inputQueueRef.current = inputQueueRef.current.catch(() => undefined).then(() => sendActivityTerminalInput(sessionId, activity.terminalId, text)).then(() => onError(undefined), reason => onError(message(reason)))
    }
    const input = terminal.onData(data => {
      inputBuffer += data
      if (inputTimer === undefined) inputTimer = window.setTimeout(flushInput, 12)
    })
    const syncSize = (): void => {
      fit.fit()
      const size = `${terminal.cols}x${terminal.rows}`
      if (size === lastSize) return
      lastSize = size
      void resizeActivityTerminal(sessionId, activity.terminalId, terminal.cols, terminal.rows).catch(reason => onError(message(reason)))
    }
    const resize = new ResizeObserver(() => {
      if (resizeTimer !== undefined) clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(syncSize, 80)
    })
    resize.observe(host)
    return () => {
      if (inputTimer !== undefined) { clearTimeout(inputTimer); flushInput() }
      if (resizeTimer !== undefined) clearTimeout(resizeTimer)
      input.dispose(); resize.disconnect(); terminal.dispose(); terminalRef.current = undefined; previousRef.current = ''
    }
  }, [activity.status.kind, activity.terminalId, onError, sessionId])
  useEffect(() => {
    const terminal = terminalRef.current
    if (terminal === undefined) return
    const previous = previousRef.current
    if (activity.scrollback.startsWith(previous)) terminal.write(activity.scrollback.slice(previous.length))
    else { terminal.reset(); terminal.write(activity.scrollback) }
    previousRef.current = activity.scrollback
    terminal.scrollToBottom()
  }, [activity.scrollback])
  return <div ref={hostRef} className="dsh-ssh-terminal-screen" aria-label="交互式 SSH 终端" />
}

function RemoteSidebar(props: SidebarActionProps & { controller: RemoteController; activityController: ActivityController; collapseSidebar(): void }): JSX.Element {
  const ref = useRef<HTMLElement>(null)
  useWorkspaceTopAnchor(ref)
  const sessionId = props.useSessions(state => state.current)
  const [profiles, setProfiles] = useState<ProfileView[]>([])
  const [injection, setInjection] = useState<InjectionView | null>(null)
  const [open, setOpen] = useState(true)
  const [, setRevision] = useState(0)
  useEffect(() => props.controller.subscribe(() => setRevision(value => value + 1)), [props.controller])
  const refresh = useCallback(async () => {
    const next = await loadProfiles().catch(() => [])
    setProfiles(next)
    setInjection(sessionId === undefined ? null : await loadInjection(String(sessionId)).catch(() => null))
  }, [sessionId])
  useEffect(() => { void refresh() }, [refresh, props.controller.isOpen()])
  const currentSessionId = sessionId === undefined ? undefined : String(sessionId)
  const activityOpen = currentSessionId !== undefined && props.activityController.isOpen(currentSessionId)
  const availableProfiles = injection === null ? [] : injection.profileIds.map(profileId => profiles.find(profile => profile.id === profileId)).filter((profile): profile is ProfileView => profile !== undefined)
  const openActivity = (profileId?: string): void => {
    if (currentSessionId === undefined) return
    props.controller.close()
    props.activityController.open(currentSessionId, profileId)
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
            <span className="dsh-ssh-injected-mark" title="当前会话可用"><IconCheckOutline14 size={12} /></span>
          </button>)}
      {availableProfiles.length > 6 && <button type="button" className="dsh-ssh-sidebar-more" onClick={toggleActivity}>还有 {availableProfiles.length - 6} 台可用远端</button>}
    </div>}
  </section>
}

function RemoteWorkspace(props: ConversationProps & { controller: RemoteController }): JSX.Element {
  const sessionId = props.useSessions(state => state.current)
  const [profiles, setProfiles] = useState<ProfileView[]>([])
  const [vaultEntries, setVaultEntries] = useState<VaultEntryView[]>([])
  const [selectedId, setSelectedId] = useState(props.controller.selected())
  const [view, setView] = useState<'terminal' | 'sftp' | 'forwards' | 'vault' | 'settings'>('terminal')
  const [editing, setEditing] = useState<ProfileView | 'new'>()
  const [refreshKey, setRefreshKey] = useState(0)
  const [error, setError] = useState<string>()
  const openedSessionRef = useRef(sessionId)
  const refresh = useCallback(async () => {
    try {
      const [next, credentials] = await Promise.all([loadProfiles(), loadVaultEntries()])
      setProfiles(next)
      setVaultEntries(credentials)
      setSelectedId(current => current !== undefined && next.some(item => item.id === current) ? current : next[0]?.id)
      setError(undefined)
    } catch (reason) { setError(message(reason)) }
  }, [])
  useEffect(() => {
    const sync = (): void => {
      const next = props.controller.selected()
      if (next !== undefined) setSelectedId(next)
    }
    sync()
    return props.controller.subscribe(sync)
  }, [props.controller])
  useEffect(() => { void refresh() }, [refresh, refreshKey])
  useEffect(() => {
    if (openedSessionRef.current !== sessionId) props.controller.close()
  }, [props.controller, sessionId])
  const selected = profiles.find(item => item.id === selectedId)
  const toolbar = <header className="dsh-ssh-toolbar">
      <div className="dsh-ssh-brand"><button type="button" className="dsh-ssh-icon-button" aria-label="返回会话" title="返回会话" onClick={() => props.controller.close()}><IconChevronLeftOutline14 size={15} /></button><span className="dsh-ssh-brand-glyph"><ServerGlyph /></span><span><strong>远端</strong><small>SSH 会话与转发</small></span></div>
      <nav className="dsh-ssh-segments" aria-label="远端视图">
        <Segment active={view === 'terminal'} onClick={() => setView('terminal')}>终端</Segment>
        <Segment active={view === 'sftp'} onClick={() => setView('sftp')}>SFTP</Segment>
        <Segment active={view === 'forwards'} onClick={() => setView('forwards')}>端口转发</Segment>
        <Segment active={view === 'vault'} onClick={() => setView('vault')}>密钥库</Segment>
        <Segment active={view === 'settings'} onClick={() => setView('settings')}>设置</Segment>
      </nav>
      <button type="button" className="dsh-ssh-primary-button" aria-label="新建连接" onClick={() => setEditing('new')}><IconPlusOutline16 size={16} /><span>新建连接</span></button>
    </header>
  const notice = error && <div className="dsh-ssh-banner is-error" role="alert"><span>{error}</span><button onClick={() => setError(undefined)} aria-label="关闭"><IconCloseOutline16 size={16} /></button></div>
  return <>
    <AdaptiveWorkspace
      className="dsh-ssh-workspace"
      toolbar={toolbar}
      notice={notice}
      navigationLabel="主机"
      navigationIcon={<IconDataOutline16 size={15} />}
      navigation={controls => <ProfileList profiles={profiles} selectedId={selectedId} onSelect={id => { props.controller.open(id); controls.closePanel() }} onNew={() => { setEditing('new'); controls.closePanel() }} />}
      inspectorLabel="会话授权"
      inspectorIcon={<IconUserOutline16 size={15} />}
      inspector={<InjectionInspector sessionId={sessionId === undefined ? undefined : String(sessionId)} profiles={profiles} selected={selected} />}
    >
      <section className="dsh-ssh-main-panel">
        {view === 'vault' ? <VaultPane entries={vaultEntries} onChanged={() => setRefreshKey(value => value + 1)} />
          : selected === undefined ? <EmptyState onNew={() => setEditing('new')} />
          : view === 'terminal' ? <TerminalPane profile={selected} onEdit={() => setEditing(selected)} />
            : view === 'sftp' ? <ProfileSftpPane key={selected.id} profile={selected} />
              : view === 'forwards' ? <ForwardPane profiles={profiles} selected={selected} />
                : <SettingsPane />}
      </section>
    </AdaptiveWorkspace>
    {editing !== undefined && <ProfileEditor profile={editing === 'new' ? undefined : editing} profiles={profiles} vaultEntries={vaultEntries} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); setRefreshKey(value => value + 1) }} />}
  </>
}

function ProfileList({ profiles, selectedId, onSelect, onNew }: { profiles: ProfileView[]; selectedId?: string | undefined; onSelect(id: string): void; onNew(): void }): JSX.Element {
  const [query, setQuery] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const groups = useMemo(() => groupProfiles(profiles.filter(profile => profileSearchText(profile).includes(normalizedQuery))), [normalizedQuery, profiles])
  const selectedGroup = profiles.find(profile => profile.id === selectedId)?.group?.trim() || '未分组'
  useEffect(() => {
    if (selectedId === undefined) return
    setCollapsedGroups(current => {
      if (!current.has(selectedGroup)) return current
      const next = new Set(current)
      next.delete(selectedGroup)
      return next
    })
  }, [selectedGroup, selectedId])
  const toggleGroup = (name: string): void => {
    setCollapsedGroups(current => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }
  return <aside className="dsh-ssh-profile-panel">
    <div className="dsh-ssh-panel-heading"><span><strong>主机</strong><small>{groups.length} 个分组 · {profiles.length} 台主机</small></span><button className="dsh-ssh-icon-button" onClick={onNew} aria-label="新建连接"><IconPlusOutline16 size={16} /></button></div>
    <label className="dsh-ssh-search"><span className="sr-only">搜索连接</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索主机、分组、标签…" /></label>
    <div className="dsh-ssh-profile-list">
      {groups.map(group => <ProfileGroup key={group.name} group={group} open={normalizedQuery !== '' || !collapsedGroups.has(group.name)} selectedId={selectedId} onToggle={() => toggleGroup(group.name)} onSelect={onSelect} />)}
      {groups.length === 0 && <p className="dsh-ssh-profile-empty">{profiles.length === 0 ? '还没有 SSH 主机' : '没有匹配的主机'}</p>}
    </div>
  </aside>
}

interface ProfileGroupView { name: string; profiles: ProfileView[] }

function groupProfiles(profiles: ProfileView[]): ProfileGroupView[] {
  const groups = new Map<string, ProfileView[]>()
  for (const profile of profiles) {
    const name = profile.group?.trim() || '未分组'
    const group = groups.get(name)
    if (group === undefined) groups.set(name, [profile])
    else group.push(profile)
  }
  return [...groups].map(([name, groupedProfiles]) => ({ name, profiles: groupedProfiles }))
}

function profileSearchText(profile: ProfileView): string {
  return `${profile.name} ${profile.group ?? ''} ${profile.host} ${profile.username} ${profile.tags.join(' ')}`.toLocaleLowerCase()
}

function ProfileGroup({ group, open, selectedId, onToggle, onSelect }: { group: ProfileGroupView; open: boolean; selectedId?: string | undefined; onToggle(): void; onSelect(id: string): void }): JSX.Element {
  return <section className="dsh-ssh-profile-group">
    <button type="button" className="dsh-ssh-profile-group-heading" aria-expanded={open} onClick={onToggle}>
      <span className="dsh-ssh-profile-group-chevron" data-open={open}><IconChevronDownOutline14 size={12} /></span>
      <span className="dsh-ssh-profile-group-folder">{open ? <IconFolderOpenOutline16 size={15} /> : <IconFolderClose16 size={15} />}</span>
      <span className="dsh-ssh-profile-group-copy"><strong>{group.name}</strong><small>{group.profiles.length}</small></span>
    </button>
    {open && <div className="dsh-ssh-profile-group-children" role="group" aria-label={`${group.name}中的主机`}>
      {group.profiles.map(profile => <button type="button" key={profile.id} className={`dsh-ssh-profile-row${selectedId === profile.id ? ' is-active' : ''}`} onClick={() => onSelect(profile.id)}>
        <span className="dsh-ssh-host-monogram">{profile.name.slice(0, 1).toUpperCase()}</span>
        <span><strong>{profile.name}</strong><small>{profileAddress(profile)}</small></span>
        <span className={`dsh-ssh-credential-state${profile.credential.configured ? ' is-ready' : ''}`} title={profile.credential.configured ? '凭据已配置' : '凭据缺失'} />
      </button>)}
    </div>}
  </section>
}

function TerminalPane({ profile, onEdit }: { profile: ProfileView; onEdit(): void }): JSX.Element {
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
    const terminal = new Terminal({
      convertEol: true, cursorBlink: true, fontSize: 13, lineHeight: 1.35, scrollback: 5000,
      fontFamily: '"SFMono-Regular", "Cascadia Code", "Liberation Mono", monospace',
      theme: { background: '#111817', foreground: '#dce5e1', cursor: '#77b6a5', selectionBackground: '#547d7855', black: '#111817', green: '#75a998', brightGreen: '#9acabb' },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host)
    fit.fit()
    terminalRef.current = terminal; fitRef.current = fit
    const resize = new ResizeObserver(() => { fit.fit(); const id = terminalIdRef.current; if (id !== undefined) void api(`/terminals/${id}/resize`, { method: 'POST', body: JSON.stringify({ cols: terminal.cols, rows: terminal.rows }) }).catch(() => {}) })
    resize.observe(host)
    return () => { resize.disconnect(); terminal.dispose(); terminalRef.current = undefined; fitRef.current = undefined }
  }, [])

  useEffect(() => { terminalIdRef.current = terminalId }, [terminalId])

  useEffect(() => {
    if (terminalId === undefined) return
    const terminal = terminalRef.current
    if (terminal === undefined) return
    const input = terminal.onData(data => { void api(`/terminals/${terminalId}/input`, { method: 'POST', body: JSON.stringify({ text: data }) }).catch(reason => setError(message(reason))) })
    let cursor = 0
    let stopped = false
    const poll = async (): Promise<void> => {
      if (stopped) return
      try {
        const output = await api<{ data: string; cursor: number; truncated: boolean; closed: boolean }>(`/terminals/${terminalId}/output?cursor=${cursor}`)
        if (output.truncated) terminal.write('\r\n\x1b[33m[较早输出已截断]\x1b[0m\r\n')
        if (output.data) terminal.write(output.data)
        cursor = output.cursor
        if (output.closed) { setPhase('idle'); setTerminalId(undefined); return }
      } catch (reason) { if (!stopped) { setError(message(reason)); setPhase('error') } }
      if (!stopped) window.setTimeout(() => { void poll() }, document.hidden ? 800 : 180)
    }
    void poll()
    return () => { stopped = true; input.dispose() }
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
      setTerminalId(result.id); setPhase('connected'); terminal.focus()
    } catch (reason) { setPhase('error'); setError(message(reason)); terminal.write(`\r\n\x1b[31m${message(reason)}\x1b[0m\r\n`) }
  }
  const disconnect = async (): Promise<void> => {
    if (terminalId !== undefined) await api(`/terminals/${terminalId}`, { method: 'DELETE' }).catch(() => {})
    setTerminalId(undefined); setPhase('idle')
  }
  return <div className="dsh-ssh-terminal-pane">
    <div className="dsh-ssh-content-heading">
      <div><div className="dsh-ssh-title-line"><span className={`dsh-ssh-live-dot is-${phase}`} /> <h1>{profile.name}</h1></div><p>{profileAddress(profile)} · {proxyLabel(profile)}</p></div>
      <div className="dsh-ssh-heading-actions">
        <button type="button" className="dsh-ssh-secondary-button" onClick={onEdit}><IconEditOutline16 size={16} />编辑</button>
        {phase === 'connected' ? <button type="button" className="dsh-ssh-danger-button" onClick={() => { void disconnect() }}><IconStopFill16 size={16} />断开</button>
          : <button type="button" className="dsh-ssh-primary-button" disabled={phase === 'connecting'} onClick={() => { void connect() }}>{phase === 'connecting' ? '连接中…' : '打开终端'}</button>}
      </div>
    </div>
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    <div className="dsh-ssh-terminal-frame"><div ref={hostRef} className="dsh-ssh-xterm" /><div className="dsh-ssh-terminal-status"><span>{phase === 'connected' ? '已连接' : phase === 'connecting' ? '正在建立安全连接' : '终端未连接'}</span><span>UTF-8 · {profile.terminalType}</span></div></div>
  </div>
}

function InjectionInspector({ sessionId, profiles, selected }: { sessionId?: string | undefined; profiles: ProfileView[]; selected?: ProfileView | undefined }): JSX.Element {
  const [value, setValue] = useState<InjectionView | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const valueRef = useRef<InjectionView | null>(null)
  const sessionRef = useRef(sessionId)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const pendingSavesRef = useRef(0)
  sessionRef.current = sessionId
  useEffect(() => {
    let cancelled = false
    valueRef.current = null
    setValue(null)
    setSaving(false)
    setError(undefined)
    if (sessionId !== undefined) void loadInjection(sessionId).then(stored => {
      if (cancelled || valueRef.current !== null) return
      valueRef.current = stored
      setValue(stored)
    }).catch(reason => { if (!cancelled) setError(message(reason)) })
    return () => { cancelled = true }
  }, [sessionId])
  const model = value ?? (sessionId === undefined ? null : { sessionId, profileIds: [], permission: 'terminal' as const, requireCommandApproval: true, workingDirectories: {}, updatedAt: 0 })
  const save = (next: InjectionView): void => {
    const targetSessionId = sessionId
    if (targetSessionId === undefined) return
    valueRef.current = next
    setValue(next)
    setError(undefined)
    pendingSavesRef.current += 1
    setSaving(true)
    const request = saveQueueRef.current.catch(() => undefined).then(async () => {
      const stored = await api<InjectionView>(`/injections/${encodeURIComponent(targetSessionId)}`, { method: 'PUT', body: JSON.stringify(next) })
      if (sessionRef.current === targetSessionId && valueRef.current === next) {
        valueRef.current = stored
        setValue(stored)
      }
    })
    saveQueueRef.current = request.catch(() => undefined)
    void request.catch(reason => {
      if (sessionRef.current === targetSessionId) setError(message(reason))
    }).finally(() => {
      pendingSavesRef.current = Math.max(0, pendingSavesRef.current - 1)
      if (sessionRef.current === targetSessionId && pendingSavesRef.current === 0) setSaving(false)
    })
  }
  const update = (patch: Partial<Pick<InjectionView, 'profileIds' | 'permission' | 'requireCommandApproval'>>): void => {
    const current = valueRef.current ?? model
    if (current !== null) save({ ...current, ...patch })
  }
  const toggle = (profileId: string): void => {
    const current = valueRef.current ?? model
    if (current === null) return
    const profileIds = current.profileIds.includes(profileId) ? current.profileIds.filter(id => id !== profileId) : [...current.profileIds, profileId]
    update({ profileIds })
  }
  return <aside className="dsh-ssh-inspector">
    <div className="dsh-ssh-panel-heading"><span><strong>会话注入</strong><small>{sessionId === undefined ? '当前没有会话' : '仅对当前对话生效'}</small></span></div>
    {sessionId === undefined ? <div className="dsh-ssh-inspector-empty">先打开一个 DSH 会话，再选择允许 AI 使用的远端连接。</div> : <>
      <div className="dsh-ssh-session-chip"><span className="dsh-ssh-session-pulse" /><span><strong>当前会话</strong><small>{shortId(sessionId)}</small></span></div>
      <fieldset className="dsh-ssh-fieldset"><legend>可用连接</legend>
        {profiles.map(profile => <label className="dsh-ssh-check-row" key={profile.id}><input type="checkbox" checked={model?.profileIds.includes(profile.id) === true} onChange={() => toggle(profile.id)} /><span><strong>{profile.name}</strong><small>{profile.host}</small></span></label>)}
      </fieldset>
      <fieldset className="dsh-ssh-fieldset"><legend>权限</legend>
        <label className="dsh-ssh-radio-row"><input type="radio" name="dsh-ssh-injection-permission" checked={model?.permission === 'exec'} onChange={() => update({ permission: 'exec' })} /><span><strong>仅执行命令</strong><small>允许 ssh_exec，不开放交互终端</small></span></label>
        <label className="dsh-ssh-radio-row"><input type="radio" name="dsh-ssh-injection-permission" checked={model?.permission === 'terminal'} onChange={() => update({ permission: 'terminal' })} /><span><strong>终端控制</strong><small>可打开、读取和操作交互终端</small></span></label>
      </fieldset>
      <label className="dsh-ssh-switch-row"><span><strong>自动允许 SSH 操作</strong><small>开启后，AI 可在上述权限范围内直接执行；关闭后每次操作都需要手动批准。</small></span><input type="checkbox" checked={model?.requireCommandApproval === false} onChange={event => update({ requireCommandApproval: !event.target.checked })} /></label>
      {selected && <p className="dsh-ssh-inspector-hint">选中的连接：<strong>{selected.name}</strong></p>}
      {saving && <p className="dsh-ssh-save-state" role="status">正在保存…</p>}{error && <p className="dsh-ssh-inline-error">{error}</p>}
    </>}
  </aside>
}

function ForwardPane({ profiles, selected }: { profiles: ProfileView[]; selected: ProfileView }): JSX.Element {
  const [rules, setRules] = useState<ForwardView[]>([])
  const [statuses, setStatuses] = useState<ForwardStatus[]>([])
  const [editing, setEditing] = useState<ForwardView | 'new'>()
  const [error, setError] = useState<string>()
  const refresh = useCallback(async () => { try { const result = await loadForwards(); setRules(result.rules); setStatuses(result.statuses) } catch (reason) { setError(message(reason)) } }, [])
  useEffect(() => { void refresh(); const timer = window.setInterval(() => { void refresh() }, 3000); return () => clearInterval(timer) }, [refresh])
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

function ProfileEditor({ profile, profiles, vaultEntries, onClose, onSaved }: { profile?: ProfileView | undefined; profiles: ProfileView[]; vaultEntries: VaultEntryView[]; onClose(): void; onSaved(): void }): JSX.Element {
  const [form, setForm] = useState(() => ({
    name: profile?.name ?? '', group: profile?.group ?? '', host: profile?.host ?? '', port: String(profile?.port ?? 22), username: profile?.username ?? '', authType: profile?.authType ?? 'password',
    credentialId: profile?.credentialId ?? '',
    proxyType: profile?.proxy.type ?? 'none', proxyHost: profile?.proxy.type === 'http' || profile?.proxy.type === 'socks5' ? profile.proxy.host : '', proxyPort: profile?.proxy.type === 'http' || profile?.proxy.type === 'socks5' ? String(profile.proxy.port) : '1080', proxyUsername: profile?.proxy.type === 'http' || profile?.proxy.type === 'socks5' ? profile.proxy.username ?? '' : '', jumpProfileIds: profile?.proxy.type === 'jump' ? profile.proxy.profileIds : [], tags: profile?.tags.join(', ') ?? '',
    password: '', privateKey: '', passphrase: '', proxyPassword: '', hostFingerprint: profile?.hostFingerprint ?? '',
  }))
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testState, setTestState] = useState<'success'>()
  const [pendingFingerprint, setPendingFingerprint] = useState<string>()
  const [error, setError] = useState<string>()
  const field = (name: Exclude<keyof typeof form, 'jumpProfileIds'>) => ({ value: form[name], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm(value => ({ ...value, [name]: event.target.value }))
    setTestState(undefined); setPendingFingerprint(undefined)
  } })
  const selectedCredential = vaultEntries.find(entry => entry.id === form.credentialId)
  const buildPayload = (hostFingerprint = form.hostFingerprint) => {
    const proxy = form.proxyType === 'none' ? { type: 'none' }
      : form.proxyType === 'jump' ? { type: 'jump', profileIds: form.jumpProfileIds }
        : { type: form.proxyType, host: form.proxyHost, port: Number(form.proxyPort), ...(form.proxyUsername.trim() ? { username: form.proxyUsername.trim() } : {}) }
    return {
      profile: { name: form.name, ...(form.group.trim() ? { group: form.group.trim() } : {}), host: form.host, port: Number(form.port), username: selectedCredential?.username ?? form.username, authType: selectedCredential?.authType ?? form.authType, ...(form.credentialId ? { credentialId: form.credentialId } : {}), ...(hostFingerprint ? { hostFingerprint } : {}), proxy, keepAliveIntervalMs: profile?.keepAliveIntervalMs ?? 15000, connectTimeoutMs: profile?.connectTimeoutMs ?? 15000, terminalType: profile?.terminalType ?? 'xterm-256color', tags: form.tags.split(',').map(item => item.trim()).filter(Boolean) },
      secrets: { password: form.password, privateKey: form.privateKey, passphrase: form.passphrase, proxyPassword: form.proxyPassword },
    }
  }
  const testConnection = async (confirmedFingerprint?: string): Promise<void> => {
    setTesting(true); setError(undefined); setTestState(undefined); setPendingFingerprint(undefined)
    try {
      await api('/profiles/test-draft', { method: 'POST', body: JSON.stringify({ ...buildPayload(confirmedFingerprint), ...(profile === undefined ? {} : { profileId: profile.id }) }) })
      if (confirmedFingerprint !== undefined) setForm(current => ({ ...current, hostFingerprint: confirmedFingerprint }))
      setTestState('success')
    } catch (reason) {
      if (reason instanceof ApiError && reason.body?.code === 'HOST_KEY_REQUIRED' && typeof reason.body.fingerprint === 'string') setPendingFingerprint(reason.body.fingerprint)
      else setError(message(reason))
    } finally { setTesting(false) }
  }
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); setSaving(true); setError(undefined)
    const payload = buildPayload()
    try { await api(profile === undefined ? '/profiles' : `/profiles/${profile.id}`, { method: profile === undefined ? 'POST' : 'PUT', body: JSON.stringify(payload) }); onSaved() }
    catch (reason) { setError(message(reason)) } finally { setSaving(false) }
  }
  return <Dialog title={profile === undefined ? '新建 SSH 连接' : `编辑 ${profile.name}`} subtitle="凭据保存后不会回显" onClose={onClose}>
    <form className="dsh-ssh-form" onSubmit={event => { void submit(event) }}>
      <div className="dsh-ssh-form-grid"><Field label="名称"><input required maxLength={80} placeholder="开发服务器" {...field('name')} /></Field><Field label="分组"><input maxLength={64} placeholder="例如：生产环境" {...field('group')} /></Field></div>
      <div className="dsh-ssh-form-grid is-host"><Field label="主机"><input required placeholder="server.example.com" {...field('host')} /></Field><Field label="端口"><input required type="number" min="1" max="65535" {...field('port')} /></Field></div>
      <Field label="标签" hint="多个标签使用英文逗号分隔。"><input placeholder="production, linux" {...field('tags')} /></Field>
      <Field label="凭据来源" hint="可使用此连接自己的凭据，或引用密钥库中的常用账号。"><select {...field('credentialId')}><option value="">此连接独立保存</option>{vaultEntries.map(entry => <option value={entry.id} key={entry.id}>{entry.name} · {entry.username}</option>)}</select></Field>
      {selectedCredential ? <div className="dsh-ssh-credential-reference"><span><IconUserOutline16 size={16} /></span><span><strong>{selectedCredential.name}</strong><small>{selectedCredential.username} · {selectedCredential.authType === 'password' ? '密码' : '私钥'}</small></span><em>{selectedCredential.credential.configured ? '已就绪' : '缺少凭据'}</em></div> : <>
        <div className="dsh-ssh-form-grid"><Field label="用户名"><input required autoComplete="username" {...field('username')} /></Field><Field label="认证方式"><select {...field('authType')}><option value="password">密码</option><option value="private-key">私钥</option><option value="agent">SSH Agent</option></select></Field></div>
        {form.authType === 'password' && <Field label="密码" hint={profile?.credential.source === 'profile' && profile.credential.fields.includes('password') ? '已保存；留空保持不变' : '保存后不可读回'}><input required={profile === undefined} type="password" autoComplete="new-password" placeholder={profile?.credential.source === 'profile' && profile.credential.fields.includes('password') ? '••••••••' : ''} {...field('password')} /></Field>}
        {form.authType === 'private-key' && <><Field label="私钥" hint={profile?.credential.source === 'profile' && profile.credential.fields.includes('privateKey') ? '已保存；留空保持不变' : '粘贴 OpenSSH/PEM 私钥'}><textarea required={profile === undefined} rows={5} spellCheck={false} {...field('privateKey')} /></Field><Field label="私钥口令"><input type="password" autoComplete="new-password" {...field('passphrase')} /></Field></>}
      </>}
      <div className="dsh-ssh-form-divider"><span>代理</span></div>
      <Field label="连接路径"><select {...field('proxyType')}><option value="none">直连</option><option value="http">HTTP CONNECT</option><option value="socks5">SOCKS5</option><option value="jump">SSH 跳板</option></select></Field>
      {(form.proxyType === 'http' || form.proxyType === 'socks5') && <><div className="dsh-ssh-form-grid is-host"><Field label="代理主机"><input required {...field('proxyHost')} /></Field><Field label="代理端口"><input required type="number" min="1" max="65535" {...field('proxyPort')} /></Field></div><div className="dsh-ssh-form-grid"><Field label="代理用户名"><input {...field('proxyUsername')} /></Field><Field label="代理密码"><input type="password" autoComplete="new-password" {...field('proxyPassword')} /></Field></div></>}
      {form.proxyType === 'jump' && <JumpChainEditor profiles={profiles.filter(item => item.id !== profile?.id)} value={form.jumpProfileIds} onChange={jumpProfileIds => setForm(current => ({ ...current, jumpProfileIds }))} />}
      {pendingFingerprint && <div className="dsh-ssh-test-result is-warning" role="alert"><span><strong>首次连接，请核对主机指纹</strong><code>{pendingFingerprint}</code></span><button type="button" className="dsh-ssh-small-primary" disabled={testing} onClick={() => { void testConnection(pendingFingerprint) }}>确认并重试</button></div>}
      {testState === 'success' && <p className="dsh-ssh-test-result is-success" role="status"><IconCheckOutline14 size={14} />连接测试成功</p>}
      {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
      <div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button dsh-ssh-test-button" disabled={saving || testing} onClick={event => { if (event.currentTarget.form?.reportValidity()) void testConnection() }}>{testing ? '正在测试…' : '测试连接'}</button><button type="button" className="dsh-ssh-secondary-button" onClick={onClose}>取消</button><button className="dsh-ssh-primary-button" disabled={saving || testing}>{saving ? '正在保存…' : '保存连接'}</button></div>
    </form>
  </Dialog>
}

function JumpChainEditor({ profiles, value, onChange }: { profiles: ProfileView[]; value: string[]; onChange(value: string[]): void }): JSX.Element {
  const add = (): void => {
    const next = profiles.find(profile => !value.includes(profile.id))
    if (next !== undefined && value.length < 8) onChange([...value, next.id])
  }
  const update = (index: number, profileId: string): void => onChange(value.map((id, current) => current === index ? profileId : id))
  const move = (index: number, offset: -1 | 1): void => {
    const target = index + offset
    if (target < 0 || target >= value.length) return
    const next = [...value]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    onChange(next)
  }
  return <fieldset className="dsh-ssh-jump-chain"><legend>跳板链</legend><p>连接会按从上到下的顺序逐级建立。</p>
    <div>{value.map((profileId, index) => <div className="dsh-ssh-jump-row" key={`${profileId}-${index}`}><em>{index + 1}</em><select required value={profileId} onChange={event => update(index, event.target.value)}><option value="">选择已有连接</option>{profiles.filter(profile => profile.id === profileId || !value.includes(profile.id)).map(profile => <option value={profile.id} key={profile.id}>{profile.name} · {profile.host}</option>)}</select><button type="button" className="dsh-ssh-icon-button" disabled={index === 0} aria-label="上移跳板" onClick={() => move(index, -1)}><IconChevronUpOutline14 size={14} /></button><button type="button" className="dsh-ssh-icon-button" disabled={index === value.length - 1} aria-label="下移跳板" onClick={() => move(index, 1)}><IconChevronDownOutline14 size={14} /></button><button type="button" className="dsh-ssh-icon-button is-danger" aria-label="移除跳板" onClick={() => onChange(value.filter((_, current) => current !== index))}><IconTrashOutline16 size={15} /></button></div>)}</div>
    {value.length === 0 && <p className="dsh-ssh-jump-empty">至少添加一台跳板主机。</p>}
    <button type="button" className="dsh-ssh-secondary-button" disabled={value.length >= 8 || profiles.every(profile => value.includes(profile.id))} onClick={add}><IconPlusOutline16 size={15} />添加跳板</button>
  </fieldset>
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

function Dialog({ title, subtitle, onClose, children }: { title: string; subtitle?: string | undefined; onClose(): void; children: ReactNode }): JSX.Element {
  return <div className="dsh-ssh-dialog-layer" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className="dsh-ssh-dialog" role="dialog" aria-modal="true" aria-labelledby="dsh-ssh-dialog-title"><header><span><h2 id="dsh-ssh-dialog-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</span><button className="dsh-ssh-icon-button" onClick={onClose} aria-label="关闭"><IconCloseOutline16 size={16} /></button></header>{children}</section></div>
}

function Field({ label, hint, children }: { label: string; hint?: string | undefined; children: ReactNode }): JSX.Element { return <label className="dsh-ssh-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label> }
function Segment({ active, onClick, children }: { active: boolean; onClick(): void; children: ReactNode }): JSX.Element { return <button type="button" className={active ? 'is-active' : ''} onClick={onClick}>{children}</button> }
function EmptyState({ onNew }: { onNew(): void }): JSX.Element { return <div className="dsh-ssh-empty-state"><span><ServerGlyph /></span><h1>连接你的第一台远端主机</h1><p>保存 SSH 配置后，可以在这里打开终端、建立端口转发，并按会话授权给 AI。</p><button className="dsh-ssh-primary-button" onClick={onNew}><IconPlusOutline16 size={16} />新建连接</button></div> }
function ServerGlyph(): JSX.Element { return <span className="dsh-ssh-server-glyph"><IconDataOutline16 size={17} /></span> }

function proxyLabel(profile: ProfileView): string { return profile.proxy.type === 'none' ? '直连' : profile.proxy.type === 'jump' ? 'SSH 跳板' : profile.proxy.type === 'http' ? 'HTTP 代理' : 'SOCKS5 代理' }
function shortId(id: string): string { return id.length <= 16 ? id : `${id.slice(0, 8)}…${id.slice(-5)}` }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }
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
  style.textContent = `${xtermCss}\n${adaptiveUiCss}\n${cssText}`
  document.head.append(style)
  return () => style.remove()
}
