import { t, tx } from './i18n.js'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent } from 'react'
import { IconChevronDownOutline14, IconChevronLeftOutline14, IconCloseOutline16, IconDataOutline16, IconPlusOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  cancelFileTransfer, deleteFileEndpointEntries, fileEndpointDownloadUrl, loadFileEndpointDirectory, loadFileEndpoints, loadTransferJobs, startFileTransfer,
  type FileEndpointView, type FtpProfileView, type ProxyEntryView, type SftpDirectoryView, type SftpEntryView, type TransferJobView, type VaultEntryView,
} from './client-api.js'
import type { SessionAccessState } from './session-access.js'
import { Dialog, errorMessage } from './ui-components.js'
import { FtpConnectionsDialog } from './ftp-profile-editor.js'
import {
  REMOTE_FILES_DRAG_TYPE, canTransferIntoRemoteDirectory, isNavigableRemoteEntry, isSameRemoteTransferLocation, parseRemoteFilesDragPayload,
  type RemoteFilesDragPayload,
} from './file-transfer-intent.js'
import { executeRemoteFileDrop } from './remote-file-drop.js'
import { FileEntryDeleteDialog } from './file-entry-delete-dialog.js'
import { sortFileEntries, type FileEntrySortDirection, type FileEntrySortKey } from './file-entry-sort.js'
import { useBorderGlowSurface } from './border-glow.js'

interface PaneState { id: string; endpointId: string; path: string }
interface TransferTab { id: string; name: string; panes: PaneState[] }
type TransferDragSource = RemoteFilesDragPayload
const STORAGE_KEY = 'dsh-ssh:file-transfer:tabs:v2'
const FILE_ROW_HEIGHT = 38
const transferClockFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export function FileTransferWorkspace({ ftpProfiles, vaultEntries, proxyEntries, access, onProfilesChanged }: { ftpProfiles: FtpProfileView[]; vaultEntries: VaultEntryView[]; proxyEntries: ProxyEntryView[]; access: SessionAccessState; onProfilesChanged(): void }): JSX.Element {
  const stageGlow = useBorderGlowSurface<HTMLElement>()
  const [endpoints, setEndpoints] = useState<FileEndpointView[]>([])
  const [jobs, setJobs] = useState<TransferJobView[]>([])
  const [tabs, setTabs] = useState<TransferTab[]>(() => restoreTabs())
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id ?? 'transfer-1')
  const [connectionsOpen, setConnectionsOpen] = useState(false)
  const [accessOpen, setAccessOpen] = useState(false)
  const [conflictJob, setConflictJob] = useState<TransferJobView>()
  const [dragSource, setDragSource] = useState<TransferDragSource>()
  const [error, setError] = useState<string>()
  const [directoryRevisions, setDirectoryRevisions] = useState<Record<string, number>>({})
  const previousJobStatesRef = useRef(new Map<string, TransferJobView['state']>())

  const refreshEndpoints = useCallback(async () => {
    try {
      const next = await loadFileEndpoints(); setEndpoints(next)
      setTabs(current => normalizeTabs(current, next))
    } catch (reason) { setError(errorMessage(reason)) }
  }, [])
  useEffect(() => { void refreshEndpoints() }, [refreshEndpoints, ftpProfiles])
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs)) } catch {} }, [tabs])
  useEffect(() => {
    const previous = previousJobStatesRef.current
    const changed = jobs.filter(job => isFinished(job.state) && previous.has(job.id) && !isFinished(previous.get(job.id)!))
    previousJobStatesRef.current = new Map(jobs.map(job => [job.id, job.state]))
    if (changed.length === 0) return
    setDirectoryRevisions(current => {
      const next = { ...current }
      for (const job of changed) {
        const key = directoryKey(job.request.destinationEndpointId, job.request.destinationDirectory)
        next[key] = (next[key] ?? 0) + 1
      }
      return next
    })
  }, [jobs])
  useEffect(() => {
    let stopped = false; let timer: number | undefined
    const poll = async (): Promise<void> => {
      if (document.visibilityState === 'hidden') { timer = window.setTimeout(() => { void poll() }, 1800); return }
      try { const next = await loadTransferJobs(); if (!stopped) setJobs(next) } catch {}
      if (!stopped) timer = window.setTimeout(() => { void poll() }, 800)
    }
    void poll(); return () => { stopped = true; if (timer !== undefined) clearTimeout(timer) }
  }, [])
  const active = tabs.find(tab => tab.id === activeTabId) ?? tabs[0]
  const updateActive = (mutator: (tab: TransferTab) => TransferTab): void => setTabs(current => current.map(tab => tab.id === active?.id ? mutator(tab) : tab))
  const addTab = (): void => {
    const id = `transfer-${Date.now().toString(36)}`
    const tab = createTab(id, tabs.length + 1)
    setTabs(current => [...current, tab]); setActiveTabId(id)
  }
  const closeTab = (id: string): void => {
    if (tabs.length === 1) return
    const index = tabs.findIndex(tab => tab.id === id)
    const next = tabs.filter(tab => tab.id !== id)
    setTabs(next); if (activeTabId === id) setActiveTabId(next[Math.max(0, index - 1)]!.id)
  }
  const setPaneCount = (count: number): void => updateActive(tab => ({ ...tab, panes: Array.from({ length: count }, (_, index) => tab.panes[index] ?? createPane(`${tab.id}-pane-${index}`)) }))
  const transfer = async (sourceEndpointId: string, sourceDirectory: string, sourcePaths: string[], destinationEndpointId: string, destinationDirectory: string): Promise<void> => {
    const source = { endpointId: sourceEndpointId, directory: sourceDirectory }
    const destination = { endpointId: destinationEndpointId, directory: destinationDirectory }
    if (isSameRemoteTransferLocation(source, destination) || !canTransferIntoRemoteDirectory(source, sourcePaths, destination)) return
    try { setError(undefined); const job = await startFileTransfer({ sourceEndpointId, sourcePaths, destinationEndpointId, destinationDirectory, conflictPolicy: 'fail' }); setJobs(current => [job, ...current.filter(item => item.id !== job.id)]) }
    catch (reason) { setError(errorMessage(reason)) }
  }
  const dropFiles = async (source: TransferDragSource, destination: PaneState, destinationDirectory: string): Promise<void> => {
    try {
      setError(undefined)
      const result = await executeRemoteFileDrop(source, { paneId: destination.id, endpointId: destination.endpointId, directory: destinationDirectory })
      if (result.job !== undefined) setJobs(current => [result.job!, ...current.filter(item => item.id !== result.job!.id)])
      if (result.operation === 'move') {
        setDirectoryRevisions(current => {
          const next = { ...current }
          for (const key of [directoryKey(source.endpointId, source.directory), directoryKey(destination.endpointId, destinationDirectory)]) next[key] = (next[key] ?? 0) + 1
          return next
        })
      }
    } catch (reason) { setError(errorMessage(reason)) }
  }
  return <div className="dsh-ssh-transfer-workspace">
    <header className="dsh-ssh-transfer-header">
      <div><h1>{t("File Transfer")}</h1><p>{t("Direct streaming transfers between FTP, FTPS, and SFTP")}</p></div>
      <div className="dsh-ssh-transfer-actions"><button type="button" data-ssh-interactive="control" className="dsh-ssh-secondary-button" onClick={() => setAccessOpen(true)}>Session access · {access.value?.fileEndpointIds.length ?? 0}</button><button type="button" data-ssh-interactive="control" className="dsh-ssh-secondary-button" onClick={() => setConnectionsOpen(true)}>{t("FTP manager")}</button></div>
    </header>
    {error && <div className="dsh-ssh-banner is-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError(undefined)} aria-label={t("Close")}><IconCloseOutline16 size={16} /></button></div>}
    <section ref={stageGlow.ref} onPointerMove={stageGlow.onPointerMove} onPointerLeave={stageGlow.onPointerLeave} className="dsh-ssh-transfer-stage dsh-ssh-border-surface">
      <div className="dsh-ssh-transfer-tabbar" role="tablist" aria-label={t("File transfer tasks page")}>
        <div className="dsh-ssh-transfer-tabs">{tabs.map(tab => <span data-ssh-interactive="choice" className={`dsh-ssh-transfer-tab${tab.id === active?.id ? ' is-active' : ''}`} key={tab.id}><button type="button" role="tab" aria-selected={tab.id === active?.id} onClick={() => setActiveTabId(tab.id)}>{tab.name}</button>{tabs.length > 1 && <button type="button" className="is-close" aria-label={tx`Close ${tab.name}`} onClick={() => closeTab(tab.id)}><IconCloseOutline16 size={13} /></button>}</span>)}<button type="button" data-ssh-interactive="control" className="is-add" aria-label={t("New transfer tasks page")} onClick={addTab}><IconPlusOutline16 size={15} /></button></div>
        <div className="dsh-ssh-pane-layout" aria-label={t("Panes")}>{[2, 3, 4].map(count => <button key={count} type="button" data-ssh-interactive="choice" aria-pressed={active?.panes.length === count} className={active?.panes.length === count ? 'is-active' : ''} onClick={() => setPaneCount(count)}>{count} panes</button>)}</div>
      </div>
      {endpoints.length === 0 ? <div className="dsh-ssh-transfer-empty"><IconDataOutline16 size={24} /><strong>{t("No file connections available yet")}</strong><p>{t("Create an FTP/FTPS connection, or add an SSH host first to use SFTP.")}</p><button type="button" className="dsh-ssh-primary-button" onClick={() => setConnectionsOpen(true)}>{t("New FTP connection")}</button></div>
        : active && <div className={`dsh-ssh-transfer-panes has-${active.panes.length}`}>{active.panes.map((pane, index) => {
          const destination = active.panes[(index + 1) % active.panes.length]
          return <FileTransferPane key={pane.id} pane={pane} endpoints={endpoints} dragSource={dragSource} refreshRevision={directoryRevisions[directoryKey(pane.endpointId, pane.path)] ?? 0} {...destination === undefined ? {} : { destination }} onManageConnections={() => setConnectionsOpen(true)} onDragSourceChange={setDragSource} onChange={patch => updateActive(tab => ({ ...tab, panes: tab.panes.map(item => item.id === pane.id ? { ...item, ...patch } : item) }))} onTransfer={(paths, target) => { void transfer(pane.endpointId, pane.path, paths, target.endpointId, target.path) }} onExternalDrop={(source, destinationDirectory) => { void dropFiles(source, pane, destinationDirectory) }} />
        })}</div>}
      <TransferQueue jobs={jobs} endpoints={endpoints} onCancel={async id => { try { await cancelFileTransfer(id); setJobs(current => current.map(job => job.id === id ? { ...job, state: 'cancelled' } : job)) } catch (reason) { setError(errorMessage(reason)) } }} onConflict={setConflictJob} />
    </section>
    {connectionsOpen && <FtpConnectionsDialog profiles={ftpProfiles} vaultEntries={vaultEntries} proxyEntries={proxyEntries} onClose={() => setConnectionsOpen(false)} onChanged={() => { onProfilesChanged(); void refreshEndpoints() }} />}
    {accessOpen && <FileAccessDialog endpoints={endpoints} access={access} onClose={() => setAccessOpen(false)} />}
    {conflictJob && <ConflictDialog job={conflictJob} onClose={() => setConflictJob(undefined)} onRetry={async conflictPolicy => { try { const next = await startFileTransfer({ ...conflictJob.request, conflictPolicy }); setJobs(current => [next, ...current]); setConflictJob(undefined) } catch (reason) { setError(errorMessage(reason)) } }} />}
  </div>
}

function FileTransferPane({ pane, endpoints, destination, dragSource, refreshRevision, onChange, onTransfer, onExternalDrop, onDragSourceChange, onManageConnections }: { pane: PaneState; endpoints: FileEndpointView[]; destination?: PaneState; dragSource?: TransferDragSource | undefined; refreshRevision: number; onChange(patch: Partial<PaneState>): void; onTransfer(paths: string[], destination: PaneState): void; onExternalDrop(source: TransferDragSource, destinationDirectory: string): void; onDragSourceChange(source?: TransferDragSource): void; onManageConnections(): void }): JSX.Element {
  const [view, setView] = useState<SftpDirectoryView>()
  const [selected, setSelected] = useState<string[]>([])
  const [draftPath, setDraftPath] = useState(pane.path)
  const [loading, setLoading] = useState(false)
  const [scrollTop, setScrollTop] = useState(0)
  const [sort, setSort] = useState<{ key: FileEntrySortKey; direction: FileEntrySortDirection }>({ key: 'name', direction: 'asc' })
  const [dragOver, setDragOver] = useState(false)
  const [directoryDropTarget, setDirectoryDropTarget] = useState<string>()
  const [deleteTarget, setDeleteTarget] = useState<SftpEntryView[]>()
  const [error, setError] = useState<string>()
  const bodyRef = useRef<HTMLDivElement>(null)
  const loadGenerationRef = useRef(0)
  const endpoint = endpoints.find(item => item.id === pane.endpointId)
  const entries = useMemo(() => sortFileEntries(view?.entries ?? [], sort.key, sort.direction), [view?.entries, sort])
  const virtualized = entries.length > 200
  const virtualStart = virtualized ? Math.max(0, Math.floor(scrollTop / FILE_ROW_HEIGHT) - 8) : 0
  const visibleEntries = useMemo(() => virtualized ? entries.slice(virtualStart, Math.min(entries.length, virtualStart + 56)) : entries, [entries, virtualStart, virtualized])
  const load = useCallback(async (path = pane.path): Promise<void> => {
    if (endpoint === undefined) return
    const generation = ++loadGenerationRef.current
    setLoading(true); setError(undefined)
    try { const next = await loadFileEndpointDirectory(pane.id, endpoint.id, path); if (generation !== loadGenerationRef.current) return; setView(next); setDraftPath(next.path); setSelected([]); setScrollTop(0); if (bodyRef.current) bodyRef.current.scrollTop = 0; onChange({ endpointId: endpoint.id, path: next.path }) }
    catch (reason) { if (generation === loadGenerationRef.current) setError(errorMessage(reason)) } finally { if (generation === loadGenerationRef.current) setLoading(false) }
  }, [endpoint?.id, pane.path])
  useEffect(() => { if (endpoint !== undefined) void load(pane.path) }, [endpoint?.id, refreshRevision])
  useEffect(() => { if (dragSource === undefined) { setDragOver(false); setDirectoryDropTarget(undefined) } }, [dragSource])
  const submitPath = (event: FormEvent): void => { event.preventDefault(); void load(draftPath) }
  const changeSort = (key: FileEntrySortKey): void => {
    setSort(current => current.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' })
    setScrollTop(0)
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }
  const chooseEndpoint = (next: FileEndpointView): void => { loadGenerationRef.current += 1; onChange({ endpointId: next.id, path: next.initialPath }); setDraftPath(next.initialPath); setView(undefined); setError(undefined) }
  const showConnections = (): void => { loadGenerationRef.current += 1; onChange({ endpointId: '', path: '/' }); setView(undefined); setSelected([]); setError(undefined); setLoading(false) }
  const select = (entry: SftpEntryView, additive: boolean): void => setSelected(current => additive ? current.includes(entry.path) ? current.filter(path => path !== entry.path) : [...current, entry.path] : [entry.path])
  const removeSelected = async (): Promise<void> => {
    if (deleteTarget === undefined || view === undefined || endpoint === undefined) return
    try {
      await deleteFileEndpointEntries({ paneId: pane.id, endpointId: endpoint.id, directory: view.path, paths: deleteTarget.map(entry => entry.path) })
      setSelected([])
    } finally { await load(view.path) }
  }
  const drop = (event: DragEvent): void => {
    event.preventDefault(); setDragOver(false)
    const payload = parseRemoteFilesDragPayload(event.dataTransfer.getData(REMOTE_FILES_DRAG_TYPE))
    onDragSourceChange(undefined)
    if (payload === undefined || payload.paneId === pane.id || isSameRemoteTransferLocation(payload, { endpointId: pane.endpointId, directory: pane.path })) return
    onExternalDrop(payload, pane.path)
  }
  if (endpoint === undefined) return <section className="dsh-ssh-file-pane is-connections">
    <header><span className="dsh-ssh-pane-heading"><strong>{t("Connection list")}</strong><small>{t("Click a connection to browse remote files")}</small></span><button type="button" data-ssh-interactive="control" className="dsh-ssh-pane-manage-button" onClick={onManageConnections}>{t("FTP manager")}</button></header>
    <div className="dsh-ssh-endpoint-list">{endpoints.map(item => <button type="button" data-ssh-interactive="row" key={item.id} className="dsh-ssh-endpoint-row" onClick={() => chooseEndpoint(item)}><span className={`dsh-ssh-protocol-badge is-${item.protocol}`}>{protocolShort(item.protocol)}</span><span><strong title={item.name}>{item.name}</strong><small title={item.address}>{item.address}</small></span><span><i className={`dsh-ssh-protocol-dot is-${item.protocol}`} aria-hidden="true" />{item.group ?? (item.kind === 'sftp' ? t("SSH hosts") : t("File connections"))}</span></button>)}</div>
    <footer><span>{endpoints.length} connections available</span><small>{t("SFTP reuses SSH host configuration")}</small></footer>
  </section>
  return <section className={`dsh-ssh-file-pane${dragOver ? ' is-drop-target' : ''}`} onDragOver={event => { if (event.dataTransfer.types.includes(REMOTE_FILES_DRAG_TYPE) && canDropIntoPane(dragSource, pane)) { event.preventDefault(); event.dataTransfer.dropEffect = dragSource?.endpointId === pane.endpointId ? 'move' : 'copy'; setDirectoryDropTarget(undefined); setDragOver(true) } else if (dragOver) setDragOver(false) }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) { setDragOver(false); setDirectoryDropTarget(undefined) } }} onDrop={drop}>
    <header><button type="button" className="dsh-ssh-pane-back" aria-label={t("Back to connection list")} onClick={showConnections}><IconChevronLeftOutline14 size={14} /></button><span className="dsh-ssh-pane-endpoint"><strong>{endpoint.name}</strong><small title={endpoint.address}>{endpoint.address}</small></span><span className={`dsh-ssh-protocol-badge is-${endpoint.protocol}`}>{protocolShort(endpoint.protocol)}</span></header>
    <form className="dsh-ssh-file-pathbar" onSubmit={submitPath}><button type="button" aria-label={t("Parent directory")} disabled={view?.parent === null || loading} onClick={() => { if (view?.parent) void load(view.parent) }}><UpGlyph /></button><button type="button" aria-label={t("Refresh directory")} disabled={loading} onClick={() => { void load() }}><RefreshGlyph /></button><input aria-label={t("Remote path")} value={draftPath} onChange={event => setDraftPath(event.target.value)} /><button type="submit" disabled={loading}>{t("Go to")}</button></form>
    <div className="dsh-ssh-file-table" role="grid" aria-busy={loading}>
      <div className="dsh-ssh-file-table-head" role="row">
        <SortColumn label={t("Name")} sortKey="name" current={sort} onSort={changeSort} />
        <SortColumn label={t("Size")} sortKey="size" current={sort} onSort={changeSort} />
        <SortColumn label={t("Modified")} sortKey="modifiedAt" current={sort} onSort={changeSort} />
        <span role="columnheader" aria-label={t("Actions")} />
      </div>
      <div ref={bodyRef} className="dsh-ssh-file-table-body" onScroll={event => { if (virtualized) setScrollTop(event.currentTarget.scrollTop) }}>{loading && !view ? <div className="dsh-ssh-file-loading">{t("Reading directory…")}</div> : error ? <div className="dsh-ssh-file-error"><span>{error}</span><button type="button" onClick={() => { void load() }}>{t("Retry")}</button></div> : entries.length === 0 ? <div className="dsh-ssh-table-empty">{t("This directory is empty.")}</div> : <div className={virtualized ? 'dsh-ssh-file-virtual-list' : undefined} style={virtualized ? { height: `${entries.length * FILE_ROW_HEIGHT}px` } : undefined}>{visibleEntries.map((entry, offset) => <FileEntryRow key={entry.path} entry={entry} paneId={pane.id} endpointId={endpoint.id} sourceDirectory={view?.path ?? pane.path} dragSource={dragSource} dropTarget={directoryDropTarget === entry.path} selected={selected.includes(entry.path)} selectedPaths={selected} {...virtualized ? { style: { position: 'absolute', insetInline: 0, transform: `translateY(${(virtualStart + offset) * FILE_ROW_HEIGHT}px)` } } : {}} onDelete={() => setDeleteTarget([entry])} onDirectoryTarget={target => { setDragOver(false); setDirectoryDropTarget(target) }} onDropIntoDirectory={(payload, target) => { setDirectoryDropTarget(undefined); onDragSourceChange(undefined); onExternalDrop(payload, target) }} onDragSourceChange={onDragSourceChange} onSelect={additive => select(entry, additive)} onOpen={() => { void load(entry.path) }} />)}</div>}</div>
    </div>
    <footer><span>{selected.length > 0 ? tx`Selected ${selected.length} items` : tx`${view?.entries.length ?? 0} items`}</span><span className="dsh-ssh-file-pane-actions"><button type="button" data-ssh-interactive="control" className="dsh-ssh-transfer-to-button" disabled={selected.length === 0 || destination === undefined || !destination.endpointId || loading} onClick={() => { if (destination?.endpointId) onTransfer(selected, destination) }}>{t("Send to next pane ")}<span aria-hidden="true">→</span></button></span></footer>
    {dragOver && <div className="dsh-ssh-file-drop-overlay"><strong>{dragSource?.endpointId === pane.endpointId ? t("Move to this directory") : t("Copy to this directory")}</strong><span>{view?.path ?? pane.path}</span></div>}
    {deleteTarget !== undefined && <FileEntryDeleteDialog locationName={endpoint.name} locationKind="remote" entries={deleteTarget} onClose={() => setDeleteTarget(undefined)} onDelete={removeSelected} />}
  </section>
}

function SortColumn({ label, sortKey, current, onSort }: { label: string; sortKey: FileEntrySortKey; current: { key: FileEntrySortKey; direction: FileEntrySortDirection }; onSort(key: FileEntrySortKey): void }): JSX.Element {
  const active = current.key === sortKey
  return <span role="columnheader" aria-sort={active ? (current.direction === 'asc' ? 'ascending' : 'descending') : 'none'}><button type="button" onClick={() => onSort(sortKey)}>{label}<SortGlyph active={active} direction={current.direction} /></button></span>
}

function SortGlyph({ active, direction }: { active: boolean; direction: FileEntrySortDirection }): JSX.Element {
  return <svg className={active ? 'is-active' : ''} viewBox="0 0 12 12" aria-hidden="true"><path d="m3.5 5 2.5 2.5L8.5 5" transform={direction === 'desc' ? undefined : 'rotate(180 6 6)'} /></svg>
}

function DownloadGlyph(): JSX.Element {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v7m0 0 2.6-2.6M8 9 5.4 6.4M3 11.5v1.25h10V11.5" /></svg>
}

function FileEntryRow({ entry, paneId, endpointId, sourceDirectory, dragSource, dropTarget, selected, selectedPaths, style, onSelect, onOpen, onDelete, onDirectoryTarget, onDropIntoDirectory, onDragSourceChange }: { entry: SftpEntryView; paneId: string; endpointId: string; sourceDirectory: string; dragSource?: TransferDragSource | undefined; dropTarget: boolean; selected: boolean; selectedPaths: string[]; style?: CSSProperties | undefined; onSelect(additive: boolean): void; onOpen(): void; onDelete(): void; onDirectoryTarget(path?: string): void; onDropIntoDirectory(payload: TransferDragSource, destinationDirectory: string): void; onDragSourceChange(source?: TransferDragSource): void }): JSX.Element {
  const directory = isNavigableRemoteEntry(entry)
  const acceptsDrop = directory && (dragSource === undefined || canTransferIntoRemoteDirectory(dragSource, dragSource.paths, { endpointId, directory: entry.path }))
  const dropIntoDirectory = (event: DragEvent): void => {
    if (!directory) return
    event.preventDefault(); event.stopPropagation(); onDirectoryTarget(undefined)
    const payload = parseRemoteFilesDragPayload(event.dataTransfer.getData(REMOTE_FILES_DRAG_TYPE))
    if (payload !== undefined && canTransferIntoRemoteDirectory(payload, payload.paths, { endpointId, directory: entry.path })) onDropIntoDirectory(payload, entry.path)
  }
  return <div
    role="row"
    data-ssh-interactive="row"
    data-ssh-context-row
    tabIndex={0}
    aria-selected={selected}
    aria-label={`${entry.name}${directory ? t(", directory, click to enter; accepts drag & drop") : ''}`}
    draggable={entry.kind === 'file' || directory}
    className={`dsh-ssh-file-row is-${directory ? 'directory' : entry.kind}${selected ? ' is-selected' : ''}${dropTarget ? ' is-drop-target' : ''}`}
    style={style}
    onClick={event => { if (directory && !event.ctrlKey && !event.metaKey && !event.shiftKey) onOpen(); else onSelect(event.ctrlKey || event.metaKey) }}
    onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter' && directory) onOpen(); if (event.key === ' ') { event.preventDefault(); onSelect(event.ctrlKey || event.metaKey) } }}
    onDragStart={event => { const paths = selected ? selectedPaths : [entry.path]; const source = { paneId, endpointId, directory: sourceDirectory, paths }; onDragSourceChange(source); event.dataTransfer.effectAllowed = 'copyMove'; event.dataTransfer.setData(REMOTE_FILES_DRAG_TYPE, JSON.stringify(source)) }}
    onDragEnd={() => onDragSourceChange(undefined)}
    onDragOver={event => { if (event.dataTransfer.types.includes(REMOTE_FILES_DRAG_TYPE) && acceptsDrop) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = dragSource?.endpointId === endpointId ? 'move' : 'copy'; onDirectoryTarget(entry.path) } }}
    onDragLeave={event => { if (dropTarget && !event.currentTarget.contains(event.relatedTarget as Node)) onDirectoryTarget(undefined) }}
    onDrop={dropIntoDirectory}
  ><span><FileGlyph directory={directory} /><i title={entry.name}>{entry.name}</i></span><span>{directory ? '—' : formatBytes(entry.size)}</span><span>{entry.modifiedAt > 0 ? new Date(entry.modifiedAt).toLocaleString() : '—'}</span><span className="dsh-ssh-file-row-actions dsh-ssh-context-action">{(entry.kind === 'file' || entry.kind === 'directory') && <a className="dsh-ssh-file-row-download" href={fileEndpointDownloadUrl(endpointId, entry.path)} download={entry.kind === 'directory' ? `${entry.name}.tar` : entry.name} draggable={false} aria-label={tx`Download ${entry.name} locally`} title={entry.kind === 'directory' ? tx`Package ${entry.name} and download locally` : tx`Download ${entry.name} locally`} onClick={event => event.stopPropagation()}><DownloadGlyph /></a>}<button type="button" className="dsh-ssh-file-row-delete" draggable={false} aria-label={tx`Delete ${entry.name}`} title={tx`Delete ${entry.name}`} onClick={event => { event.stopPropagation(); onDelete() }}><IconTrashOutline16 size={14} /></button></span></div>
}

function TransferQueue({ jobs, endpoints, onCancel, onConflict }: { jobs: TransferJobView[]; endpoints: FileEndpointView[]; onCancel(id: string): Promise<void>; onConflict(job: TransferJobView): void }): JSX.Element {
  const [open, setOpen] = useState(true)
  const active = jobs.filter(job => job.state === 'queued' || job.state === 'scanning' || job.state === 'transferring')
  return <section className={`dsh-ssh-transfer-queue${open ? ' is-open' : ''}`}>
    <button type="button" className="dsh-ssh-transfer-queue-heading" aria-expanded={open} title={open ? t("Collapse transfer tasks") : t("Expand transfer tasks")} onClick={() => setOpen(value => !value)}><span><strong>{t("Transfer tasks")}</strong><small>{active.length > 0 ? tx`${active.length} in progress` : jobs.length > 0 ? t("Recent tasks") : t("No tasks yet")}</small></span><span className="dsh-ssh-transfer-queue-disclosure" aria-hidden="true"><IconChevronDownOutline14 size={14} /></span></button>
    {open && <div className="dsh-ssh-transfer-job-list">{jobs.length === 0 ? <p>{t("Drag from one pane to another, or select files and click “Send to next pane”.")}</p> : jobs.slice(0, 12).map(job => {
      const progress = job.totalBytes > 0 ? Math.min(100, job.transferredBytes / job.totalBytes * 100) : job.state === 'completed' ? 100 : 0
      return <article key={job.id}><span className={`dsh-ssh-transfer-state is-${job.state}`} aria-hidden="true" /><span className="dsh-ssh-transfer-job-copy"><strong>{remoteLabel(job.request.sourcePaths)} <i>→</i> {endpointName(endpoints, job.request.destinationEndpointId)}</strong><small>{job.error ?? jobLabel(job, progress)}</small><span className="dsh-ssh-transfer-job-time">{jobTimeLabel(job)}</span><span className="dsh-ssh-transfer-progress"><i style={{ transform: tx`scaleX(${progress / 100})` }} /></span></span>{(job.state === 'queued' || job.state === 'scanning' || job.state === 'transferring') ? <button type="button" className="dsh-ssh-icon-button" aria-label={t("Cancel transfer")} onClick={() => { void onCancel(job.id) }}><IconCloseOutline16 size={15} /></button> : job.state === 'failed' && job.error?.includes('destination already contains') ? <button type="button" className="dsh-ssh-job-resolve" onClick={() => onConflict(job)}>{t("Handle")}</button> : null}</article>
    })}</div>}
  </section>
}

function ConflictDialog({ job, onClose, onRetry }: { job: TransferJobView; onClose(): void; onRetry(policy: 'skip' | 'overwrite' | 'rename'): Promise<void> }): JSX.Element {
  const [policy, setPolicy] = useState<'skip' | 'overwrite' | 'rename'>('rename')
  const [saving, setSaving] = useState(false)
  return <Dialog className="dsh-ssh-transfer-conflict-dialog" title={t("A file with the same name exists at the destination")} subtitle={t("Choose how to handle this batch of transfers")} onClose={onClose}><div className="dsh-ssh-transfer-conflict-copy"><strong>{remoteLabel(job.request.sourcePaths)}</strong><span>{job.request.destinationDirectory}</span></div><div className="dsh-ssh-conflict-options">{([['rename', t("Auto rename"), t("Keep both files; append a number to the name")], ['skip', t("Skip files with the same name"), t("Continue transferring the remaining items")], ['overwrite', t("Overwrite the target files"), t("Replace the destination content with the source content")]] as const).map(option => <button type="button" data-ssh-interactive="choice" aria-pressed={policy === option[0]} key={option[0]} className={policy === option[0] ? 'is-active' : ''} onClick={() => setPolicy(option[0])}><i aria-hidden="true" /><span><strong>{option[1]}</strong><small>{option[2]}</small></span></button>)}</div><div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" data-ssh-dialog-close onClick={onClose}>{t("Cancel")}</button><button type="button" className="dsh-ssh-primary-button" disabled={saving} onClick={() => { setSaving(true); void onRetry(policy).finally(() => setSaving(false)) }}>{saving ? t("Re-queuing…") : t("Continue transfer")}</button></div></Dialog>
}

function FileAccessDialog({ endpoints, access, onClose }: { endpoints: FileEndpointView[]; access: SessionAccessState; onClose(): void }): JSX.Element {
  const value = access.value
  const mounted = endpoints.filter(endpoint => value?.fileEndpointIds.includes(endpoint.id)).length
  const toggle = (id: string): void => access.setFileEndpoints(value?.fileEndpointIds.includes(id) ? value.fileEndpointIds.filter(item => item !== id) : [...(value?.fileEndpointIds ?? []), id])
  return <Dialog className="dsh-ssh-file-access-dialog" title={t("Session access")} subtitle={t("Manage the remote file connections available to this session")} onClose={onClose}>
    <div className="dsh-ssh-file-access-body dsh-ssh-scroll-surface">
      {access.error && <p className="dsh-ssh-inline-error" role="alert">{access.error}</p>}
      <section className="dsh-ssh-file-access-section" aria-labelledby="dsh-ssh-file-access-connections">
        <header><span><strong id="dsh-ssh-file-access-connections">{t("File connections")}</strong><small>{t("Let the current session browse selected FTP, FTPS, or SFTP")}</small></span><i>{mounted.toString().padStart(2, '0')} / {endpoints.length.toString().padStart(2, '0')}</i></header>
        <div className="dsh-ssh-file-access-list">{access.loading ? <FileAccessSkeleton /> : endpoints.length === 0 ? <div className="dsh-ssh-file-access-empty"><strong>{t("No connections available")}</strong><small>{t("Add an FTP connection in File Transfer first, or add an SSH host in the hosts panel.")}</small></div> : endpoints.map(endpoint => <FileAccessEndpoint key={endpoint.id} endpoint={endpoint} enabled={value?.fileEndpointIds.includes(endpoint.id) ?? false} onToggle={() => toggle(endpoint.id)} />)}</div>
      </section>
      <section className="dsh-ssh-file-access-section is-options" aria-labelledby="dsh-ssh-file-access-policy">
        <header><span><strong id="dsh-ssh-file-access-policy">{t("Access policy")}</strong><small>{t("File permissions are independent of SSH command and terminal permissions")}</small></span></header>
        <div className="dsh-ssh-file-access-options">
          <div className="dsh-ssh-file-access-policy-row"><span><strong>{t("File operation permission")}</strong><small>{t("Browse mode does not expose cross-endpoint transfer tools to the AI")}</small></span><FilePermissionPicker value={value?.filePermission ?? 'browse'} onChange={access.setFilePermission} /></div>
          <div className="dsh-ssh-file-access-policy-row"><span><strong>{t("Confirm before transfer")}</strong><small>{t("Request DSH approval when the AI starts a transfer")}</small></span><FileApprovalSwitch checked={value?.requireFileApproval ?? true} onChange={access.setRequireFileApproval} /></div>
        </div>
      </section>
    </div>
    <footer className="dsh-ssh-file-access-footer"><span className={access.saving ? 'is-saving' : 'is-saved'}><i aria-hidden="true" />{access.saving ? t("Saving changes") : tx`${mounted > 0 ? tx`Authorized ${mounted} connections` : t("No authorized connections")} · autosaves`}</span><button type="button" className="dsh-ssh-primary-button" data-ssh-dialog-close disabled={access.saving} onClick={onClose}>{access.saving ? t("Saving…") : t("Done")}</button></footer>
  </Dialog>
}

function FileAccessEndpoint({ endpoint, enabled, onToggle }: { endpoint: FileEndpointView; enabled: boolean; onToggle(): void }): JSX.Element {
  return <button type="button" data-ssh-interactive="choice" className={`dsh-ssh-file-access-endpoint${enabled ? ' is-mounted' : ''}`} aria-pressed={enabled} onClick={onToggle}>
    <span className={`dsh-ssh-protocol-badge is-${endpoint.protocol}`}>{protocolShort(endpoint.protocol)}</span>
    <span className="dsh-ssh-file-access-endpoint-copy"><strong title={endpoint.name}>{endpoint.name}</strong><small title={endpoint.address}>{endpoint.address}</small></span>
    <span className="dsh-ssh-file-access-state"><i aria-hidden="true"><b /></i><em>{enabled ? t("Authorized") : t("Not authorized")}</em></span>
  </button>
}

function FileAccessSkeleton(): JSX.Element {
  return <div className="dsh-ssh-file-access-skeleton" aria-label={t("Reading session permissions")}>{[0, 1, 2].map(index => <span key={index} style={{ '--ssh-skeleton-index': index } as CSSProperties}><i /><b><i /><i /></b><em /></span>)}</div>
}

function FilePermissionPicker({ value, onChange }: { value: 'browse' | 'transfer'; onChange(value: 'browse' | 'transfer'): void }): JSX.Element {
  return <div className="dsh-ssh-file-permission-picker" role="radiogroup" aria-label={t("File operation permissions")}>{([['browse', t("Browse only")], ['transfer', t("Allow transfer")]] as const).map(([id, label]) => <button type="button" data-ssh-interactive="choice" role="radio" aria-checked={value === id} className={value === id ? 'is-active' : ''} key={id} onClick={() => onChange(id)}>{label}</button>)}</div>
}

function FileApprovalSwitch({ checked, onChange }: { checked: boolean; onChange(value: boolean): void }): JSX.Element {
  return <button type="button" data-ssh-interactive="choice" role="switch" aria-checked={checked} className={`dsh-ssh-file-approval-switch${checked ? ' is-active' : ''}`} onClick={() => onChange(!checked)}><i aria-hidden="true"><b /></i><span>{checked ? t("Confirmation required") : t("Run directly")}</span></button>
}

function restoreTabs(): TransferTab[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown
    if (!Array.isArray(value)) return [createTab('transfer-1', 1)]
    const tabs = value.slice(0, 8).flatMap((candidate): TransferTab[] => {
      if (typeof candidate !== 'object' || candidate === null) return []
      const tab = candidate as Partial<TransferTab>
      if (typeof tab.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(tab.id) || typeof tab.name !== 'string' || !Array.isArray(tab.panes)) return []
      const panes = tab.panes.slice(0, 4).flatMap((pane): PaneState[] => {
        if (typeof pane !== 'object' || pane === null) return []
        const state = pane as Partial<PaneState>
        return typeof state.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(state.id) && typeof state.endpointId === 'string' && typeof state.path === 'string'
          ? [{ id: state.id, endpointId: '', path: '/' }]
          : []
      })
      return panes.length >= 2 ? [{ id: tab.id, name: tab.name.slice(0, 40), panes }] : []
    })
    if (tabs.length > 0) return tabs
  } catch {}
  return [createTab('transfer-1', 1)]
}
function createTab(id: string, index: number): TransferTab { return { id, name: tx`Tasks ${index}`, panes: [createPane(`${id}-a`), createPane(`${id}-b`)] } }
function createPane(id: string): PaneState { return { id, endpointId: '', path: '/' } }
function normalizeTabs(tabs: TransferTab[], endpoints: FileEndpointView[]): TransferTab[] { return tabs.map(tab => ({ ...tab, panes: tab.panes.map(pane => !pane.endpointId || endpoints.some(item => item.id === pane.endpointId) ? pane : createPane(pane.id)) })) }
function endpointName(endpoints: FileEndpointView[], id: string): string { return endpoints.find(endpoint => endpoint.id === id)?.name ?? id }
function remoteLabel(paths: string[]): string { const name = paths[0]?.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? t("Files"); return paths.length > 1 ? tx`${name} and ${paths.length} more` : name }
function protocolShort(protocol: FileEndpointView['protocol']): string { return protocol === 'sftp' ? 'SFTP' : protocol === 'ftp' ? 'FTP' : protocol === 'ftps-explicit' ? 'FTPS' : 'FTPS-I' }
function directoryKey(endpointId: string, value: string): string { return JSON.stringify([endpointId, value.replaceAll('\\', '/').replace(/\/+$/, '') || '/']) }
function canDropIntoPane(source: TransferDragSource | undefined, pane: PaneState): boolean { return source === undefined || (source.paneId !== pane.id && !isSameRemoteTransferLocation(source, { endpointId: pane.endpointId, directory: pane.path })) }
function isFinished(state: TransferJobView['state']): boolean { return state === 'completed' || state === 'failed' || state === 'cancelled' }
function formatBytes(value: number): string { if (value < 1024) return `${value} B`; if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`; if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`; return `${(value / 1024 ** 3).toFixed(2)} GB` }
function jobLabel(job: TransferJobView, progress: number): string { if (job.state === 'queued') return t("Waiting to transfer"); if (job.state === 'scanning') return t("Scanning directories"); if (job.state === 'transferring') { const seconds = Math.max(1, (Date.now() - (job.startedAt ?? Date.now())) / 1000); const speed = job.transferredBytes / seconds; const remaining = speed > 0 ? Math.max(0, (job.totalBytes - job.transferredBytes) / speed) : 0; return `${progress.toFixed(0)}% · ${formatBytes(speed)}/s${remaining > 1 ? tx` · ~ ${formatDuration(remaining)}` : ''}` } if (job.state === 'completed') return tx`Completed ${job.completedFiles} files${job.skippedFiles ? tx`, skipped ${job.skippedFiles}` : ''}`; if (job.state === 'cancelled') return t("Cancelled"); return t("Transfer failed") }
function jobTimeLabel(job: TransferJobView): string {
  if (job.startedAt === undefined) return tx`Created ${formatClock(job.createdAt)}`
  const end = job.completedAt ?? Date.now()
  const elapsed = formatElapsed(Math.max(0, end - job.startedAt))
  return job.completedAt === undefined ? tx`Executed ${elapsed}` : tx`Took ${elapsed} · completed ${formatClock(job.completedAt)}`
}
function formatClock(timestamp: number): string { return transferClockFormatter.format(timestamp) }
function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  if (seconds < 60) return tx`${seconds} seconds`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return tx`${minutes} minutes ${String(seconds % 60).padStart(2, '0')} seconds`
  return tx`${Math.floor(minutes / 60)} hours ${String(minutes % 60).padStart(2, '0')} minutes`
}
function formatDuration(seconds: number): string { if (seconds < 60) return tx`${Math.ceil(seconds)} seconds`; const minutes = Math.ceil(seconds / 60); return minutes < 60 ? tx`${minutes} minutes` : tx`${Math.floor(minutes / 60)} hours ${minutes % 60} minutes` }
function UpGlyph(): JSX.Element { return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12V4m0 0L4.8 7.2M8 4l3.2 3.2" /></svg> }
function RefreshGlyph(): JSX.Element { return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.2 5.2A5 5 0 1 0 13 9M12.2 5.2V2.5m0 2.7H9.5" /></svg> }
function FileGlyph({ directory }: { directory: boolean }): JSX.Element { return <svg viewBox="0 0 16 16" aria-hidden="true">{directory ? <path d="M2 4.3h4l1.2 1.4H14v6.8H2z" /> : <path d="M3.2 2h6l3.6 3.6V14H3.2zm6 0v3.6h3.6" />}</svg> }
