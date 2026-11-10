import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useSshLocale } from './use-ssh-locale.js'
import { t } from './i18n.js'
import { api, ApiError, loadRemoteProjects, profileAddress, type ProfileView, type RemoteProjectView } from './client-api.js'
import { terminalDesk, type DeskTarget, type DeskTab } from './terminal-desk-state.js'
import { TerminalSession } from './terminal-session.js'
import { ProfileSftpPane } from './sftp-client.js'
import { ResizableSplit } from './resizable-split.js'
import { useResponsiveSftp } from './use-responsive-sftp.js'
import { Dialog, errorMessage } from './ui-components.js'

export interface OpenTerminalRequest { serial: number; target: DeskTarget; fresh?: boolean; filesOnly?: boolean }
export function TerminalDesk({ scope, profiles, active, request, onManage, accessSummary }: { scope: string; profiles: ProfileView[]; active: boolean; request?: OpenTerminalRequest | undefined; onManage(): void; accessSummary: ReactNode }): JSX.Element {
  useSshLocale()
  const [state] = useState(() => terminalDesk(scope))
  useSyncExternalStore(state.subscribe, state.snapshot, state.snapshot)
  const handled = useRef(0)
  const [controls, setControls] = useState<ReactNode>(null)
  const [error, setError] = useState<string>()
  const [closing, setClosing] = useState<number[]>()
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [more, setMore] = useState(false)
  const [details, setDetails] = useState(false)
  const [filesOnly, setFilesOnly] = useState(false)
  const [fileTabs, setFileTabs] = useState<number[]>([])
  const { ref, hidden: filesHidden, setHidden: setFilesHidden } = useResponsiveSftp(active)
  const current = state.tabs.find(tab => tab.id === state.view.focused)
  const profile = profiles.find(profile => profile.id === current?.profileId)
  const title = (tab: DeskTab): string => `${profiles.find(p => p.id === tab.profileId)?.name ?? t('desk.unavailableHost')} · ${tab.label ?? (tab.path === '~' ? 'shell' : tab.path)}`
  const showFiles = filesOnly || !filesHidden
  useEffect(() => {
    if (!request || handled.current === request.serial) return
    handled.current = request.serial
    try { state.open(request.target, request.fresh, !request.filesOnly); setFilesOnly(request.filesOnly === true); setError(undefined) }
    catch (reason) { setError(errorMessage(reason)) }
  }, [request, state])
  useEffect(() => {
    if (active && showFiles && current && profile) setFileTabs(ids => ids.includes(current.id) ? ids : [...ids, current.id])
  }, [active, showFiles, current?.id, profile?.id])
  useEffect(() => { if (!more) return; const close = (event: KeyboardEvent): void => { if (event.key === 'Escape') setMore(false) }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close) }, [more])
  const remove = async (id: string): Promise<void> => { try { await api(`/terminals/${encodeURIComponent(id)}`, { method: 'DELETE' }) } catch (reason) { if (!(reason instanceof ApiError && reason.status === 404)) throw reason } }
  const closeTabs = async (): Promise<void> => {
    if (!closing || busy) return
    setBusy(true)
    const errors = await state.close(closing, remove)
    setError(errors.length ? errors.map(errorMessage).join('\n') : undefined)
    setClosing(undefined); setBusy(false)
  }
  const split = (direction: 'horizontal' | 'vertical'): void => {
    if (!current || state.view.panes.length >= 4) return
    const before = { ...state.view, panes: [...state.view.panes] }
    let other = state.tabs.find(tab => !before.panes.includes(tab.id))
    try {
      if (!other) other = state.open({ profileId: current.profileId, path: current.directory ?? current.path, label: current.label }, true)
      state.view = before; state.direction = direction; state.split(other.id); setFilesOnly(false)
    } catch (reason) { setError(errorMessage(reason)) }
  }
  const panes = <div className={`dsh-ssh-terminal-panes${state.view.panes.length > 2 ? ' is-grid' : state.view.panes.length === 2 ? ` is-split is-${state.direction}` : ''}`}>
    {state.tabs.map(tab => {
      const host = profiles.find(profile => profile.id === tab.profileId)
      return <section key={tab.id} id={`ssh-desk-${tab.id}`} hidden={!state.view.panes.includes(tab.id)} style={{ order: state.view.panes.indexOf(tab.id) }} className="dsh-ssh-terminal-slot" data-focused={state.view.focused === tab.id} aria-label={title(tab)} onPointerDown={() => { if (state.view.focused !== tab.id) state.focus(tab.id) }} onFocusCapture={() => { if (state.view.focused !== tab.id) state.focus(tab.id) }}>
        {host ? <TerminalSession handle={tab.handle} profile={host} path={tab.path} label={title(tab)} onControls={state.view.focused === tab.id ? setControls : undefined} takeAutoConnect={() => { const value = tab.autoConnect; tab.autoConnect = false; return value }} onPhase={phase => state.setPhase(tab.id, phase)} onConnected={() => {}} onDirectory={path => state.setDirectory(tab.id, path)} /> : <div className="dsh-ssh-desk-empty" role="status"><p>{t('desk.unavailableHost')}</p><button type="button" onClick={() => setClosing([tab.id])}>{t('terminal-workspace.closeTerminal')}</button></div>}
      </section>
    })}
  </div>
  const files = <section className="dsh-ssh-desk-files" aria-label={t('desk.files')}>
    {fileTabs.map(id => {
      const tab = state.tabs.find(tab => tab.id === id), host = profiles.find(host => host.id === tab?.profileId)
      if (!tab || !host) return null
      return <div key={id} hidden={id !== current?.id} className="dsh-ssh-desk-file-page"><div className="dsh-ssh-file-target"><span title={profileAddress(host)}>{host.name} · {profileAddress(host)}</span><button type="button" aria-label={t('client.hideSftp')} onClick={() => { setFilesOnly(false); setFilesHidden(true) }}>×</button></div><ProfileSftpPane profile={host} initialPath={tab.path} paneKey={`desk-${scope}-${id}`} initialFollow={false} terminalPath={tab.directory} embedded /></div>
    })}
    {!profile && <p className="dsh-ssh-inline-hint">{t('desk.chooseTarget')}</p>}
  </section>
  return <div ref={ref} className={`dsh-ssh-terminal-desk${filesOnly ? ' is-files-only' : ''}`}>
    <div className="dsh-ssh-desk-tabbar">
      <div className="dsh-ssh-desk-tabs" role="tablist" aria-label={t('desk.openTerminals')}>{state.tabs.map(tab => <span key={tab.id} className={`dsh-ssh-desk-tab${tab.id === state.view.focused ? ' is-active' : ''}`}>
        <button type="button" role="tab" aria-selected={tab.id === state.view.focused} aria-controls={`ssh-desk-${tab.id}`} title={`${title(tab)} · ${phaseText(tab.phase)}`} onClick={() => { state.focus(tab.id); setMore(false) }} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault(); const index = state.tabs.indexOf(tab); const next = event.key === 'Home' ? state.tabs[0] : event.key === 'End' ? state.tabs.at(-1) : state.tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + state.tabs.length) % state.tabs.length]
          if (next) { state.focus(next.id); event.currentTarget.parentElement?.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[state.tabs.indexOf(next)]?.focus() }
        }}><span className="dsh-ssh-desk-dot" data-phase={tab.phase} aria-label={phaseText(tab.phase)} />{title(tab)}</button><button type="button" aria-label={t('terminal-workspace.close', [title(tab)])} onClick={() => setClosing([tab.id])}>×</button>
      </span>)}</div>
      <button type="button" className="dsh-ssh-icon-button" aria-label={t('terminal-workspace.newTerminal')} disabled={state.tabs.length >= 32} onClick={() => setPicking(true)}>＋</button>
      <div className="dsh-ssh-desk-actions">
        {accessSummary}
        <button type="button" disabled={!current || state.view.panes.length >= 4} onClick={() => split('horizontal')}>{t('terminal-workspace.splitHorizontally')}</button>
        <button type="button" disabled={!current} aria-pressed={showFiles} onClick={() => { setFilesOnly(false); setFilesHidden(showFiles) }}>{t('desk.files')}</button>
        <div className="dsh-ssh-desk-more"><button type="button" aria-expanded={more} aria-label={t('desk.more')} onClick={() => setMore(value => !value)}>{t('desk.more')}</button>{more && <div className="dsh-ssh-desk-menu">
          <button type="button" onClick={() => { setPicking(true); setMore(false) }}>{t('terminal-workspace.newTerminal')}</button>
          <button type="button" disabled={!current} onClick={() => { setFilesOnly(!filesOnly); setFilesHidden(false); setMore(false) }}>{filesOnly ? t('desk.terminalAndFiles') : t('desk.filesOnly')}</button>
          <button type="button" disabled={!current || state.view.panes.length >= 4} onClick={() => { split('vertical'); setMore(false) }}>{t('terminal-workspace.splitVertically')}</button>
          <button type="button" disabled={!current} onClick={() => { state.view = { panes: [current!.id], focused: current!.id }; state.save(); setMore(false) }}>{t('terminal-workspace.singlePane')}</button>
          <button type="button" disabled={!profile} onClick={() => { setDetails(true); setMore(false) }}>{t('desk.connectionDetails')}</button>
          <button type="button" disabled={!state.tabs.length} onClick={() => { setClosing(state.tabs.map(tab => tab.id)); setMore(false) }}>{t('client.closeAllTerminals')}</button>
        </div>}</div>
      </div>
    </div>
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    {state.tabs.length ? <ResizableSplit storageKey="dsh-ssh:desk:sftp-width" label={t('client.adjustTheTerminalAndSftpWidths')} secondaryHidden={!showFiles} primary={<section className="dsh-ssh-workbench-terminal">{panes}</section>} secondary={files} /> : <div className="dsh-ssh-desk-empty"><p>{t('desk.noTerminals')}</p><div><button type="button" className="dsh-ssh-primary-button" onClick={() => setPicking(true)}>{t('terminal-workspace.newTerminal')}</button><button type="button" className="dsh-ssh-secondary-button" onClick={onManage}>{t('remote-workspace-tree.hostsProjects')}</button></div></div>}
    <footer className="dsh-ssh-desk-status"><span title={profile ? profileAddress(profile) : ''}>{profile ? `${profile.name} · ${profileAddress(profile)} · ${current?.directory ?? current?.path}` : t('desk.chooseTarget')}</span><div className="dsh-ssh-desk-controls">{controls}</div></footer>
    {closing && <Dialog variant="confirmation" title={t('desk.closeCount', [closing.length])} subtitle={t('terminal-workspace.closingDisconnectsThisTabSSshConnectionAndMay')} onClose={() => { if (!busy) setClosing(undefined) }}><div className="dsh-ssh-dialog-actions"><button type="button" disabled={busy} onClick={() => setClosing(undefined)}>{t('client.cancel')}</button><button type="button" disabled={busy} className="dsh-ssh-danger-button" onClick={() => { void closeTabs() }}>{t('terminal-workspace.closeConnection')}</button></div></Dialog>}
    {picking && <NewDeskTerminal profiles={profiles} initial={current} onClose={() => setPicking(false)} onOpen={(target, files) => { try { state.open(target, true, !files); setFilesOnly(files); setPicking(false); setError(undefined) } catch (reason) { setError(errorMessage(reason)) } }} />}
    {details && profile && <Dialog title={t('desk.connectionDetails')} onClose={() => setDetails(false)}><p>{profile.name} · {profileAddress(profile)}</p><p>{profile.hostFingerprint ?? t('desk.noFingerprint')}</p><p>{t('desk.proxy')}: {profile.proxy.type}</p><p>{t('terminal-session.retentionHint')}</p><p>{t('desk.restartHint')}</p></Dialog>}
  </div>
}
function NewDeskTerminal({ profiles, initial, onOpen, onClose }: { profiles: ProfileView[]; initial?: DeskTarget | undefined; onOpen(target: DeskTarget, filesOnly: boolean): void; onClose(): void }): JSX.Element {
  const [host, setHost] = useState(initial?.profileId ?? profiles[0]?.id ?? '')
  const [path, setPath] = useState(initial?.path ?? '~')
  const [projects, setProjects] = useState<RemoteProjectView[]>([])
  const [error, setError] = useState<string>()
  useEffect(() => { let live = true; setProjects([]); setError(undefined); if (host) void loadRemoteProjects(host).then(value => { if (live) setProjects(value) }).catch(reason => { if (live) setError(errorMessage(reason)) }); return () => { live = false } }, [host])
  const open = (filesOnly: boolean): void => onOpen({ profileId: host, path: path.trim() || '~', label: projects.find(project => project.path === path)?.name }, filesOnly)
  return <Dialog title={t('terminal-workspace.newTerminal')} onClose={onClose}><form className="dsh-ssh-form" onSubmit={event => { event.preventDefault(); open(false) }}><label className="dsh-ssh-field"><span>{t('client.host')}</span><select value={host} onChange={event => { setHost(event.target.value); setPath('~') }}>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name} · {profileAddress(profile)}</option>)}</select></label><label className="dsh-ssh-field"><span>{t('desk.projectDirectory')}</span><select value={projects.some(project => project.path === path) ? path : ''} onChange={event => { if (event.target.value) setPath(event.target.value) }}><option value="">{t('desk.customDirectory')}</option>{projects.map(project => <option key={project.id} value={project.path}>{project.name} · {project.path}</option>)}</select><input aria-label={t('desk.directory')} value={path} onChange={event => setPath(event.target.value)} /></label>{error && <p role="alert" className="dsh-ssh-inline-error">{error}</p>}<p className="dsh-ssh-form-hint">{t('desk.manualHint')}</p><div className="dsh-ssh-dialog-actions"><button type="button" disabled={!host} onClick={() => open(true)}>{t('desk.filesOnly')}</button><button type="submit" disabled={!host} className="dsh-ssh-primary-button">{t('terminal-session.connect2')}</button></div></form></Dialog>
}

function phaseText(phase: DeskTab['phase']): string {
  switch (phase) {
    case 'idle': return t('desk.phaseIdle')
    case 'connecting': return t('desk.phaseConnecting')
    case 'connected': return t('desk.phaseConnected')
    case 'error': return t('desk.phaseError')
  }
}
