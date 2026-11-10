import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useSshLocale } from './use-ssh-locale.js'
import { t } from './i18n.js'
import { api, ApiError, loadRemoteProjects, profileAddress, type ProfileView, type RemoteProjectView } from './client-api.js'
import { terminalDesk, deskPaneRects, deskLayoutMode, deskLayoutSize, type DeskLayoutMode, type DeskTarget, type DeskTab, type DeskPane } from './terminal-desk-state.js'
import { TerminalSession } from './terminal-session.js'
import { ProfileSftpPane } from './sftp-client.js'
import { ResizableSplit } from './resizable-split.js'
import { useResponsiveSftp } from './use-responsive-sftp.js'
import { IconFolderOpenOutlineRegular, IconPlusOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { SplitIcon } from './split-icon.js'
import { HostSelect } from './host-select.js'
import { Dialog, errorMessage } from './ui-components.js'

export interface OpenTerminalRequest { serial: number; target: DeskTarget; fresh?: boolean; filesOnly?: boolean }
export function TerminalDesk({ scope, profiles, active, request, onManage }: { scope: string; profiles: ProfileView[]; active: boolean; request?: OpenTerminalRequest | undefined; onManage(): void }): JSX.Element {
  useSshLocale()
  const [state] = useState(() => terminalDesk(scope))
  useSyncExternalStore(state.subscribe, state.snapshot, state.snapshot)
  const handled = useRef(0)
  const tabsRef = useRef<HTMLDivElement>(null)
  const [controls, setControls] = useState<ReactNode>(null)
  const [error, setError] = useState<string>()
  const [closing, setClosing] = useState<number[]>()
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [details, setDetails] = useState(false)
  const [closingAll, setClosingAll] = useState(false)
  const [reduction, setReduction] = useState<{ tabId: number; mode: DeskLayoutMode; ids: number[] }>()
  const filesOnly = state.activeTab?.filesOnly ?? false
  const setFilesOnly = (value: boolean): void => state.setFilesOnly(value)
  const [fileTabs, setFileTabs] = useState<number[]>([])
  const { ref, hidden: filesHidden, setHidden: setFilesHidden } = useResponsiveSftp(active)
  const currentTab = state.activeTab
  const current = state.currentPane
  const profile = profiles.find(profile => profile.id === current?.profileId)
  const title = (tab: DeskTab): string => `${profiles.find(p => p.id === tab.profileId)?.name ?? t('desk.unavailableHost')} · ${tab.label ?? (tab.path === '~' ? 'shell' : tab.path)}`
  const showFiles = filesOnly || !filesHidden
  useLayoutEffect(() => {
    const list = tabsRef.current
    if (!list || !active) return
    const reveal = (): void => {
      const selected = list.querySelector<HTMLElement>('.is-active')
      if (!selected || !list.clientWidth) return
      const row = list.getBoundingClientRect(), tab = selected.getBoundingClientRect()
      if (tab.left < row.left) list.scrollLeft += tab.left - row.left
      else if (tab.right > row.right) list.scrollLeft += Math.min(tab.right - row.right, tab.left - row.left)
    }
    reveal()
    const observer = new ResizeObserver(reveal); observer.observe(list)
    return () => observer.disconnect()
  }, [state.activeId, active])
  useEffect(() => {
    if (!request || handled.current === request.serial) return
    handled.current = request.serial
    try { state.open(request.target, request.fresh, !request.filesOnly); setFilesOnly(request.filesOnly === true); setError(undefined) }
    catch (reason) { setError(errorMessage(reason)) }
  }, [request, state])
  useEffect(() => {
    if (active && showFiles && current && profile) setFileTabs(ids => ids.includes(current.id) ? ids : [...ids, current.id])
  }, [active, showFiles, current?.id, profile?.id])
  const remove = async (id: string): Promise<void> => { try { await api(`/terminals/${encodeURIComponent(id)}`, { method: 'DELETE' }) } catch (reason) { if (!(reason instanceof ApiError && reason.status === 404)) throw reason } }
  const requestClose = (ids: number[], all = false): void => { setClosing(ids); setClosingAll(all) }
  const closeTabs = async (): Promise<void> => {
    if (!closing || busy) return
    setBusy(true)
    try {
      const errors = await state.close(closing, remove)
      setError(errors.length ? errors.map(errorMessage).join('\n') : undefined)
    } catch (reason) { setError(errorMessage(reason)) }
    finally { setClosing(undefined); setBusy(false) }
  }
  const applyLayout = async (tabId: number, mode: DeskLayoutMode, keep?: number[], expected?: number[]): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const errors = await state.applyLayout(tabId, mode, remove, keep, expected)
      setError(errors.length ? errors.map(errorMessage).join('\n') : undefined)
      if (!errors.length && (ref.current?.clientWidth ?? Infinity) <= 900) setFilesHidden(true)
    } catch (reason) { setError(errorMessage(reason)) }
    finally { setReduction(undefined); setBusy(false) }
  }
  const chooseLayout = (mode: DeskLayoutMode): void => {
    if (busy || !currentTab) return
    if (deskLayoutSize(mode) < currentTab.panes.length) setReduction({ tabId: currentTab.id, mode, ids: currentTab.panes.map(pane => pane.id) })
    else void applyLayout(currentTab.id, mode)
  }
  const panes = <div className="dsh-ssh-desk-pane-pages">
    {state.tabs.map(tab => {
      const host = profiles.find(profile => profile.id === tab.profileId)
      const rects = deskPaneRects(tab.layout)
      return <div key={tab.id} id={`ssh-desk-${tab.id}`} role="tabpanel" hidden={state.activeId !== tab.id} aria-label={title(tab)} className="dsh-ssh-desk-pane-layout">
        {tab.panes.map((pane, index) => {
          const rect = rects.find(rect => rect.id === pane.id)!
          const focused = state.activeId === tab.id && tab.focused === pane.id
          const label = `${title(tab)} · ${t('desk.paneNumber', [index + 1])}`
          return <section key={pane.id} className="dsh-ssh-terminal-slot" data-pane-id={pane.id} data-focused={focused} aria-label={label} style={{ left: `${rect.left}%`, top: `${rect.top}%`, width: `${rect.width}%`, height: `${rect.height}%` }} onPointerDown={() => state.focusPane(tab.id, pane.id)} onFocusCapture={() => state.focusPane(tab.id, pane.id)}>
            {host ? <TerminalSession handle={pane.handle} profile={host} path={pane.path} label={label} onControls={focused ? setControls : undefined} takeAutoConnect={() => { const value = pane.autoConnect; pane.autoConnect = false; return value }} onPhase={phase => state.setPhase(pane.id, phase)} onConnected={() => {}} onDirectory={path => state.setDirectory(pane.id, path)} /> : <div className="dsh-ssh-desk-empty" role="status"><p>{t('desk.unavailableHost')}</p><button type="button" onClick={() => requestClose([tab.id])}>{t('terminal-workspace.closeTerminal')}</button></div>}
          </section>
        })}
      </div>
    })}
  </div>
  const files = <section className="dsh-ssh-desk-files" aria-label={t('desk.files')}>
    {fileTabs.map(id => {
      const tab = state.tabs.flatMap(tab => tab.panes).find(pane => pane.id === id), host = profiles.find(host => host.id === tab?.profileId)
      if (!tab || !host) return null
      return <div key={id} hidden={id !== current?.id} className="dsh-ssh-desk-file-page"><div className="dsh-ssh-file-target"><span title={profileAddress(host)}>{host.name} · {profileAddress(host)}</span><button type="button" aria-label={t('client.hideSftp')} onClick={() => { setFilesOnly(false); setFilesHidden(true) }}>×</button></div><ProfileSftpPane profile={host} initialPath={tab.path} paneKey={`desk-${scope}-${id}`} initialFollow terminalPath={tab.directory} embedded /></div>
    })}
    {!profile && <p className="dsh-ssh-inline-hint">{t('desk.chooseTarget')}</p>}
  </section>
  return <div ref={ref} className={`dsh-ssh-terminal-desk${filesOnly ? ' is-files-only' : ''}`}>
    <div className="dsh-ssh-desk-tabbar">
      <div ref={tabsRef} className="dsh-ssh-desk-tabs" role="tablist" aria-label={t('desk.openTerminals')}>{state.tabs.map(tab => <span key={tab.id} className={`dsh-ssh-desk-tab${tab.id === state.activeId ? ' is-active' : ''}`}>
        <button type="button" role="tab" aria-selected={tab.id === state.activeId} aria-controls={`ssh-desk-${tab.id}`} title={`${title(tab)} · ${phaseText(tab.panes.find(pane => pane.id === tab.focused)!.phase)}`} onClick={() => { state.focus(tab.id) }} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault(); const index = state.tabs.indexOf(tab); const next = event.key === 'Home' ? state.tabs[0] : event.key === 'End' ? state.tabs.at(-1) : state.tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + state.tabs.length) % state.tabs.length]
          if (next) { state.focus(next.id); event.currentTarget.parentElement?.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[state.tabs.indexOf(next)]?.focus() }
        }}><span className="dsh-ssh-desk-dot" data-phase={tab.panes.find(pane => pane.id === tab.focused)!.phase} aria-label={phaseText(tab.panes.find(pane => pane.id === tab.focused)!.phase)} />{title(tab)}</button><button type="button" aria-label={t('terminal-workspace.close', [title(tab)])} disabled={busy} onClick={() => requestClose([tab.id])}>×</button>
      </span>)}</div>
      <button type="button" className="dsh-ssh-icon-button" title={t('terminal-workspace.newTerminal')} aria-label={t('terminal-workspace.newTerminal')} disabled={state.tabs.length >= 32} onClick={() => setPicking(true)}><IconPlusOutlineRegular size={16} aria-hidden="true" /></button>
      <div className="dsh-ssh-desk-actions" role="group" aria-label={t('terminal-workspace.terminalLayout')}>
        {(['single', 'horizontal', 'vertical', 'grid'] as const).map(direction => {
          const label = direction === 'single' ? t('terminal-workspace.singlePane') : direction === 'grid' ? t('desk.gridLayout') : direction === 'horizontal' ? t('terminal-workspace.splitHorizontally') : t('terminal-workspace.splitVertically')
          return <button key={direction} type="button" className="dsh-ssh-icon-button" aria-label={label} title={label} aria-pressed={!filesOnly && currentTab !== undefined && deskLayoutMode(currentTab) === direction && currentTab.panes.length === deskLayoutSize(direction)} disabled={busy || !current} onClick={() => chooseLayout(direction)}><SplitIcon direction={direction === 'single' ? undefined : direction} /></button>
        })}
        <button type="button" className="dsh-ssh-icon-button" title="SFTP" aria-label="SFTP" disabled={!current} aria-pressed={showFiles} onClick={() => { setFilesOnly(false); setFilesHidden(showFiles) }}><IconFolderOpenOutlineRegular size={16} aria-hidden="true" /></button>
      </div>
    </div>
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    {state.tabs.length ? <ResizableSplit storageKey="dsh-ssh:desk:sftp-width" label={t('client.adjustTheTerminalAndSftpWidths')} secondaryHidden={!showFiles} primary={<section className="dsh-ssh-workbench-terminal">{panes}</section>} secondary={files} /> : <div className="dsh-ssh-desk-empty"><p>{t('desk.noTerminals')}</p><div><button type="button" className="dsh-ssh-primary-button" onClick={() => setPicking(true)}>{t('terminal-workspace.newTerminal')}</button><button type="button" className="dsh-ssh-secondary-button" onClick={onManage}>{t('remote-workspace-tree.hostsProjects')}</button></div></div>}
    <footer className="dsh-ssh-desk-status">
      <div className="dsh-ssh-desk-controls"><button type="button" className="dsh-ssh-danger-button dsh-ssh-close-all" disabled={busy || !state.tabs.length} onClick={() => requestClose(state.tabs.map(tab => tab.id), true)}>{t('client.closeAllTerminals')}</button><span className="dsh-ssh-desk-control-separator" aria-hidden="true" />{profile && controls}</div>
      {profile ? <button type="button" className="dsh-ssh-desk-info" aria-label={t('desk.connectionDetails')} title={`${profile.name} · ${profileAddress(profile)} · ${current?.directory ?? current?.path}
${t('desk.connectionDetails')}`} aria-haspopup="dialog" onClick={() => setDetails(true)}>{profile.name} · {profileAddress(profile)} · {current?.directory ?? current?.path}</button> : <span className="dsh-ssh-desk-info">{t('desk.chooseTarget')}</span>}
    </footer>
    {closing && <Dialog variant="confirmation" dismissible={!busy} title={closingAll ? t('client.closeAllTerminals') : t('desk.closeCount', [state.tabs.filter(tab => closing.includes(tab.id)).reduce((count, tab) => count + tab.panes.length, 0)])} subtitle={closingAll ? t('desk.closeAllHint', [state.tabs.filter(tab => closing.includes(tab.id)).reduce((count, tab) => count + tab.panes.length, 0)]) : t('terminal-workspace.closingDisconnectsThisTabSSshConnectionAndMay')} onClose={() => { if (!busy) setClosing(undefined) }}><div className="dsh-ssh-dialog-actions"><button type="button" disabled={busy} onClick={() => setClosing(undefined)}>{t('client.cancel')}</button><button type="button" disabled={busy} className="dsh-ssh-danger-button" onClick={() => { void closeTabs() }}>{t('terminal-workspace.closeConnection')}</button></div></Dialog>}
    {reduction && <LayoutReductionDialog tab={state.tabs.find(tab => tab.id === reduction.tabId)!} count={deskLayoutSize(reduction.mode)} busy={busy} onClose={() => { if (!busy) setReduction(undefined) }} onConfirm={keep => { void applyLayout(reduction.tabId, reduction.mode, keep, reduction.ids) }} />}
    {picking && <NewDeskTerminal profiles={profiles} initial={current} onClose={() => setPicking(false)} onOpen={(target, files) => { try { state.open(target, true, !files); setFilesOnly(files); setPicking(false); setError(undefined) } catch (reason) { setError(errorMessage(reason)) } }} />}
    {details && profile && <Dialog title={t('desk.connectionDetails')} onClose={() => setDetails(false)}><p>{profile.name} · {profileAddress(profile)}</p><p>{profile.hostFingerprint ?? t('desk.noFingerprint')}</p><p>{t('desk.proxy')}: {profile.proxy.type}</p><p>{t('terminal-session.retentionHint')}</p><p>{t('desk.restartHint')}</p></Dialog>}
  </div>
}
function LayoutReductionDialog({ tab, count, busy, onClose, onConfirm }: { tab: DeskTab; count: number; busy: boolean; onClose(): void; onConfirm(ids: number[]): void }): JSX.Element {
  const [keep, setKeep] = useState<number[]>([tab.focused])
  const rects = deskPaneRects(tab.layout)
  return <Dialog className="dsh-ssh-layout-choice" title={t('desk.keepPanesTitle')} subtitle={t('desk.keepPanesHint', [count, tab.panes.length - count])} dismissible={!busy} onClose={onClose}>
    <div className="dsh-ssh-keep-panes" role="group" aria-label={t('desk.keepPanesTitle')}>
      {tab.panes.map((pane, index) => {
        const rect = rects.find(rect => rect.id === pane.id)!, selected = keep.includes(pane.id)
        return <label key={pane.id} className="dsh-ssh-keep-pane" data-kept={selected} style={{ left: `${rect.left}%`, top: `${rect.top}%`, width: `${rect.width}%`, height: `${rect.height}%` }}>
          <input type={count === 1 ? 'radio' : 'checkbox'} name="ssh-keep-pane" aria-label={t('desk.paneNumber', [index + 1])} checked={selected} disabled={busy || (count > 1 && !selected && keep.length >= count)} onChange={() => setKeep(ids => count === 1 ? [pane.id] : selected ? ids.filter(id => id !== pane.id) : [...ids, pane.id])} />
          <span><strong>{t('desk.paneNumber', [index + 1])}{tab.focused === pane.id ? ` · ${t('desk.currentPane')}` : ''}</strong><small title={pane.directory ?? pane.path}>{pane.directory ?? pane.path}</small><small>{phaseText(pane.phase)}</small><b>{selected ? t('desk.willKeep') : t('desk.willClose')}</b></span>
        </label>
      })}
    </div>
    <p className="dsh-ssh-form-hint" role="status">{t('desk.selectedPanes', [keep.length, count])}</p>
    <div className="dsh-ssh-dialog-actions"><button type="button" disabled={busy} onClick={onClose}>{t('client.cancel')}</button><button type="button" className="dsh-ssh-danger-button" disabled={busy || keep.length !== count} onClick={() => onConfirm(keep)}>{t('desk.confirmReduction')}</button></div>
  </Dialog>
}
function NewDeskTerminal({ profiles, initial, onOpen, onClose }: { profiles: ProfileView[]; initial?: DeskTarget | undefined; onOpen(target: DeskTarget, filesOnly: boolean): void; onClose(): void }): JSX.Element {
  const [editingHost, setEditingHost] = useState(false)
  const [host, setHost] = useState(initial?.profileId ?? profiles[0]?.id ?? '')
  const [path, setPath] = useState(initial?.path ?? '~')
  const [projects, setProjects] = useState<RemoteProjectView[]>([])
  const [error, setError] = useState<string>()
  useEffect(() => { let live = true; setProjects([]); setError(undefined); if (host) void loadRemoteProjects(host).then(value => { if (live) setProjects(value) }).catch(reason => { if (live) setError(errorMessage(reason)) }); return () => { live = false } }, [host])
  const open = (filesOnly: boolean): void => { if (!editingHost && profiles.some(profile => profile.id === host)) onOpen({ profileId: host, path: path.trim() || '~', label: projects.find(project => project.path === path)?.name }, filesOnly) }
  return <Dialog title={t('terminal-workspace.newTerminal')} onClose={onClose}><form className="dsh-ssh-form" onSubmit={event => { event.preventDefault(); open(false) }}><label className="dsh-ssh-field"><span>{t('client.host')}</span><HostSelect profiles={profiles} value={host} onEditingChange={setEditingHost} onChange={id => { setHost(id); setPath('~') }} /></label><label className="dsh-ssh-field"><span>{t('desk.projectDirectory')}</span><select value={projects.some(project => project.path === path) ? path : ''} onChange={event => { if (event.target.value) setPath(event.target.value) }}><option value="">{t('desk.customDirectory')}</option>{projects.map(project => <option key={project.id} value={project.path}>{project.name} · {project.path}</option>)}</select><input aria-label={t('desk.directory')} value={path} onChange={event => setPath(event.target.value)} /></label>{error && <p role="alert" className="dsh-ssh-inline-error">{error}</p>}<p className="dsh-ssh-form-hint">{t('desk.manualHint')}</p><div className="dsh-ssh-dialog-actions"><button type="button" disabled={editingHost || !profiles.some(profile => profile.id === host)} onClick={() => open(true)}>{t('desk.filesOnly')}</button><button type="submit" disabled={editingHost || !profiles.some(profile => profile.id === host)} className="dsh-ssh-primary-button">{t('terminal-session.connect2')}</button></div></form></Dialog>
}

function phaseText(phase: DeskPane['phase']): string {
  switch (phase) {
    case 'idle': return t('desk.phaseIdle')
    case 'connecting': return t('desk.phaseConnecting')
    case 'connected': return t('desk.phaseConnected')
    case 'error': return t('desk.phaseError')
  }
}
