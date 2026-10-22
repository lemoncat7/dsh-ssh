import { useState } from 'react'
import { api } from './client-api.js'
import { t } from './i18n.js'

type Defaults = { permission: 'exec' | 'terminal'; requireCommandApproval: boolean }
export function SessionDefaults(): JSX.Element {
  const [value, setValue] = useState<Defaults>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const load = async (): Promise<void> => {
    setBusy(true); setError(undefined)
    try { setValue(await api<Defaults>('/session-defaults')) }
    catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  const save = async (next: Defaults): Promise<void> => {
    setBusy(true); setError(undefined)
    try { setValue(await api<Defaults>('/session-defaults', { method: 'PUT', body: JSON.stringify(next) })) }
    catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  return <details className="dsh-ssh-session-defaults" onToggle={event => { if (event.currentTarget.open && !value && !busy) void load() }}>
    <summary>{t('session-defaults.title')}</summary>
    <small>{t('session-defaults.hint')}</small>
    {value && <>
      <div className="dsh-ssh-access-segments">
        {(['exec', 'terminal'] as const).map(permission => <button key={permission} type="button" disabled={busy} aria-pressed={value.permission === permission} className={value.permission === permission ? 'is-active' : ''} onClick={() => void save({ ...value, permission })}>{permission === 'exec' ? t('remote-workspace-tree.commandsOnly') : t('remote-workspace-tree.terminalControl')}</button>)}
      </div>
      <label className="dsh-ssh-access-approval"><span>{t('remote-workspace-tree.confirmBeforeRunning')}</span><input type="checkbox" checked={value.requireCommandApproval} disabled={busy} onChange={event => void save({ ...value, requireCommandApproval: event.target.checked })} /><i aria-hidden="true" /></label>
    </>}
    {busy && <small role="status">{t('remote-workspace-tree.saving')}</small>}
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}<button type="button" disabled={busy} onClick={() => void load()}>{t('session-defaults.retry')}</button></p>}
  </details>
}
