import { BrowserTerminalHandle, readTerminalStorage, writeTerminalStorage, readWorkbenchState } from './terminal-workspace-state.js'
import { closeTerminal, selectTerminal, splitTerminal, type TerminalLayout } from './terminal-layout.js'

export interface DeskTarget { profileId: string; path: string; label?: string | undefined }
export interface DeskTab extends DeskTarget {
  id: number; directory?: string | undefined; handle: BrowserTerminalHandle
  autoConnect: boolean; phase: 'idle' | 'connecting' | 'connected' | 'error'
}
export class TerminalDeskState {
  tabs: DeskTab[] = []
  view: TerminalLayout = { panes: [], focused: 0 }
  direction: 'horizontal' | 'vertical' = 'horizontal'
  private serial = 0
  private revision = 0
  private listeners = new Set<() => void>()
  private readonly key: string
  constructor(readonly scope: string) {
    this.key = 'dsh-ssh:terminal-desk:v1:' + scope
    const raw = readTerminalStorage(this.key)
    let rows: any[] = []
    if (Array.isArray(raw?.tabs)) rows = raw.tabs
    else for (const host of readWorkbenchState(scope).hosts) {
      const previous = readTerminalStorage('dsh-ssh:terminals:v1:' + JSON.stringify([scope, host]))
      if (Array.isArray(previous?.tabs)) rows.push(...previous.tabs.map((tab: any) => ({ ...tab, id: ++this.serial, profileId: host })))
    }
    const ids = new Set<number>()
    for (const row of rows) {
      if (!Number.isSafeInteger(row?.id) || row.id < 1 || ids.has(row.id) || typeof row.profileId !== 'string' || typeof row.path !== 'string') continue
      ids.add(row.id)
      this.tabs.push({ id: row.id, profileId: row.profileId, path: row.path, label: typeof row.label === 'string' ? row.label : undefined, directory: typeof row.directory === 'string' ? row.directory : undefined, handle: new BrowserTerminalHandle(typeof row.terminalId === 'string' ? row.terminalId : undefined, () => this.save()), autoConnect: false, phase: 'idle' })
    }
    this.serial = Math.max(0, ...this.tabs.map(tab => tab.id))
    const panes = Array.isArray(raw?.view?.panes) ? [...new Set<number>(raw.view.panes.filter((id: number) => ids.has(id)))].slice(0, 4) : []
    this.view.panes = panes.length ? panes : this.tabs.slice(0, 1).map(tab => tab.id)
    this.view.focused = this.view.panes.includes(raw?.view?.focused) ? raw.view.focused : this.view.panes[0] ?? 0
    this.direction = raw?.direction === 'vertical' ? 'vertical' : 'horizontal'
    this.save()
  }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  snapshot = (): number => this.revision
  save = (): void => {
    writeTerminalStorage(this.key, { tabs: this.tabs.map(({ handle, phase, autoConnect, ...tab }) => ({ ...tab, terminalId: handle.id })), view: this.view, direction: this.direction })
    this.revision++; for (const listener of this.listeners) listener()
  }
  open(target: DeskTarget, fresh = false, connect = true): DeskTab {
    let tab = !fresh ? [...this.tabs].reverse().find(tab => tab.profileId === target.profileId && tab.path === target.path) : undefined
    if (!tab) {
      if (this.tabs.length >= 32) throw new Error('最多保留 32 个终端标签，请先关闭不再使用的标签。')
      tab = { ...target, id: ++this.serial, handle: new BrowserTerminalHandle(undefined, this.save), autoConnect: connect, phase: 'idle' }
      this.tabs.push(tab)
    }
    this.view = selectTerminal(this.view, tab.id); this.save(); return tab
  }
  focus(id: number): void { if (!this.tabs.some(tab => tab.id === id)) return; this.view = selectTerminal(this.view, id); this.save() }
  split(id: number): void { this.view = splitTerminal(this.view, id); this.save() }
  setPhase(id: number, phase: DeskTab['phase']): void { const tab = this.tabs.find(tab => tab.id === id); if (tab && tab.phase !== phase) { tab.phase = phase; this.save() } }
  setDirectory(id: number, directory: string | undefined): void { const tab = this.tabs.find(tab => tab.id === id); if (tab && tab.directory !== directory) { tab.directory = directory; this.save() } }
  async close(ids: number[], remove: (id: string) => Promise<void>): Promise<unknown[]> {
    const results = await Promise.allSettled(this.tabs.filter(tab => ids.includes(tab.id)).map(async tab => { await tab.handle.close(remove); return tab.id }))
    const closed = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
    this.tabs = this.tabs.filter(tab => !closed.includes(tab.id))
    this.view = closed.reduce((view, id) => closeTerminal(view, id, this.tabs.map(tab => tab.id)), this.view)
    this.save()
    return results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
  }
}
const desks = new Map<string, TerminalDeskState>()
export function terminalDesk(scope: string): TerminalDeskState {
  let state = desks.get(scope)
  if (!state) { state = new TerminalDeskState(scope); desks.set(scope, state) }
  return state
}
