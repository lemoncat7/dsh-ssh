import { useSshLocale } from './use-ssh-locale.js'
import { t } from './i18n.js'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconCloseOutlineRegular as IconCloseOutline16, IconPlusOutlineRegular as IconPlusOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ProfileView } from './client-api.js'
import { TerminalSession } from './terminal-session.js'
import { closeTerminal, nextTerminalNumber, selectTerminal, splitTerminal, type TerminalLayout } from './terminal-layout.js'
import { api, ApiError } from './client-api.js'
import { BrowserTerminalHandle, terminalWorkspaceState, type PersistentTerminalTab } from './terminal-workspace-state.js'
import { Dialog, errorMessage } from './ui-components.js'

type TerminalTab = PersistentTerminalTab
export function TerminalWorkspace({ scope, profile, path, onConnected, closeAllRequest = 0, onCountChange, onDirectory }: { scope: string; profile: ProfileView; path: string; onConnected(): void; closeAllRequest?: number; onCountChange?: (count: number) => void; onDirectory?(path: string | undefined): void }): JSX.Element {
  useSshLocale()
  const [saved] = useState(() => terminalWorkspaceState(scope, profile.id, path))
  const [tabs, renderTabs] = useState<TerminalTab[]>(saved.tabs)
  const [serial, renderSerial] = useState(saved.serial)
  const [view, renderView] = useState<TerminalLayout>(saved.view)
  const [direction, renderDirection] = useState(saved.direction)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const setTabs = (next: TerminalTab[] | ((value: TerminalTab[]) => TerminalTab[])): void => { saved.tabs = typeof next === 'function' ? next(saved.tabs) : next; saved.save(); renderTabs(saved.tabs) }
  const setView = (next: TerminalLayout | ((value: TerminalLayout) => TerminalLayout)): void => { saved.view = typeof next === 'function' ? next(saved.view) : next; saved.save(); renderView(saved.view) }
  const setSerial = (next: number): void => { saved.serial = next; saved.save(); renderSerial(next) }
  const setDirection = (next: 'horizontal' | 'vertical'): void => { saved.direction = next; saved.save(); renderDirection(next) }
  const remove = async (id: string): Promise<void> => {
    try { await api(`/terminals/${encodeURIComponent(id)}`, { method: 'DELETE' }) }
    catch (reason) { if (!(reason instanceof ApiError && reason.status === 404)) throw reason }
  }
  const closeTabs = async (ids: number[]): Promise<void> => {
    setBusy(true); setError(undefined)
    const results = await Promise.allSettled(saved.tabs.filter(tab => ids.includes(tab.id)).map(async tab => { await tab.handle.close(remove); return tab.id }))
    const closed = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
    setTabs(current => current.filter(tab => !closed.includes(tab.id)))
    setView(current => closed.reduce((value, id) => closeTerminal(value, id, saved.tabs.map(tab => tab.id)), current))
    const failed = results.find(result => result.status === 'rejected')
    if (failed?.status === 'rejected') setError(errorMessage(failed.reason))
    setClosing(undefined); setBusy(false)
  }
  const [closing, setClosing] = useState<number>()
  const [controls, setControls] = useState<ReactNode>(null)
  const handledCloseRequest = useRef(closeAllRequest)
  const focusedDirectory = tabs.find(tab => tab.id === view.focused)?.directory
  useEffect(() => { onDirectory?.(focusedDirectory) }, [focusedDirectory, view.focused, onDirectory])
  useEffect(() => {
    if (handledCloseRequest.current === closeAllRequest) return
    handledCloseRequest.current = closeAllRequest
    void closeTabs(saved.tabs.map(tab => tab.id))
  }, [closeAllRequest])
  useEffect(() => { onCountChange?.(tabs.length) }, [onCountChange, tabs.length])
  const label = (id: number): string => t("activity-panel.terminal2", [tabs.find(tab => tab.id === id)?.number ?? ''])
  const choose = (id: number): void => setView(current => selectTerminal(current, id))
  const add = (split = false): void => {
    if (tabs.length >= 8 || (split && view.panes.length >= 4)) return
    const id = serial + 1
    setSerial(id)
    setTabs(current => [...current, { id, number: nextTerminalNumber(current.map(tab => tab.number)), path, handle: new BrowserTerminalHandle(undefined, saved.save) }])
    setView(current => split ? splitTerminal(current, id) : selectTerminal(current, id))
  }
  const addSplit = (): void => {
    if (view.panes.length >= 4) return
    const other = tabs.find(tab => !view.panes.includes(tab.id))
    if (other) setView(current => splitTerminal(current, other.id))
    else add(true)
  }
  const orient = (next: 'horizontal' | 'vertical'): void => {
    setDirection(next)
    if (view.panes.length < 2) addSplit()
  }
  const count = view.panes.length
  return <div className="dsh-ssh-terminal-workspace">
    {error && <p role="alert" className="dsh-ssh-inline-error">{error}</p>}
    <div className="dsh-ssh-terminal-tabbar">
      <div className="dsh-ssh-terminal-tabs" role="tablist" aria-label={t("terminal-workspace.terminalTabs", [profile.name])}>
        {tabs.map(tab => <span key={tab.id} className={`dsh-ssh-terminal-tab${view.focused === tab.id ? ' is-active' : ''}`} data-ssh-interactive="choice">
          <button type="button" role="tab" aria-selected={view.focused === tab.id} aria-controls={`ssh-terminal-${profile.id}-${tab.id}`} title={`${label(tab.id)}${view.panes.includes(tab.id) ? t("terminal-workspace.pane", [view.panes.indexOf(tab.id) + 1]) : t("terminal-workspace.openInCurrentPane")}`} onClick={() => choose(tab.id)} onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const index = tabs.findIndex(item => item.id === tab.id)
            const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
            const next = tabs[nextIndex]
            if (next) { choose(next.id); event.currentTarget.parentElement?.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus() }
          }}>{label(tab.id)}</button>
          <button type="button" aria-label={t("terminal-workspace.close", [label(tab.id)])} title={t("terminal-workspace.closeTerminal")} onClick={() => setClosing(tab.id)}><IconCloseOutline16 size={13} /></button>
        </span>)}
      </div>
      <button type="button" className="dsh-ssh-icon-button" disabled={tabs.length >= 8} title={tabs.length >= 8 ? t("terminal-workspace.upTo8TabsPerHost") : t("terminal-workspace.newTerminalTab")} aria-label={t("terminal-workspace.newTerminalTab")} onClick={() => add()}><IconPlusOutline16 size={16} /></button>
      <div className="dsh-ssh-terminal-layout-actions" role="group" aria-label={t("terminal-workspace.terminalLayout")}>
        {count < 3 && <>
          <button type="button" className="dsh-ssh-icon-button" aria-label={t("terminal-workspace.splitHorizontally")} title={t("terminal-workspace.splitHorizontally")} aria-pressed={count === 2 && direction === 'horizontal'} disabled={!count} onClick={() => orient('horizontal')}><SplitIcon direction="horizontal" /></button>
          <button type="button" className="dsh-ssh-icon-button" aria-label={t("terminal-workspace.splitVertically")} title={t("terminal-workspace.splitVertically")} aria-pressed={count === 2 && direction === 'vertical'} disabled={!count} onClick={() => orient('vertical')}><SplitIcon direction="vertical" /></button>
        </>}
        {count >= 2 && <button type="button" className="dsh-ssh-icon-button" aria-label={t("terminal-workspace.addPane")} title={count >= 4 ? t("terminal-workspace.upTo4Panes") : t("terminal-workspace.addPaneUpTo4")} disabled={count >= 4} onClick={addSplit}><SplitIcon direction="grid" /></button>}
        {count > 1 && <button type="button" className="dsh-ssh-icon-button" aria-label={t("terminal-workspace.singlePane")} title={t("terminal-workspace.showOnlyTheCurrentTerminalKeepOtherConnections")} onClick={() => setView(current => ({ panes: [current.focused], focused: current.focused }))}><SplitIcon /></button>}
      </div>
      <div className="dsh-ssh-terminal-session-actions" role="group" aria-label={t("terminal-workspace.actions", [label(view.focused)])}>{controls}</div>
    </div>
    <div className={`dsh-ssh-terminal-panes${count > 2 ? ' is-grid' : count === 2 ? ` is-split is-${direction}` : ''}`}>
      {tabs.map(tab => <section key={tab.id} id={`ssh-terminal-${profile.id}-${tab.id}`} aria-label={label(tab.id)} className="dsh-ssh-terminal-slot" hidden={!view.panes.includes(tab.id)} style={{ order: view.panes.indexOf(tab.id) }} data-focused={view.focused === tab.id} onPointerDown={() => setView(current => ({ ...current, focused: tab.id }))} onFocusCapture={() => setView(current => ({ ...current, focused: tab.id }))}>
        <TerminalSession handle={tab.handle} profile={profile} path={tab.path} label={label(tab.id)} onControls={view.focused === tab.id ? setControls : undefined} onConnected={onConnected} onDirectory={directory => setTabs(current => current.find(item => item.id === tab.id)?.directory === directory ? current : current.map(item => item.id === tab.id ? { ...item, directory } : item))} />
      </section>)}
      {tabs.length === 0 && <div className="dsh-ssh-command-empty"><p>{t("terminal-workspace.allTerminalsAreClosed")}</p><button type="button" className="dsh-ssh-primary-button" onClick={() => add()}>{t("terminal-workspace.newTerminal")}</button></div>}
    </div>
    {closing !== undefined && <Dialog variant="confirmation" title={t("terminal-workspace.close2", [label(closing)])} subtitle={t("terminal-workspace.closingDisconnectsThisTabSSshConnectionAndMay")} onClose={() => setClosing(undefined)}><div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" onClick={() => setClosing(undefined)}>{t("client.cancel")}</button><button type="button" className="dsh-ssh-danger-button" disabled={busy} onClick={() => {
      void closeTabs([closing])
    }}>{t("terminal-workspace.closeConnection")}</button></div></Dialog>}
  </div>
}

function SplitIcon({ direction }: { direction?: 'horizontal' | 'vertical' | 'grid' }): JSX.Element {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5" />{(direction === 'horizontal' || direction === 'grid') && <path d="M8 3v10" />}{(direction === 'vertical' || direction === 'grid') && <path d="M2.5 8h11" />}</svg>
}
