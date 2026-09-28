/** The host main-view retention replaces SessionListState.current in 0.1.7. */
export function currentSession<K extends string>(state: {
  readonly current?: K
  readonly byId: Readonly<Partial<Record<K, { readonly retainedBy?: { readonly mainView?: number } }>>>
}): K | undefined {
  return (Object.entries(state.byId ?? {}).find(([, row]) => ((row as { retainedBy?: { mainView?: number } } | undefined)?.retainedBy?.mainView ?? 0) > 0)?.[0] as K | undefined) ?? state.current
}
