import { useId, useState, type FormEvent } from 'react'
import type { GroupProxy } from './domain.js'
import { api, type ProxyEntryView } from './client-api.js'
import { Dialog, Field, errorMessage } from './ui-components.js'
import { useSshLocale } from './use-ssh-locale.js'
import { t } from './i18n.js'

export function GroupProxyEditor({ name: originalName, value, proxies, onClose, onSaved }: { name?: string | undefined; value?: GroupProxy | undefined; proxies: ProxyEntryView[]; onClose(): void; onSaved(): void }): JSX.Element {
  useSshLocale()
  const [name, setName] = useState(originalName ?? '')
  const [proxyId, setProxyId] = useState(value?.proxyId ?? '')
  const [saving, setSaving] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string>()
  const errorId = useId()
  const remove = async (): Promise<void> => {
    if (saving || originalName === undefined) return
    setSaving(true); setError(undefined)
    try { await api('/group-proxies', { method: 'DELETE', body: JSON.stringify({ name: originalName }) }); onSaved() }
    catch (reason) { setError(errorMessage(reason)) }
    finally { setSaving(false) }
  }
  if (confirmDelete) return <Dialog variant="confirmation" dismissible={!saving} title={t('group-proxy.delete')} subtitle={t('group-proxy.deleteConfirm', [originalName ?? ''])} onClose={() => { if (!saving) setConfirmDelete(false) }}>
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    <div className="dsh-ssh-dialog-actions">
      <button type="button" className="dsh-ssh-secondary-button" disabled={saving} onClick={() => setConfirmDelete(false)}>{t('client.cancel')}</button>
      <button type="button" className="dsh-ssh-danger-button" disabled={saving} onClick={() => { void remove() }}>{saving ? t('file-entry-delete-dialog.deleting') : t('group-proxy.delete')}</button>
    </div>
  </Dialog>
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); if (saving) return
    await save(false)
  }
  const save = async (resetHostProxies: boolean): Promise<void> => {
    if (saving) return
    setSaving(true); setError(undefined)
    try { await api('/group-proxies', { method: 'PUT', body: JSON.stringify({ name: name.trim(), proxyId, resetHostProxies, ...(originalName === undefined ? {} : { previousName: originalName }) }) }); onSaved() }
    catch (reason) { setError(errorMessage(reason)) }
    finally { setSaving(false) }
  }
  if (confirmReset) return <Dialog variant="confirmation" dismissible={!saving} title={t('group-proxy.resetHosts')} subtitle={t('group-proxy.resetConfirm', [originalName ?? ''])} onClose={() => { if (!saving) setConfirmReset(false) }}>
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    <div className="dsh-ssh-dialog-actions">
      <button type="button" className="dsh-ssh-secondary-button" disabled={saving} onClick={() => setConfirmReset(false)}>{t('client.cancel')}</button>
      <button type="button" className="dsh-ssh-primary-button" disabled={saving} onClick={() => { void save(true) }}>{saving ? t('client.saving') : t('group-proxy.confirmReset')}</button>
    </div>
  </Dialog>
  return <Dialog title={originalName === undefined ? t('group-proxy.newTitle') : t('group-proxy.editTitle', [originalName])} subtitle={t('group-proxy.hint')} onClose={() => { if (!saving) onClose() }}>
    <form className="dsh-ssh-form" onSubmit={event => { void submit(event) }}>
      <Field label={t('group-proxy.name')}>
        <input required autoFocus maxLength={64} value={name} disabled={saving} onChange={event => setName(event.target.value)} />
      </Field>
      <Field label={t('group-proxy.selection')} hint={t('group-proxy.reconnect')}>
        <select value={proxyId} disabled={saving} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} onChange={event => setProxyId(event.target.value)}>
          <option value="">{t('group-proxy.none')}</option>
          {proxies.map(proxy => <option key={proxy.id} value={proxy.id}>{proxy.name} · {proxy.proxyType === 'http' ? 'HTTP' : 'SOCKS5'}</option>)}
        </select>
      </Field>
      {error && <p id={errorId} className="dsh-ssh-inline-error" role="alert">{error}</p>}
      <div className="dsh-ssh-dialog-actions">
        {originalName !== undefined && <button type="button" className="dsh-ssh-group-delete-link" disabled={saving} onClick={() => { setError(undefined); setConfirmDelete(true) }}>{t('group-proxy.delete')}</button>}
        {originalName !== undefined && <button type="button" className="dsh-ssh-group-reset-link" title={t('group-proxy.resetHint')} aria-label={t('group-proxy.resetHosts')} disabled={saving || !name.trim()} onClick={() => { setError(undefined); setConfirmReset(true) }}>{t('group-proxy.resetShort')}</button>}
        <button type="button" className="dsh-ssh-secondary-button" disabled={saving} onClick={onClose}>{t('client.cancel')}</button><button className="dsh-ssh-primary-button" disabled={saving}>{saving ? t('client.saving') : t('group-proxy.saveGroup')}</button>
      </div>
    </form>
  </Dialog>
}
