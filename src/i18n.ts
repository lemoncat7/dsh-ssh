/**
 * Minimal i18n seam shared by the host and client halves.
 *
 * English is the source language: every call site reads `t("English copy")` and
 * `tx\`N ${dynamic} segments\``. The Chinese dictionary is keyed by that same
 * English text (template static segments joined at \u0000), so a missing key
 * falls back to the English literal — the failure mode is an untranslated
 * string, never a blank or a crash.
 */

/** Separator joining the static segments of a template literal into one key. */
export const SEG = '\u0000'

export type Translator = (key: string) => string

let translate: Translator = (key) => key

/** Replace the active translator (host bootstrap / client `locale.bind`). */
export function setTranslator(fn: Translator): void {
  translate = fn
}

/** Translate a literal English source string. */
export function t(key: string): string {
  return translate(key)
}

/** Translate a template literal; the dictionary carries segments joined by SEG. */
export function tx(parts: TemplateStringsArray, ...exprs: unknown[]): string {
  const template = translate(Array.prototype.join.call(parts, SEG))
  const segments = template.split(SEG)
  let out = ''
  for (let index = 0; index < segments.length; index++) {
    out += segments[index]
    if (index < exprs.length) out += String(exprs[index])
  }
  return out
}

/** Locale-change store (client: the DSH locale service; host: never used). */
export interface LocaleStore {
  subscribe(fn: () => void): () => void
  getSnapshot(): unknown
}

let localeStore: LocaleStore | undefined

export function setLocaleStore(store: LocaleStore): void {
  localeStore = store
}

export function getLocaleStore(): LocaleStore | undefined {
  return localeStore
}
