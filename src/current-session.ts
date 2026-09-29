/** The host main-view retention replaces SessionListState.current in 0.1.7. */
export function currentSession<K extends string>(state: {
  readonly current?: K
  readonly byId: Readonly<Partial<Record<K, { readonly retainedBy?: { readonly mainView?: number } }>>>
}): K | undefined {
  return (Object.entries(state.byId ?? {}).find(([, row]) => ((row as { retainedBy?: { mainView?: number } } | undefined)?.retainedBy?.mainView ?? 0) > 0)?.[0] as K | undefined) ?? state.current
}

/** Async access reads belong to one session; never reuse them after navigation. */
export function canSubscribeActivity(sessionId: string | undefined, injection: { sessionId: string; permission: string } | null): boolean {
  return sessionId !== undefined && injection?.sessionId === sessionId && injection.permission === 'terminal'
}
