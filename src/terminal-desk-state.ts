import { BrowserTerminalHandle, readTerminalStorage, writeTerminalStorage, readWorkbenchState } from './terminal-workspace-state.js'

export interface DeskTarget { profileId: string; path: string; label?: string | undefined }
export interface DeskPane extends DeskTarget {
  id: number; directory?: string | undefined; handle: BrowserTerminalHandle
  autoConnect: boolean; phase: 'idle' | 'connecting' | 'connected' | 'error'
}
export type DeskLayout = number | { direction: 'horizontal' | 'vertical'; first: DeskLayout; second: DeskLayout }
export interface DeskTab extends DeskTarget {
  id: number; panes: DeskPane[]; layout: DeskLayout; focused: number; filesOnly: boolean
}
export interface PaneRect { id: number; left: number; top: number; width: number; height: number }
/** Horizontal means side by side; vertical means top and bottom. Existing leaves never move in the DOM. */
export function deskPaneRects(layout: DeskLayout, rect = { left: 0, top: 0, width: 100, height: 100 }): PaneRect[] {
  if (typeof layout === 'number') return [{ id: layout, ...rect }]
  const horizontal = layout.direction === 'horizontal'
  const first = { ...rect, ...(horizontal ? { width: rect.width / 2 } : { height: rect.height / 2 }) }
  const second = { ...first, ...(horizontal ? { left: rect.left + first.width } : { top: rect.top + first.height }) }
  return [...deskPaneRects(layout.first, first), ...deskPaneRects(layout.second, second)]
}
export type DeskLayoutMode = 'single' | 'horizontal' | 'vertical' | 'grid'
export function deskLayoutSize(mode: DeskLayoutMode): number { return mode === 'single' ? 1 : mode === 'grid' ? 4 : 2 }
function fixedLayout(ids: number[], mode: DeskLayoutMode): DeskLayout {
  if (ids.length === 1) return ids[0]!
  if (mode === 'grid' || ids.length > 2) return { direction: 'vertical', first: { direction: 'horizontal', first: ids[0]!, second: ids[1]! }, second: { direction: 'horizontal', first: ids[2] ?? 0, second: ids[3] ?? 0 } }
  return { direction: mode === 'vertical' ? 'vertical' : 'horizontal', first: ids[0]!, second: ids[1]! }
}
export function deskLayoutMode(tab: DeskTab): DeskLayoutMode {
  return tab.panes.length === 1 ? 'single' : tab.panes.length > 2 ? 'grid' : typeof tab.layout !== 'number' && tab.layout.direction === 'vertical' ? 'vertical' : 'horizontal'
}
function pruneLayout(raw: any, remaining: Set<number>, seen = new Set<number>(), depth = 0): DeskLayout | undefined {
  if (typeof raw === 'number') { if (!remaining.has(raw) || seen.has(raw)) return; seen.add(raw); return raw }
  if (!raw || depth > 8 || !['horizontal', 'vertical'].includes(raw.direction)) return
  const first = pruneLayout(raw.first, remaining, seen, depth + 1), second = pruneLayout(raw.second, remaining, seen, depth + 1)
  return first === undefined ? second : second === undefined ? first : { direction: raw.direction, first, second }
}
export class TerminalDeskState {
  tabs: DeskTab[] = []
  activeId = 0
  private changing = new Set<number>()
  private serial = 0
  private revision = 0
  private listeners = new Set<() => void>()
  private readonly key: string
  constructor(readonly scope: string) {
    this.key = 'dsh-ssh:terminal-desk:v2:' + scope
    const saved = readTerminalStorage(this.key), legacy = readTerminalStorage('dsh-ssh:terminal-desk:v1:' + scope)
    let rows: any[] = [], active = saved?.activeId
    if (Array.isArray(saved?.tabs)) rows = saved.tabs
    else {
      let previous: any[] = []
      if (Array.isArray(legacy?.tabs)) { previous = legacy.tabs; active = legacy.view?.focused }
      else for (const host of readWorkbenchState(scope).hosts) {
        const old = readTerminalStorage('dsh-ssh:terminals:v1:' + JSON.stringify([scope, host]))
        if (Array.isArray(old?.tabs)) previous.push(...old.tabs.map((tab: any) => ({ ...tab, id: ++this.serial, profileId: host })))
      }
      // Each old tab stays independent, including tabs previously displayed side by side.
      rows = previous.map(tab => ({ ...tab, panes: [tab], layout: tab.id, focused: tab.id, filesOnly: false }))
    }
    const tabIds = new Set<number>(), paneIds = new Set<number>()
    for (const row of rows.slice(0, 32)) {
      if (!Number.isSafeInteger(row?.id) || row.id < 1 || tabIds.has(row.id) || typeof row.profileId !== 'string' || typeof row.path !== 'string' || !Array.isArray(row.panes)) continue
      const panes: DeskPane[] = []
      for (const pane of row.panes.slice(0, 4)) {
        if (!Number.isSafeInteger(pane?.id) || pane.id < 1 || paneIds.has(pane.id) || typeof pane.path !== 'string') continue
        paneIds.add(pane.id)
        panes.push({ id: pane.id, profileId: row.profileId, path: pane.path, label: typeof pane.label === 'string' ? pane.label : undefined, directory: typeof pane.directory === 'string' ? pane.directory : undefined, handle: new BrowserTerminalHandle(typeof pane.terminalId === 'string' ? pane.terminalId : undefined, this.save), autoConnect: false, phase: 'idle' })
      }
      if (!panes.length) continue
      tabIds.add(row.id)
      const seen = new Set<number>()
      let layout = pruneLayout(row.layout, new Set(panes.map(pane => pane.id)), seen)
      for (const pane of panes) if (!seen.has(pane.id)) layout = layout === undefined ? pane.id : { direction: 'horizontal', first: layout, second: pane.id }
      this.tabs.push({ id: row.id, profileId: row.profileId, path: row.path, label: typeof row.label === 'string' ? row.label : undefined, panes, layout: layout!, focused: panes.some(pane => pane.id === row.focused) ? row.focused : panes[0]!.id, filesOnly: row.filesOnly === true })
    }
    for (const tab of this.tabs) {
      const order = deskPaneRects(tab.layout).sort((a, b) => a.top - b.top || a.left - b.left).map(rect => rect.id)
      tab.panes.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
      tab.layout = fixedLayout(tab.panes.map(pane => pane.id), deskLayoutMode(tab))
    }
    this.serial = Math.max(0, ...tabIds, ...paneIds)
    this.activeId = tabIds.has(active) ? active : this.tabs[0]?.id ?? 0
    this.save()
  }
  get activeTab(): DeskTab | undefined { return this.tabs.find(tab => tab.id === this.activeId) }
  get currentPane(): DeskPane | undefined { const tab = this.activeTab; return tab?.panes.find(pane => pane.id === tab.focused) }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  snapshot = (): number => this.revision
  save = (): void => {
    writeTerminalStorage(this.key, { tabs: this.tabs.map(tab => ({ ...tab, panes: tab.panes.map(({ handle, phase, autoConnect, ...pane }) => ({ ...pane, terminalId: handle.id })) })), activeId: this.activeId })
    this.revision++; for (const listener of this.listeners) listener()
  }
  private makePane(target: DeskTarget, connect: boolean): DeskPane { return { ...target, id: ++this.serial, handle: new BrowserTerminalHandle(undefined, this.save), autoConnect: connect, phase: 'idle' } }
  open(target: DeskTarget, fresh = false, connect = true): DeskTab {
    let tab = !fresh ? [...this.tabs].reverse().find(tab => tab.profileId === target.profileId && tab.path === target.path) : undefined
    if (!tab) {
      if (this.tabs.length >= 32) throw new Error('最多保留 32 个终端标签，请先关闭不再使用的标签。')
      const pane = this.makePane(target, connect)
      tab = { ...target, id: pane.id, panes: [pane], layout: pane.id, focused: pane.id, filesOnly: !connect }
      this.tabs.push(tab)
    }
    this.activeId = tab.id; this.save(); return tab
  }
  focus(id: number): void { if (!this.tabs.some(tab => tab.id === id)) return; this.activeId = id; this.save() }
  focusPane(tabId: number, paneId: number): void {
    const tab = this.tabs.find(tab => tab.id === tabId)
    if (!tab?.panes.some(pane => pane.id === paneId) || (this.activeId === tabId && tab.focused === paneId)) return
    this.activeId = tabId; tab.focused = paneId; this.save()
  }
  setFilesOnly(value: boolean): void { if (this.activeTab) { this.activeTab.filesOnly = value; this.save() } }
  /** Reductions require an explicit keep list and the pane snapshot shown in the confirmation dialog. */
  async applyLayout(tabId: number, mode: DeskLayoutMode, remove: (id: string) => Promise<void>, keepIds?: number[], expectedIds?: number[]): Promise<unknown[]> {
    const tab = this.tabs.find(tab => tab.id === tabId)
    if (!tab || !['single', 'horizontal', 'vertical', 'grid'].includes(mode)) throw new Error('Terminal layout is unavailable')
    if (this.changing.has(tabId)) throw new Error('Terminal layout is changing')
    const count = deskLayoutSize(mode), ids = tab.panes.map(pane => pane.id)
    if (count < ids.length && (!expectedIds || expectedIds.length !== ids.length || expectedIds.some((id, index) => id !== ids[index]) || !keepIds || keepIds.length !== count || new Set(keepIds).size !== count || keepIds.some(id => !ids.includes(id)))) throw new Error('Terminal selection changed; select the panes to keep again')
    this.changing.add(tabId)
    try {
      if (count < ids.length) {
        const errors = await this.removePanes(ids.filter(id => !keepIds!.includes(id)), remove)
        if (errors.length) return errors
      }
      const source = tab.panes.find(pane => pane.id === tab.focused) ?? tab.panes[0]!
      while (tab.panes.length < count) tab.panes.push(this.makePane({ profileId: source.profileId, path: source.directory ?? source.path, label: source.label }, true))
      tab.layout = fixedLayout(tab.panes.map(pane => pane.id), mode)
      tab.filesOnly = false
      this.save()
      return []
    } finally { this.changing.delete(tabId) }
  }
  setPhase(id: number, phase: DeskPane['phase']): void { const pane = this.tabs.flatMap(tab => tab.panes).find(pane => pane.id === id); if (pane && pane.phase !== phase) { pane.phase = phase; this.save() } }
  setDirectory(id: number, directory: string | undefined): void { const pane = this.tabs.flatMap(tab => tab.panes).find(pane => pane.id === id); if (pane && pane.directory !== directory) { pane.directory = directory; this.save() } }
  private async removePanes(ids: number[], remove: (id: string) => Promise<void>): Promise<unknown[]> {
    const panes = this.tabs.flatMap(tab => tab.panes).filter(pane => ids.includes(pane.id))
    const results = await Promise.allSettled(panes.map(async pane => { await pane.handle.close(remove); return pane.id }))
    const closed = new Set(results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []))
    for (const tab of this.tabs) {
      const mode = deskLayoutMode(tab)
      tab.panes = tab.panes.filter(pane => !closed.has(pane.id))
      if (!tab.panes.length) continue
      tab.layout = fixedLayout(tab.panes.map(pane => pane.id), tab.panes.length > 2 ? 'grid' : mode === 'vertical' ? 'vertical' : 'horizontal')
      if (!tab.panes.some(pane => pane.id === tab.focused)) tab.focused = tab.panes[0]!.id
    }
    const index = this.tabs.findIndex(tab => tab.id === this.activeId)
    this.tabs = this.tabs.filter(tab => tab.panes.length)
    if (!this.activeTab) this.activeId = this.tabs[Math.min(Math.max(index, 0), this.tabs.length - 1)]?.id ?? 0
    this.save()
    return results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
  }
  async close(ids: number[], remove: (id: string) => Promise<void>): Promise<unknown[]> {
    if (ids.some(id => this.changing.has(id))) return [new Error('Terminal layout is changing')]
    return this.removePanes(this.tabs.filter(tab => ids.includes(tab.id)).flatMap(tab => tab.panes.map(pane => pane.id)), remove)
  }
}
const desks = new Map<string, TerminalDeskState>()
export function terminalDesk(scope: string): TerminalDeskState {
  let state = desks.get(scope)
  if (!state) { state = new TerminalDeskState(scope); desks.set(scope, state) }
  return state
}
