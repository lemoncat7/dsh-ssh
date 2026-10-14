import type { SftpEntryView } from './client-api.js'

/** Navigation metadata only, scoped by session/host. Never retain file bodies. */
export interface ExplorerState { directory: string; openedFile?: SftpEntryView; scrollTop: number }
const states = new Map<string, ExplorerState>()
const limit = 128
export function explorerStateKey(sessionId: string, profileId?: string): string {
  return JSON.stringify([sessionId, profileId ?? null])
}
export function readExplorerState(key: string | undefined): ExplorerState | undefined {
  return key === undefined ? undefined : states.get(key)
}
export function saveExplorerState(key: string | undefined, state: ExplorerState): void {
  if (key === undefined) return
  states.delete(key); states.set(key, { ...state, ...(state.openedFile ? { openedFile: { ...state.openedFile } } : {}) })
  while (states.size > limit) states.delete(states.keys().next().value!)
}
