import { useEffect, useRef, useState } from 'react'
import { api, type SettingsView } from './client-api.js'
import { ConfigBackupPanel } from './config-backup-panel.js'
import { errorMessage } from './ui-components.js'
import { t } from './i18n.js'
import { useSshLocale } from './use-ssh-locale.js'

export function SettingsPane(): JSX.Element {
  useSshLocale()
  const [settings, setSettings] = useState<SettingsView>()
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const confirmed = useRef<SettingsView>()
  const queue = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    const abort = new AbortController()
    void api<SettingsView>('/settings', { signal: abort.signal }).then(value => { confirmed.current = value; setSettings(value) }).catch(reason => { if (!abort.signal.aborted) setError(errorMessage(reason)) })
    return () => abort.abort()
  }, [])
  const save = async (patch: Partial<SettingsView>): Promise<void> => {
    setSaving(true); setSaved(false)
    // Merge each patch with the last server-confirmed snapshot, not an old
    // render captured before an earlier blur/switch save completed.
    const operation = queue.current.then(async () => {
      if (!confirmed.current) return
      try {
        const value = await api<SettingsView>('/settings', { method: 'PUT', body: JSON.stringify({ ...confirmed.current, ...patch }) })
        confirmed.current = value
        setSettings(current => ({ ...value, ...current, ...patch }))
        setError(undefined); setSaved(true)
      } catch (reason) { setError(errorMessage(reason)) }
    })
    queue.current = operation
    await operation
    if (queue.current === operation) setSaving(false)
  }
  const numbers = (key: 'defaultConnectTimeoutMs' | 'defaultCommandTimeoutMs' | 'maxOutputChars') => ({
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => { setSaved(false); setSettings(current => current && { ...current, [key]: Number(event.target.value) }) },
    onBlur: (event: React.FocusEvent<HTMLInputElement>) => { if (event.currentTarget.reportValidity()) void save({ [key]: Number(event.currentTarget.value) }) },
  })
  return <div className="dsh-ssh-settings-pane"><div className="dsh-ssh-content-heading"><div><h1>{t('client.sshSettings')}</h1><p>{t('sync.localSettingsHint')}</p></div><small role="status">{saving ? t('connection.saving') : saved ? t('connection.saved') : ''}</small></div>
    <div className="dsh-ssh-settings-stack">
      <ConfigBackupPanel />
      {settings && <>
        <section className="dsh-ssh-settings-section"><div className="dsh-ssh-settings-section-heading"><strong>{t('connection.timeout')}</strong></div>
          <fieldset disabled={saving} className="dsh-ssh-settings-group" style={fieldsetStyle}>
            <label className="dsh-ssh-number-row"><span><strong>{t('connection.defaultTimeout')}</strong><small>{t('connection.defaultHint')}</small></span><input aria-label={t('connection.defaultTimeout')} aria-describedby="ssh-connect-timeout-help" required type="number" min="1000" max="120000" step="1000" value={settings.defaultConnectTimeoutMs ?? 15000} {...numbers('defaultConnectTimeoutMs')} /><em>{t('client.ms')}</em></label>
            <p id="ssh-connect-timeout-help" className="dsh-ssh-form-hint">{t('connection.timeoutHint')}</p>
            <label className="dsh-ssh-switch-row"><span><strong>{t('connection.reuse')}</strong><small>{t('connection.reuseHint')}</small></span><input type="checkbox" checked={settings.reuseTerminalConnections === true} onChange={event => { void save({ reuseTerminalConnections: event.target.checked }) }} /></label>
          </fieldset>
        </section>
        <section className="dsh-ssh-settings-section" aria-labelledby="dsh-ssh-local-title"><div className="dsh-ssh-settings-section-heading"><span><strong id="dsh-ssh-local-title">{t('client.localRuntimeSettings')}</strong><small>{t('client.affectsThisDshInstanceOnlyNotSyncedViaGist')}</small></span></div>
          <fieldset disabled={saving} className="dsh-ssh-settings-group" style={fieldsetStyle}>
            <label className="dsh-ssh-switch-row"><span><strong>{t('client.allowPublicPortBinding')}</strong><small>{t('client.allowsForwardsToListenOn0000')}</small></span><input type="checkbox" checked={settings.allowPublicBind} onChange={event => { void save({ allowPublicBind: event.target.checked }) }} /></label>
            <label className="dsh-ssh-number-row"><span><strong>{t('client.defaultCommandTimeout')}</strong><small>{t('client.maximumWaitTimeForTheAiSSshExec')}</small></span><input required type="number" min="1000" max="300000" step="1000" value={settings.defaultCommandTimeoutMs} {...numbers('defaultCommandTimeoutMs')} /><em>{t('client.ms')}</em></label>
            <label className="dsh-ssh-number-row"><span><strong>{t('client.maxCommandOutput')}</strong><small>{t('client.keepsTheNewestOutputBeyondThisLimitSoContext')}</small></span><input required type="number" min="1000" max="1000000" step="1000" value={settings.maxOutputChars} {...numbers('maxOutputChars')} /><em>{t('client.chars')}</em></label>
          </fieldset>
        </section>
      </>}
    </div>{error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
  </div>
}

const fieldsetStyle = { border: 0, margin: 0, padding: 0, minWidth: 0 }
