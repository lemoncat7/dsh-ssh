import { useSshLocale } from './use-ssh-locale.js'
import { t } from './i18n.js'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  IconCloseOutlineRegular as IconCloseOutline16,
  IconCodeOutlineRegular as IconCodeOutline16,
  IconFolderOpenOutlineRegular as IconFolderOpenOutline16,
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
import { TerminalTransport, type TerminalObservation } from './terminal-transport.js'
import { attachTerminalViewport, createSshTerminal } from './terminal-view.js'
import { ServerGlyph, errorMessage, shortId } from './ui-components.js'

type DetailsProps = { sessionId?: string; visible?: boolean }

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
  useSshLocale()
  const sessionId = String(props.sessionId)
  const [documentVisible, setDocumentVisible] = useState(() => !document.hidden)
  useEffect(() => {
    const update = (): void => setDocumentVisible(!document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  const visible = props.visible !== false && documentVisible
  const [activity, setActivity] = useState<ActivityView>()
  const [view, setView] = useState<ActivityViewMode>(() => props.controller.requestedView(sessionId) ?? 'local-directory')
  const [error, setError] = useState<string>()

  useEffect(() => props.controller.subscribe(() => {
    const requested = props.controller.requestedView(sessionId)
    if (requested !== undefined) setView(requested)
  }), [props.controller, sessionId])

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await loadActivity(sessionId, signal)
      if (signal?.aborted) return
      setActivity(next)
      if (next.injection?.permission !== 'terminal') {
        if (props.controller.requestedView(sessionId) === 'terminals') props.controller.open(sessionId, undefined, 'local-directory')
        setView(current => current === 'terminals' ? 'local-directory' : current)
      }
      setError(undefined)
    } catch (reason) {
      if (!signal?.aborted) setError(errorMessage(reason))
    }
  }, [props.controller, sessionId])

  useEffect(() => {
    if (!visible) return
    const abort = new AbortController()
    let timer: number | undefined
    const poll = async (): Promise<void> => {
      await refresh(abort.signal)
      if (!abort.signal.aborted) timer = window.setTimeout(() => { void poll() }, view === 'terminals' ? 2200 : 3200)
    }
    void poll()
    return () => {
      abort.abort()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [refresh, view, visible])

  return <section className="dsh-ssh-activity-panel" aria-label={t("activity-panel.sshActivity")}>
    <header className="dsh-ssh-activity-header">
      <div className="dsh-ssh-activity-title">
        <span className="dsh-ssh-activity-mark"><ServerGlyph /></span>
        <span><strong>{t("activity-panel.sshActivity")}</strong><small>{t("activity-panel.currentSession")} {shortId(sessionId)}</small></span>
      </div>
      <button type="button" className="dsh-ssh-icon-button" aria-label={t("activity-panel.closeSshActivity")} onClick={() => props.controller.close(sessionId)}><IconCloseOutline16 size={16} /></button>
    </header>
    {activity && <nav className="dsh-ssh-activity-tabs" aria-label={t("activity-panel.sshActivityView")}>
      <button type="button" data-ssh-interactive="choice" className={view === 'local-directory' ? 'is-active' : ''} aria-pressed={view === 'local-directory'} onClick={() => props.controller.open(sessionId, undefined, 'local-directory')}><IconFolderOpenOutline16 size={16} />{t("activity-panel.sessionDirectory")}</button>
      {activity.profiles.length > 0 && <button type="button" data-ssh-interactive="choice" className={view === 'remote-directory' ? 'is-active' : ''} aria-pressed={view === 'remote-directory'} onClick={() => props.controller.open(sessionId, undefined, 'remote-directory')}><ServerGlyph />{t("activity-panel.remoteDirectory")}</button>}
      {activity.injection?.permission === 'terminal' && <button type="button" data-ssh-interactive="choice" className={view === 'terminals' ? 'is-active' : ''} aria-pressed={view === 'terminals'} onClick={() => props.controller.open(sessionId, undefined, 'terminals')}><IconCodeOutline16 size={16} />{t("activity-panel.terminal")}{activity.terminals.length > 0 && <em>{activity.terminals.length}</em>}</button>}
    </nav>}
    <div className="dsh-ssh-activity-body">
      {activity === undefined ? <p className="dsh-ssh-activity-state" role="status">{t("activity-panel.readingSshSessions")}</p>
        : view === 'local-directory' ? (props.visible !== false && <LocalWorkspaceBrowser sessionId={sessionId} />)
          : view === 'remote-directory' ? (props.visible !== false && <RemoteDirectoryActivity sessionId={sessionId} profiles={activity.profiles} selectedProfileId={props.controller.selected(sessionId)} onProfile={profileId => props.controller.open(sessionId, profileId, 'remote-directory')} onSaved={refresh} />)
            : <TerminalActivity sessionId={sessionId} terminals={activity.terminals} visible={visible} onClosed={refresh} />}
      {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    </div>
  </section>
}

function RemoteDirectoryActivity({ sessionId, profiles, selectedProfileId, onProfile, onSaved }: { sessionId: string; profiles: ActivityProfileView[]; selectedProfileId?: string | undefined; onProfile(id: string): void; onSaved(): Promise<void> }): JSX.Element {
  useSshLocale()
  const profile = profiles.find(item => item.id === selectedProfileId) ?? profiles[0]
  if (profile === undefined) return <div className="dsh-ssh-activity-empty"><IconFolderOpenOutline16 size={22} /><strong>{t("activity-panel.noRemoteToBrowse")}</strong><p>{t("activity-panel.allowTheCurrentSessionToAccessAHostIn")}</p></div>
  return <ActivitySftpBrowser key={profile.id} sessionId={sessionId} profile={profile} profiles={profiles} onProfile={onProfile} onSaved={onSaved} />
}

function TerminalActivity({ sessionId, terminals, visible, onClosed }: { visible: boolean; sessionId: string; terminals: ActivityTerminalView[]; onClosed(): Promise<void> }): JSX.Element {
  useSshLocale()
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

  if (terminal === undefined) return <div className="dsh-ssh-activity-empty"><IconCodeOutline16 size={22} /><strong>{t("activity-panel.noTerminalsOpenYet")}</strong><p>{t("activity-panel.terminalsOpenedByTheAiAppearRightHere")}</p></div>

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
  const closeLabel = terminal.status.kind === 'running' ? t("activity-panel.end") : t("activity-panel.remove")

  return <div className="dsh-ssh-terminal-workbench">
    {terminals.length > 1 && <nav className="dsh-ssh-terminal-switcher dsh-ssh-scroll-surface" aria-label={t("activity-panel.sshTerminal")}>{terminals.map((item, index) => {
      const label = item.name || t("activity-panel.terminal2", [index + 1])
      return <button type="button" data-ssh-interactive="choice" title={label} className={item.terminalId === terminal.terminalId ? 'is-active' : ''} aria-pressed={item.terminalId === terminal.terminalId} key={item.terminalId} onClick={() => setSelectedId(item.terminalId)}><span className={`dsh-ssh-terminal-state-dot is-${item.status.kind}`} /><span className="dsh-ssh-terminal-switcher-label">{label}</span></button>
    })}</nav>}
    <div className="dsh-ssh-terminal-observer">
      <div className="dsh-ssh-terminal-observer-heading"><span><strong>{terminal.name}</strong><small>{terminal.cwd}</small></span><div className="dsh-ssh-terminal-observer-actions"><span className={`dsh-ssh-terminal-state is-${terminal.status.kind}`}>{terminal.status.kind === 'running' ? t("activity-panel.running") : t("activity-panel.exited")}</span><button type="button" className="dsh-ssh-terminal-close" disabled={closingId !== undefined} aria-label={t("activity-panel.terminal3", [closeLabel, terminal.name])} title={terminal.status.kind === 'running' ? t("activity-panel.endAndCloseThisTerminal") : t("activity-panel.removeThisTerminalFromTheActivityPanel")} onClick={() => { void closeSelectedTerminal() }}><IconCloseOutline16 size={14} /><span>{closingId === terminal.terminalId ? t("activity-panel.processing") : closeLabel}</span></button></div></div>
      <InteractiveTerminal key={terminal.terminalId} sessionId={sessionId} terminal={terminal} visible={visible} onError={setError} />
    </div>
    {error && <p className="dsh-ssh-terminal-input-error" role="alert">{error}</p>}
  </div>
}

function InteractiveTerminal({ sessionId, terminal: activity, visible, onError }: { visible: boolean; sessionId: string; terminal: ActivityTerminalView; onError(value: string | undefined): void }): JSX.Element {
  useSshLocale()
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal>()
  const outputRef = useRef<TerminalObservation>()
  const viewportRef = useRef<ReturnType<typeof attachTerminalViewport>>()
  const hiddenScrollRef = useRef<number>()
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    let disposed = false
    let restoreFrame: number | undefined
    const interacted = (): void => { hiddenScrollRef.current = undefined }
    const inputEvents = ['wheel', 'pointerdown', 'touchstart', 'keydown']
    for (const name of inputEvents) host.addEventListener(name, interacted, { capture: true, passive: true })
    const terminal = createSshTerminal({ compact: true, readOnly: activity.status.kind !== 'running', scrollback: 4000 })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host)
    terminalRef.current = terminal
    if (visibleRef.current) terminal.focus()
    const transport = new TerminalTransport({
      isVisible: () => visibleRef.current,
      streamUrl: activityTerminalStreamUrl(sessionId, activity.terminalId),
      read: cursor => readActivityTerminalOutput(sessionId, activity.terminalId, cursor),
      send: (text, sequence) => sendActivityTerminalInput(sessionId, activity.terminalId, text, sequence),
    })
    const rendered = terminal.onRender(() => {
      const desired = hiddenScrollRef.current
      if (disposed || !visibleRef.current || desired === undefined) return
      const target = Math.min(desired, terminal.buffer.active.baseY)
      if (terminal.buffer.active.viewportY === target || restoreFrame !== undefined) return
      restoreFrame = requestAnimationFrame(() => {
        restoreFrame = undefined
        const position = hiddenScrollRef.current
        if (!disposed && visibleRef.current && position !== undefined) terminal.scrollToLine(Math.min(position, terminal.buffer.active.baseY))
      })
    })
    const input = terminal.onData(data => transport.sendInput(data, reason => onError(errorMessage(reason))))
    const stopOutput = transport.observe({
      output: value => {
        if (value.truncated) { hiddenScrollRef.current = undefined; terminal.reset() }
        if (value.data) terminal.write(value.data)
        onError(undefined)
      },
      error: reason => onError(errorMessage(reason)),
    }, visibleRef.current)
    outputRef.current = stopOutput
    const viewport = attachTerminalViewport(host, terminal, fit, (cols, rows) => {
      void resizeActivityTerminal(sessionId, activity.terminalId, cols, rows).catch(reason => onError(errorMessage(reason)))
    }, { preserveScroll: true })
    viewportRef.current = viewport
    return () => {
      disposed = true
      if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame)
      for (const name of inputEvents) host.removeEventListener(name, interacted, true)
      outputRef.current = undefined
      viewportRef.current = undefined
      stopOutput()
      transport.dispose()
      input.dispose()
      rendered.dispose()
      viewport.dispose()
      terminal.dispose()
      terminalRef.current = undefined
    }
  }, [activity.terminalId, onError, sessionId])

  useLayoutEffect(() => {
    if (!visible) {
      const buffer = terminalRef.current?.buffer.active
      hiddenScrollRef.current ??= buffer && buffer.viewportY < buffer.baseY ? buffer.viewportY : undefined
      outputRef.current?.setVisible(false)
      return
    }
    // Hidden xterm viewports may emit a DOM scroll when their dimensions collapse.
    // Restore the user's history position after layout, before receiving new output.
    const frame = requestAnimationFrame(() => {
      viewportRef.current?.fit()
      if (hiddenScrollRef.current !== undefined) terminalRef.current?.scrollToLine(hiddenScrollRef.current)
      outputRef.current?.setVisible(true)
    })
    return () => cancelAnimationFrame(frame)
  }, [visible])

  useEffect(() => {
    const terminal = terminalRef.current
    if (terminal !== undefined) terminal.options.disableStdin = activity.status.kind !== 'running'
  }, [activity.status.kind])

  return <div className="dsh-ssh-terminal-screen" aria-label={t("activity-panel.interactiveSshTerminal")}><div ref={hostRef} className="dsh-ssh-terminal-viewport" /></div>
}
