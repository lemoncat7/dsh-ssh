import { useSyncExternalStore } from 'react'
import { sshLocale, type SshLocale } from './i18n.js'

/** Subscribe without changing component keys: terminal connections and drafts stay mounted. */
export function useSshLocale(): SshLocale {
  return useSyncExternalStore(sshLocale.subscribe, sshLocale.getSnapshot, sshLocale.getSnapshot)
}
