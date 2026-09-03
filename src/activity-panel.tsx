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
  dispose(): void
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
        if (props.controller.requestedView(sessionId) === 'terminals') props.controller.open(sessionId, undefined, 'local-directory')
        setView(current => current === 'terminals' ? 'local-directory' : current)
      }
      setError(undefined)
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }, [props.controller, sessionId])

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

  return <section className="dsh-ssh-activity-panel" aria-label="SSH Activity">
    <header className="dsh-ssh-activity-header">
      <div className="dsh-ssh-activity-title">
        <span className="dsh-ssh-activity-mark"><ServerGlyph /></span>
        <span><strong>SSH activity</strong><small>Current session · {shortId(sessionId)}</small></span>
      </div>
      <button type="button" className="dsh-ssh-icon-button" aria-label="Close SSH Activity" onClick={() => props.controller.close(sessionId)}><IconCloseOutline16 size={16} /></button>
    </header>
    {activity && <nav className="dsh-ssh-activity-tabs" aria-label="SSH activity view">
      <button type="button" data-ssh-interactive="choice" className={view === 'local-directory' ? 'is-active' : ''} aria-pressed={view === 'local-directory'} onClick={() => props.controller.open(sessionId, undefined, 'local-directory')}><IconFolderOpenOutline16 size={16} />Session directory</button>
      {activity.profiles.length > 0 && <button type="button" data-ssh-interactive="choice" className={view === 'remote-directory' ? 'is-active' : ''} aria-pressed={view === 'remote-directory'} onClick={() => props.controller.open(sessionId, undefined, 'remote-directory')}><ServerGlyph />Remote directory</button>}
      {activity.injection?.permission === 'terminal' && <button type="button" data-ssh-interactive="choice" className={view === 'terminals' ? 'is-active' : ''} aria-pressed={view === 'terminals'} onClick={() => props.controller.open(sessionId, undefined, 'terminals')}><IconCodeOutline16 size={16} />Terminal{activity.terminals.length > 0 && <em>{activity.terminals.length}</em>}</button>}
    </nav>}
    <div className="dsh-ssh-activity-body">
      {activity === undefined ? <p className="dsh-ssh-activity-state" role="status">Reading SSH sessions…</p>
        : view === 'local-directory' ? <LocalWorkspaceBrowser sessionId={sessionId} />
          : view === 'remote-directory' ? <RemoteDirectoryActivity sessionId={sessionId} profiles={activity.profiles} selectedProfileId={props.controller.selected(sessionId)} onProfile={profileId => props.controller.open(sessionId, profileId, 'remote-directory')} onSaved={refresh} />
            : <TerminalActivity sessionId={sessionId} terminals={activity.terminals} onClosed={refresh} />}
      {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    </div>
  </section>
}

function RemoteDirectoryActivity({ sessionId, profiles, selectedProfileId, onProfile, onSaved }: { sessionId: string; profiles: ActivityProfileView[]; selectedProfileId?: string | undefined; onProfile(id: string): void; onSaved(): Promise<void> }): JSX.Element {
  const profile = profiles.find(item => item.id === selectedProfileId) ?? profiles[0]
  if (profile === undefined) return <div className="dsh-ssh-activity-empty"><IconFolderOpenOutline16 size={22} /><strong>No browsable remotes</strong><p>Allow the current session to access a host in the SSH panel first.</p></div>
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

  if (terminal === undefined) return <div className="dsh-ssh-activity-empty"><IconCodeOutline16 size={22} /><strong>No terminals open yet</strong><p>Terminals opened by the AI appear here directly.</p></div>

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
  const closeLabel = terminal.status.kind === 'running' ? "End" : "Remove"

  return <div className="dsh-ssh-terminal-workbench">
    {terminals.length > 1 && <nav className="dsh-ssh-terminal-switcher dsh-ssh-scroll-surface" aria-label="SSH terminal">{terminals.map((item, index) => {
      const label = item.name || `Terminal ${index + 1}`
      return <button type="button" data-ssh-interactive="choice" title={label} className={item.terminalId === terminal.terminalId ? 'is-active' : ''} aria-pressed={item.terminalId === terminal.terminalId} key={item.terminalId} onClick={() => setSelectedId(item.terminalId)}><span className={`dsh-ssh-terminal-state-dot is-${item.status.kind}`} /><span className="dsh-ssh-terminal-switcher-label">{label}</span></button>
    })}</nav>}
    <div className="dsh-ssh-terminal-observer">
      <div className="dsh-ssh-terminal-observer-heading"><span><strong>{terminal.name}</strong><small>{terminal.cwd}</small></span><div className="dsh-ssh-terminal-observer-actions"><span className={`dsh-ssh-terminal-state is-${terminal.status.kind}`}>{terminal.status.kind === 'running' ? "Running" : "Exited"}</span><button type="button" className="dsh-ssh-terminal-close" disabled={closingId !== undefined} aria-label={`${closeLabel}Terminal ${terminal.name}`} title={terminal.status.kind === 'running' ? "End and close this terminal" : "Remove this terminal from the activity panel"} onClick={() => { void closeSelectedTerminal() }}><IconCloseOutline16 size={14} /><span>{closingId === terminal.terminalId ? "Processing" : closeLabel}</span></button></div></div>
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

  return <div className="dsh-ssh-terminal-screen" aria-label="Interactive SSH terminal"><div ref={hostRef} className="dsh-ssh-terminal-viewport" /></div>
}
