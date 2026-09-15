import { sshLocale } from './i18n.js'

export interface HostLocale {
  getSnapshot(): { active?: unknown }
  subscribe(listener: () => void): () => void
}

let owner: symbol | undefined

/** Optional host service: no new hard dependency for older DSH installations. */
export function bindHostLocale(host: HostLocale): () => void {
  const token = Symbol('ssh locale binding')
  owner = token
  const sync = (): void => {
    if (owner === token) sshLocale.setLocale(host.getSnapshot().active)
  }
  const unsubscribe = host.subscribe(sync)
  try { sync() } catch (error) { unsubscribe(); if (owner === token) owner = undefined; throw error }
  return () => {
    unsubscribe()
    if (owner !== token) return
    owner = undefined
    sshLocale.setLocale('zh')
  }
}
