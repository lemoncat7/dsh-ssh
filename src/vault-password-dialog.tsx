import { useEffect, useRef, useState } from 'react'
import { api, type VaultEntryView } from './client-api.js'
import { Dialog, errorMessage } from './ui-components.js'
import { t } from './i18n.js'
import { useSshLocale } from './use-ssh-locale.js'

/** Called only from an explicit reveal/copy action, never from list rendering. */
export function VaultPasswordDialog({ entry, onClose }: { entry: VaultEntryView; onClose(): void }): JSX.Element {
  useSshLocale()
  const [password, setPassword] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string>()
  const request = useRef<AbortController>()
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => () => { request.current?.abort() }, [])
  const read = async (): Promise<string> => {
    const controller = new AbortController(); request.current = controller
    const result = await api<{ password: string }>(`/vault/${encodeURIComponent(entry.id)}/password`, { method: 'POST', body: '{}', signal: controller.signal })
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    return result.password
  }
  const act = async (copy: boolean): Promise<void> => {
    setBusy(true); setError(undefined); setCopied(false)
    try {
      const value = password ?? await read()
      if (copy) {
        let success = false
        try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); success = true } } catch { /* HTTP and clipboard policies may require the selection fallback. */ }
        if (request.current?.signal.aborted) return
        if (!success) {
          const node = document.createElement('textarea'); node.value = value; node.readOnly = true
          node.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
          const focused = document.activeElement
          try { field.current?.parentElement?.append(node); node.select(); success = document.execCommand('copy') }
          finally { node.remove(); if (focused instanceof HTMLElement) focused.focus() }
        }
        if (!success) throw Error(t('vault-password.copyFailed'))
        setCopied(true)
      } else setPassword(value)
    } catch (reason) { if (!request.current?.signal.aborted) setError(errorMessage(reason)) }
    finally { if (!request.current?.signal.aborted) setBusy(false) }
  }
  return <Dialog title={t('vault-password.title')} subtitle={`${entry.name} · ${entry.username}`} onClose={onClose}>
    <div className="dsh-ssh-vault-password">
      <label className="dsh-ssh-field"><span>{t('client.password')}</span><input ref={field} readOnly type={password === undefined ? 'password' : 'text'} autoComplete="off" spellCheck={false} aria-label={t('vault-password.savedPassword')} value={password ?? ''} placeholder="••••••••" onFocus={event => event.currentTarget.select()} /></label>
      <div className="dsh-ssh-vault-password-actions"><button type="button" className="dsh-ssh-secondary-button" disabled={busy} onClick={() => { if (password !== undefined) setPassword(undefined); else void act(false) }}>{password === undefined ? t('vault-password.show') : t('vault-password.hide')}</button><button type="button" className="dsh-ssh-secondary-button" disabled={busy} onClick={() => { void act(true) }}>{copied ? t('client.copied') : t('vault-password.copy')}</button></div>
      {busy && <p role="status" className="dsh-ssh-form-hint">{t('vault-password.loading')}</p>}
      {error && <p role="alert" className="dsh-ssh-inline-error">{error}</p>}
    </div>
  </Dialog>
}
