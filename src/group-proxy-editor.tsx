import { useId, useState, type FormEvent } from 'react'
import type { GroupProxy } from './domain.js'
import { api, type ProxyEntryView } from './client-api.js'
import { Dialog, Field, errorMessage } from './ui-components.js'
import { useSshLocale } from './use-ssh-locale.js'
import { t } from './i18n.js'

export function GroupProxyEditor({ name, value, proxies, onClose, onSaved }: { name: string; value?: GroupProxy | undefined; proxies: ProxyEntryView[]; onClose(): void; onSaved(): void }): JSX.Element {
  useSshLocale()
  const [proxyId, setProxyId] = useState(value?.proxyId ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const errorId = useId()
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); if (saving) return
    setSaving(true); setError(undefined)
    try { await api('/group-proxies', { method: 'PUT', body: JSON.stringify({ name, proxyId }) }); onSaved() }
    catch (reason) { setError(errorMessage(reason)) }
    finally { setSaving(false) }
  }
  return <Dialog title={t('group-proxy.title', [name])} subtitle={t('group-proxy.hint')} onClose={() => { if (!saving) onClose() }}>
    <form className="dsh-ssh-form" onSubmit={event => { void submit(event) }}>
      <Field label={t('group-proxy.selection')} hint={t('group-proxy.reconnect')}>
        <select value={proxyId} disabled={saving} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} onChange={event => setProxyId(event.target.value)}>
          <option value="">{t('group-proxy.none')}</option>
          {proxies.map(proxy => <option key={proxy.id} value={proxy.id}>{proxy.name} · {proxy.proxyType === 'http' ? 'HTTP' : 'SOCKS5'}</option>)}
        </select>
      </Field>
      {error && <p id={errorId} className="dsh-ssh-inline-error" role="alert">{error}</p>}
      <div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" disabled={saving} onClick={onClose}>{t('client.cancel')}</button><button className="dsh-ssh-primary-button" disabled={saving}>{saving ? t('client.saving') : t('client.saveProxy')}</button></div>
    </form>
  </Dialog>
}
