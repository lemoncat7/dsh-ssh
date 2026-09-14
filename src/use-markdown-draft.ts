import { useCallback, useEffect, useRef, useState } from 'react'
import type { SftpFilePreviewView } from './client-api.js'

export interface MarkdownDraft { text: string; baseText: string; expectedHash: string }
export type SaveMarkdown = (input: { path: string; text: string; expectedHash: string }) => Promise<{ contentHash: string }>
const drafts = new Map<string, MarkdownDraft>()
export function useMarkdownDraft(key: string, path: string, preview: SftpFilePreviewView | undefined, saveFile: SaveMarkdown | undefined, refresh: () => Promise<void>) {
  const [draft, setDraft] = useState<MarkdownDraft>()
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const current = useRef(draft); current.current = draft
  const busy = useRef(false)
  const alive = useRef(true)
  const dirty = Boolean(draft && draft.text !== draft.baseText)
  const storageKey = `dsh-ssh:markdown-draft:${key}`
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    if (!preview?.contentHash || preview.text === undefined) return
    let cached = drafts.get(key)
    if (!cached) {
      try {
        const value = JSON.parse(sessionStorage.getItem(storageKey) || 'null')
        if (value && typeof value.text === 'string' && typeof value.baseText === 'string' && /^[a-f0-9]{64}$/.test(value.expectedHash)) cached = value
      } catch { /* Storage can be disabled; keep in-memory drafts. */ }
    }
    if (cached) { setDraft(cached); setMessage(cached.expectedHash === preview.contentHash ? '已恢复未保存草稿' : '文件版本已变化，草稿已保留；保存时会检查冲突') }
    else setDraft({ text: preview.text, baseText: preview.text, expectedHash: preview.contentHash })
  }, [key, storageKey, preview])
  const persist = useCallback((value: MarkdownDraft | undefined) => {
    if (value && value.text !== value.baseText) drafts.set(key, value)
    else drafts.delete(key)
    try {
      if (value && value.text !== value.baseText) sessionStorage.setItem(storageKey, JSON.stringify(value))
      else sessionStorage.removeItem(storageKey)
    } catch { setMessage('浏览器无法持久保存草稿，请保持此页面打开并及时保存') }
  }, [key, storageKey])
  const change = useCallback((text: string) => {
    if (busy.current || !current.current) return
    const original = current.current.baseText
    if (original.includes('\r\n')) text = text.replace(/\r?\n/g, '\r\n')
    if (original.startsWith('\uFEFF') && !text.startsWith('\uFEFF')) text = '\uFEFF' + text
    if (original.endsWith('\n') && !text.endsWith('\n')) text += original.endsWith('\r\n') ? '\r\n' : '\n'
    const value = { ...current.current, text }
    current.current = value; setDraft(value); setMessage(''); persist(value)
  }, [persist])
  const save = useCallback(async () => {
    const value = current.current
    if (!value || !saveFile || busy.current || value.text === value.baseText) return
    busy.current = true; setSaving(true); setMessage('正在保存…')
    try {
      const result = await saveFile({ path, text: value.text, expectedHash: value.expectedHash })
      if (drafts.get(key)?.text === value.text) persist(undefined)
      if (alive.current) {
        const next = { text: value.text, baseText: value.text, expectedHash: result.contentHash }
        current.current = next; setDraft(next); setMessage('已保存'); await refresh()
      }
    } catch (error) { if (alive.current) setMessage(`保存失败，草稿仍保留：${error instanceof Error ? error.message : String(error)}`) }
    finally { busy.current = false; if (alive.current) setSaving(false) }
  }, [key, path, saveFile, persist, refresh])
  const discard = useCallback(async () => {
    if (busy.current) return
    persist(undefined); setMessage('')
    if (preview?.contentHash && preview.text !== undefined) {
      const value = { text: preview.text, baseText: preview.text, expectedHash: preview.contentHash }
      current.current = value; setDraft(value)
    }
    await refresh()
  }, [persist, preview, refresh])
  useEffect(() => {
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])
  return { text: draft?.text ?? preview?.text ?? '', dirty, saving, message, change, save, discard }
}
