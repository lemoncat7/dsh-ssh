import { useCallback, useEffect, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconCloseOutline16,
  IconCodeOutline16,
  IconFolderOpenOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import {
  activityTerminalStreamUrl,
  closeActivityTerminal,
  loadActivity,
  readActivityTerminalOutput,
  resizeActivityTerminal,
  sendActivityTerminalInput,
  type ActivityProfileView,
  type ActivityTerminalView,
  type ActivityView,
} from './client-api.js'
import { ActivitySftpBrowser, LocalWorkspaceBrowser } from './sftp-client.js'
import { TerminalTransport } from './terminal-transport.js'
import { attachTerminalViewport, createSshTerminal } from './terminal-view.js'
import { ServerGlyph, errorMessage, shortId } from './ui-components.js'

type DetailsProps = PropsRuntime<'details'>

export type ActivityViewMode = 'local-directory' | 'remote-directory' | 'terminals'

export interface ActivityController {
  open(sessionId: string, profileId?: string, view?: ActivityViewMode): void
  toggle(sessionId: string): void
  close(sessionId?: string): void
  isOpen(sessionId: string): boolean
  selected(sessionId: string): string | undefined
  requestedView(sessionId: string): ActivityViewMode | undefined
  subscribe(listener: () => void): () => void
}

export function SshActivityPanel(props: DetailsProps & { controller: ActivityController }): JSX.Element {
  const sessionId = String(props.sessionId)
  const [activity, setActivity] = useState<ActivityView>()
  const [view, setView] = useState<ActivityViewMode>(() => props.controller.requestedView(sessionId) ?? 'local-directory')
  const [error, setError] = useState<string>()

  useEffect(() => props.controller.subscribe(() => {
    const requested = props.controller.requestedView(sessionId)
    if (requested !== undefined) setView(requested)
  }), [props.controller, sessionId])

  const refresh = useCallback(async () => {
    try {
      const next = await loadActivity(sessionId)
      setActivity(next)
      if (next.injection?.permission !== 'terminal') {
        setView(current => current === 'terminals' ? 'local-directory' : current)
      }
      setError(undefined)
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }, [sessionId])

  useEffect(() => {
    let disposed = false
    let timer: number | undefined
    let polling = false
    const poll = async (): Promise<void> => {
      if (polling) return
      polling = true
      await refresh()
      polling = false
      if (disposed) return
      const foregroundDelay = view === 'terminals' ? 2200 : 3200
      timer = window.setTimeout(() => { void poll() }, document.visibilityState === 'hidden' ? 12000 : foregroundDelay)
    }
    const resume = (): void => {
      if (document.visibilityState !== 'visible' || disposed) return
      if (timer !== undefined) window.clearTimeout(timer)
      timer = undefined
      void poll()
    }
    document.addEventListener('visibilitychange', resume)
    void poll()
    return () => {
      disposed = true
      if (timer !== undefined) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [refresh, view])

  return <section className="dsh-ssh-activity-panel" aria-label="SSH 活动">
    <header className="dsh-ssh-activity-header">
      <div className="dsh-ssh-activity-title">
        <span className="dsh-ssh-activity-mark"><ServerGlyph /></span>
        <span><strong>SSH 活动</strong><small>当前会话 · {shortId(sessionId)}</small></span>
      </div>
      <button type="button" className="dsh-ssh-icon-button" aria-label="关闭 SSH 活动" onClick={() => props.controller.close(sessionId)}><IconCloseOutline16 size={16} /></button>
    </header>
    {activity && <nav className="dsh-ssh-activity-tabs" aria-label="SSH 活动视图">
      <button type="button" data-ssh-interactive="choice" className={view === 'local-directory' ? 'is-active' : ''} aria-pressed={view === 'local-directory'} onClick={() => setView('local-directory')}><IconFolderOpenOutline16 size={16} />会话目录</button>
      {activity.profiles.length > 0 && <button type="button" data-ssh-interactive="choice" className={view === 'remote-directory' ? 'is-active' : ''} aria-pressed={view === 'remote-directory'} onClick={() => setView('remote-directory')}><ServerGlyph />远端目录</button>}
      {activity.injection?.permission === 'terminal' && <button type="button" data-ssh-interactive="choice" className={view === 'terminals' ? 'is-active' : ''} aria-pressed={view === 'terminals'} onClick={() => setView('terminals')}><IconCodeOutline16 size={16} />终端{activity.terminals.length > 0 && <em>{activity.terminals.length}</em>}</button>}
    </nav>}
    <div className="dsh-ssh-activity-body">
      {activity === undefined ? <p className="dsh-ssh-activity-state" role="status">正在读取 SSH 会话…</p>
        : view === 'local-directory' ? <LocalWorkspaceBrowser sessionId={sessionId} />
          : view === 'remote-directory' ? <RemoteDirectoryActivity sessionId={sessionId} profiles={activity.profiles} selectedProfileId={props.controller.selected(sessionId)} onProfile={profileId => props.controller.open(sessionId, profileId, 'remote-directory')} onSaved={refresh} />
            : <TerminalActivity sessionId={sessionId} terminals={activity.terminals} onClosed={refresh} />}
      {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    </div>
  </section>
}

function RemoteDirectoryActivity({ sessionId, profiles, selectedProfileId, onProfile, onSaved }: { sessionId: string; profiles: ActivityProfileView[]; selectedProfileId?: string | undefined; onProfile(id: string): void; onSaved(): Promise<void> }): JSX.Element {
  const profile = profiles.find(item => item.id === selectedProfileId) ?? profiles[0]
  if (profile === undefined) return <div className="dsh-ssh-activity-empty"><IconFolderOpenOutline16 size={22} /><strong>没有可浏览的远端</strong><p>请先在 SSH 面板中允许当前会话访问一台主机。</p></div>
  return <ActivitySftpBrowser key={profile.id} sessionId={sessionId} profile={profile} profiles={profiles} onProfile={onProfile} onSaved={onSaved} />
}

function TerminalActivity({ sessionId, terminals, onClosed }: { sessionId: string; terminals: ActivityTerminalView[]; onClosed(): Promise<void> }): JSX.Element {
  const preferred = [...terminals].reverse().find(item => item.status.kind === 'running') ?? terminals.at(-1)
  const [selectedId, setSelectedId] = useState(preferred?.terminalId)
  const [closingId, setClosingId] = useState<string>()
  const [error, setError] = useState<string>()
  const terminal = terminals.find(item => item.terminalId === selectedId) ?? preferred

  useEffect(() => {
    if (selectedId === undefined || !terminals.some(item => item.terminalId === selectedId)) {
      setSelectedId(preferred?.terminalId)
    }
  }, [preferred?.terminalId, selectedId, terminals])

  if (terminal === undefined) return <div className="dsh-ssh-activity-empty"><IconCodeOutline16 size={22} /><strong>还没有打开的终端</strong><p>AI 打开交互终端后，会直接显示在这里。</p></div>

  const closeSelectedTerminal = async (): Promise<void> => {
    if (closingId !== undefined) return
    setClosingId(terminal.terminalId)
    setError(undefined)
    try {
      await closeActivityTerminal(sessionId, terminal.terminalId)
      await onClosed()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setClosingId(undefined)
    }
  }
  const closeLabel = terminal.status.kind === 'running' ? '结束' : '移除'

  return <div className="dsh-ssh-terminal-workbench">
    {terminals.length > 1 && <nav className="dsh-ssh-terminal-switcher dsh-ssh-scroll-surface" aria-label="SSH 终端">{terminals.map((item, index) => {
      const label = item.name || `终端 ${index + 1}`
      return <button type="button" data-ssh-interactive="choice" title={label} className={item.terminalId === terminal.terminalId ? 'is-active' : ''} aria-pressed={item.terminalId === terminal.terminalId} key={item.terminalId} onClick={() => setSelectedId(item.terminalId)}><span className={`dsh-ssh-terminal-state-dot is-${item.status.kind}`} /><span className="dsh-ssh-terminal-switcher-label">{label}</span></button>
    })}</nav>}
    <div className="dsh-ssh-terminal-observer">
      <div className="dsh-ssh-terminal-observer-heading"><span><strong>{terminal.name}</strong><small>{terminal.cwd}</small></span><div className="dsh-ssh-terminal-observer-actions"><span className={`dsh-ssh-terminal-state is-${terminal.status.kind}`}>{terminal.status.kind === 'running' ? '运行中' : '已退出'}</span><button type="button" className="dsh-ssh-terminal-close" disabled={closingId !== undefined} aria-label={`${closeLabel}终端 ${terminal.name}`} title={terminal.status.kind === 'running' ? '结束并关闭这个终端' : '从活动面板移除这个终端'} onClick={() => { void closeSelectedTerminal() }}><IconCloseOutline16 size={14} /><span>{closingId === terminal.terminalId ? '处理中' : closeLabel}</span></button></div></div>
      <InteractiveTerminal key={terminal.terminalId} sessionId={sessionId} terminal={terminal} onError={setError} />
    </div>
    {error && <p className="dsh-ssh-terminal-input-error" role="alert">{error}</p>}
  </div>
}

function InteractiveTerminal({ sessionId, terminal: activity, onError }: { sessionId: string; terminal: ActivityTerminalView; onError(value: string | undefined): void }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal>()

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const terminal = createSshTerminal({ compact: true, readOnly: activity.status.kind !== 'running', scrollback: 4000 })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host)
    terminalRef.current = terminal
    terminal.focus()
    const transport = new TerminalTransport({
      streamUrl: activityTerminalStreamUrl(sessionId, activity.terminalId),
      read: cursor => readActivityTerminalOutput(sessionId, activity.terminalId, cursor),
      send: (text, sequence) => sendActivityTerminalInput(sessionId, activity.terminalId, text, sequence),
    })
    const input = terminal.onData(data => transport.sendInput(data, reason => onError(errorMessage(reason))))
    const stopOutput = transport.observe({
      output: value => {
        if (value.truncated) terminal.reset()
        if (value.data) terminal.write(value.data)
        terminal.scrollToBottom()
        onError(undefined)
      },
      error: reason => onError(errorMessage(reason)),
    })
    const viewport = attachTerminalViewport(host, terminal, fit, (cols, rows) => {
      void resizeActivityTerminal(sessionId, activity.terminalId, cols, rows).catch(reason => onError(errorMessage(reason)))
    })
    return () => {
      stopOutput()
      transport.dispose()
      input.dispose()
      viewport.dispose()
      terminal.dispose()
      terminalRef.current = undefined
    }
  }, [activity.terminalId, onError, sessionId])

  useEffect(() => {
    const terminal = terminalRef.current
    if (terminal !== undefined) terminal.options.disableStdin = activity.status.kind !== 'running'
  }, [activity.status.kind])

  return <div className="dsh-ssh-terminal-screen" aria-label="交互式 SSH 终端"><div ref={hostRef} className="dsh-ssh-terminal-viewport" /></div>
}
