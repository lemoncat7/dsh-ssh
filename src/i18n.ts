import { messages, type MessageKey } from './locales/messages.js'

export type SshLocale = 'zh' | 'en'
export type MessageValues = readonly unknown[]

/** Only UI display copy belongs here. Never pass paths, identifiers or user content as keys. */
export function formatMessage(key: MessageKey, locale: SshLocale, values: MessageValues = []): string {
  const entry = messages[key]
  if (entry === undefined) return key
  return entry[locale].replace(/\{(\d+)\}/g, (placeholder, index: string) => {
    const position = Number(index)
    return position < values.length ? String(values[position]) : placeholder
  })
}

export function createLocaleStore() {
  let active: SshLocale = 'zh'
  const listeners = new Set<() => void>()
  return {
    getSnapshot: (): SshLocale => active,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    setLocale(value: unknown): void {
      const next = typeof value === 'string' && /^en(?:-|_|$)/i.test(value) ? 'en' : 'zh'
      if (next === active) return
      active = next
      for (const listener of [...listeners]) listener()
    },
  }
}

// One instance per loaded browser plugin module; never imported by the server.
export const sshLocale = createLocaleStore()
export function t(key: MessageKey, values?: MessageValues): string {
  return formatMessage(key, sshLocale.getSnapshot(), values)
}
