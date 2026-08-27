import type { InjectionView } from './client-api.js'

type SessionAccessListener = (value: InjectionView) => void

const listeners = new Set<SessionAccessListener>()

export function publishSessionAccess(value: InjectionView): void {
  for (const listener of listeners) listener(value)
}

export function subscribeSessionAccess(listener: SessionAccessListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
