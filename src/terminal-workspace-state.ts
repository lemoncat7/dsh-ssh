import type { TerminalLayout } from './terminal-layout.js'

/** Owns the remote channel independently of React's mount/unmount lifecycle. */
export class BrowserTerminalHandle {
  id: string | undefined
  private pending: Promise<string> | undefined
  private closing = false
  private attachment: Promise<unknown> = Promise.resolve()
  constructor(id: string | undefined, private readonly changed: () => void) { this.id = id }
  async open(create: () => Promise<string>, remove: (id: string) => Promise<void>): Promise<string> {
    if (this.closing) throw new Error('Terminal is closing')
    if (this.id) return this.id
    if (this.pending) return this.pending
    this.pending = create().then(async id => {
      this.id = id; this.changed()
      if (this.closing) { await remove(id); this.clear(id); throw new Error('Terminal was closed while connecting') }
      return id
    }).finally(() => { this.pending = undefined })
    return this.pending
  }
  attach<T>(run: () => Promise<T>): Promise<T> {
    const next = this.attachment.catch(() => {}).then(run)
    this.attachment = next
    return next
  }
  get connecting(): boolean { return this.pending !== undefined }
  clear(id: string): void { if (this.id === id) { this.id = undefined; this.changed() } }
  async close(remove: (id: string) => Promise<void>): Promise<void> {
    this.closing = true
    try {
      await this.pending?.catch(() => {})
      if (this.id) { const id = this.id; await remove(id); this.clear(id) }
    } finally { this.closing = false }
  }
}
export interface PersistentTerminalTab { id: number; number: number; path: string; directory?: string | undefined; handle: BrowserTerminalHandle }
export interface TerminalWorkspaceState {
  tabs: PersistentTerminalTab[]; serial: number; view: TerminalLayout; direction: 'horizontal' | 'vertical'; save(): void
}
const cache = new Map<string, TerminalWorkspaceState>()
const memory = new Map<string, string>()
const key = (scope: string, profile: string): string => 'dsh-ssh:terminals:v1:' + JSON.stringify([scope, profile])
export function readWorkbenchState(scope: string): { hosts: string[]; target: { profileId: string; path: string } | null } {
  const value = read('dsh-ssh:workbench:v1:' + scope)
  return { hosts: Array.isArray(value?.hosts) ? value.hosts.filter((id: unknown) => typeof id === 'string').slice(0, 100) : [], target: typeof value?.target?.profileId === 'string' && typeof value?.target?.path === 'string' ? value.target : null }
}
export function writeWorkbenchState(scope: string, hosts: string[], target: { profileId: string; path: string } | null): void {
  write('dsh-ssh:workbench:v1:' + scope, { hosts, target })
}
function read(key: string): any {
  try { return JSON.parse(globalThis.sessionStorage?.getItem(key) ?? memory.get(key) ?? 'null') } catch { return null }
}
function write(key: string, value: unknown): void {
  const text = JSON.stringify(value); memory.set(key, text)
  try { globalThis.sessionStorage?.setItem(key, text) } catch { /* In-memory navigation still works if browser storage is unavailable. */ }
}
export function terminalWorkspaceState(scope: string, profile: string, path: string): TerminalWorkspaceState {
  const storageKey = key(scope, profile), existing = cache.get(storageKey)
  if (existing) return existing
  const raw = read(storageKey)
  const state: TerminalWorkspaceState = {
    tabs: [], serial: 1, view: { panes: [1], focused: 1 }, direction: 'horizontal',
    save() { write(storageKey, { tabs: state.tabs.map(({ handle, ...tab }) => ({ ...tab, terminalId: handle.id })), serial: state.serial, view: state.view, direction: state.direction }) },
  }
  const ids = new Set<number>()
  if (Array.isArray(raw?.tabs)) for (const tab of raw.tabs.slice(0, 8)) {
    if (!Number.isSafeInteger(tab?.id) || tab.id < 1 || ids.has(tab.id) || !Number.isSafeInteger(tab.number) || tab.number < 1 || typeof tab.path !== 'string') continue
    ids.add(tab.id)
    state.tabs.push({ id: tab.id, number: tab.number, path: tab.path, ...(typeof tab.directory === 'string' ? { directory: tab.directory } : {}), handle: new BrowserTerminalHandle(typeof tab.terminalId === 'string' ? tab.terminalId : undefined, state.save) })
  }
  if (!Array.isArray(raw?.tabs) || (raw.tabs.length && !state.tabs.length)) state.tabs = [{ id: 1, number: 1, path, handle: new BrowserTerminalHandle(undefined, state.save) }]
  state.serial = Math.max(1, ...state.tabs.map(tab => tab.id))
  const panes: number[] = Array.isArray(raw?.view?.panes) ? [...new Set<number>(raw.view.panes.filter((id: number) => state.tabs.some(tab => tab.id === id)))].slice(0, 4) : []
  state.view = { panes: panes.length ? panes : state.tabs.slice(0, 1).map(tab => tab.id), focused: 0 }
  state.view.focused = state.view.panes.includes(raw?.view?.focused) ? raw.view.focused : state.view.panes[0] ?? 0
  state.direction = raw?.direction === 'vertical' ? 'vertical' : 'horizontal'
  cache.set(storageKey, state)
  return state
}
