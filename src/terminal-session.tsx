import { useSshLocale } from './use-ssh-locale.js'
import { t } from './i18n.js'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { api, ApiError, browserTerminalStreamUrl, profileAddress, type ProfileView, type TerminalOutputDelta } from './client-api.js'
import { TerminalTransport } from './terminal-transport.js'
import { attachTerminalViewport, createSshTerminal } from './terminal-view.js'
import { Dialog, errorMessage } from './ui-components.js'
import { CommandsPanel } from './commands-panel.js'

export function TerminalSession({ profile, path, label, onControls, onConnected }: { profile: ProfileView; path: string; label: string; onControls: ((controls: ReactNode) => void) | undefined; onConnected(): void }): JSX.Element {
  const sshLocale = useSshLocale()
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal>()
  const idRef = useRef<string>()
  const transportRef = useRef<TerminalTransport>()
  const fitRef = useRef<FitAddon>()
  const disposeViewportRef = useRef<() => void>()
  const generation = useRef(0)
  const connecting = useRef(false)
  const [id, setId] = useState<string>()
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle')
  const [error, setError] = useState<string>()
  const [picking, setPicking] = useState(false)
  const [draft, setDraft] = useState<string>()
  const close = (terminalId: string): Promise<void> => api(`/terminals/${encodeURIComponent(terminalId)}`, { method: 'DELETE' })

  const initialize = (): Terminal | undefined => {
    if (terminalRef.current) return terminalRef.current
    const host = hostRef.current
    if (!host) return
    const terminal = createSshTerminal({ scrollback: 3000 })
    const fit = new FitAddon()
    terminal.loadAddon(fit); terminal.open(host)
    terminalRef.current = terminal; fitRef.current = fit
    const viewport = attachTerminalViewport(host, terminal, fit, (cols, rows) => {
      if (idRef.current) void api(`/terminals/${idRef.current}/resize`, { method: 'POST', body: JSON.stringify({ cols, rows }) }).catch(() => {})
    })
    disposeViewportRef.current = () => viewport.dispose()
    return terminal
  }
  useEffect(() => () => {
      generation.current++
      if (idRef.current) void close(idRef.current).catch(() => {})
      disposeViewportRef.current?.(); terminalRef.current?.dispose(); terminalRef.current = undefined
  }, [])

  useEffect(() => {
    if (!id || !terminalRef.current) return
    const terminal = terminalRef.current
    const transport = new TerminalTransport({
      streamUrl: browserTerminalStreamUrl(id),
      isVisible: () => (hostRef.current?.getClientRects().length ?? 0) > 0,
      read: async cursor => {
        try { return await api<TerminalOutputDelta>(`/terminals/${id}/output?cursor=${cursor}`) }
        catch (reason) {
          if (reason instanceof ApiError && reason.status === 404) return { data: t("terminal-session.connectionEndedYouCanReconnect"), cursor, closed: true, truncated: false }
          throw reason
        }
      },
      send: (text, sequence) => api(`/terminals/${id}/input`, { method: 'POST', body: JSON.stringify({ text, sequence }) }),
    })
    transportRef.current = transport
    const input = terminal.onData(text => transport.sendInput(text, reason => setError(errorMessage(reason))))
    const stop = transport.observe({ output: value => {
      if (value.truncated) terminal.write(t("terminal-session.earlierOutputTruncated"))
      if (value.data) terminal.write(value.data)
      if (value.closed) { idRef.current = undefined; setId(undefined); setPhase('idle') }
    }, error: reason => setError(errorMessage(reason)) })
    return () => { stop(); input.dispose(); transport.dispose(); transportRef.current = undefined }
  }, [id])

  const connect = async (): Promise<void> => {
    if (connecting.current || idRef.current) return
    connecting.current = true
    const current = generation.current
    setPhase('connecting'); setError(undefined)
    try {
      const terminal = initialize()
      if (!terminal) { setPhase('idle'); return }
      fitRef.current?.fit()
      const result = await api<{ id: string }>('/terminals', { method: 'POST', body: JSON.stringify({ profileId: profile.id, cwd: path, cols: terminal.cols, rows: terminal.rows }) })
      if (generation.current !== current) { await close(result.id); return }
      idRef.current = result.id; setId(result.id); setPhase('connected'); onConnected(); terminal.focus()
    } catch (reason) { if (generation.current === current) { setPhase('error'); setError(errorMessage(reason)) } }
    finally { connecting.current = false }
  }
  const disconnect = async (): Promise<void> => {
    if (!idRef.current) return
    try { await close(idRef.current); idRef.current = undefined; setId(undefined); setPhase('idle') }
    catch (reason) { setError(errorMessage(reason)) }
  }
  // Publish only the selected session's controls; keep transport ownership here.
  const actions = useRef({ connect, disconnect })
  actions.current = { connect, disconnect }
  useEffect(() => {
    if (!onControls) return
    onControls(<><button type="button" className="dsh-ssh-secondary-button" aria-label={t("client.savedCommands")} title={t("terminal-session.savedCommands", [label])} onClick={() => setPicking(true)}>{t("commands-panel.command")}</button>{id ? <button type="button" className="dsh-ssh-secondary-button" title={t("terminal-session.disconnect", [label])} onClick={() => { void actions.current.disconnect() }}>{t("client.disconnect")}</button> : <button type="button" className="dsh-ssh-primary-button" title={t("terminal-session.connect", [label])} disabled={phase === 'connecting'} onClick={() => { void actions.current.connect() }}>{phase === 'connecting' ? t("client.connecting") : t("terminal-session.connect2")}</button>}</>)
    return () => onControls(null)
  }, [onControls, label, id, phase, sshLocale])
  return <div className="dsh-ssh-terminal-pane is-embedded">
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    <div className="dsh-ssh-terminal-frame"><div className="dsh-ssh-xterm"><div ref={hostRef} className="dsh-ssh-terminal-viewport" /></div><div className="dsh-ssh-terminal-status"><span>{label} · {id ? t("terminal-session.connected") : phase === 'connecting' ? t("client.connecting") : t("terminal-session.disconnected")}</span><span title={t("terminal-session.initialDirectory", [path, profileAddress(profile)])}>{path}</span></div></div>
    {draft !== undefined && <div className="dsh-ssh-command-draft"><label className="dsh-ssh-field"><span>{t("terminal-session.target")}{profile.name}  {t("terminal-session.makeSureTheTerminalIsAtACommandPrompt")}</span><textarea aria-label={t("terminal-session.commandToSend")} rows={3} value={draft} onChange={event => setDraft(event.target.value)} /></label><div className="dsh-ssh-heading-actions"><button type="button" className="dsh-ssh-secondary-button" onClick={() => setDraft(undefined)}>{t("client.cancel")}</button><button type="button" className="dsh-ssh-primary-button" disabled={!id || !draft.trim()} onClick={() => {
      if (!transportRef.current) return
      transportRef.current.sendInput(`${draft.replace(/\r\n/g, '\n')}\r`, reason => setError(errorMessage(reason)))
      setDraft(undefined); terminalRef.current?.focus()
    }}>{t("terminal-session.runCommand")}{draft.includes('\n') ? t("terminal-session.multiLineCommand") : ''}</button></div></div>}
    {picking && <Dialog title={t("terminal-session.selectSavedCommand")} subtitle={t("terminal-session.previewBeforeRunningSelectingDoesNotExecuteTheCommand")} onClose={() => setPicking(false)}><CommandsPanel onChoose={command => { setDraft(command); setPicking(false) }} /></Dialog>}
  </div>
}
