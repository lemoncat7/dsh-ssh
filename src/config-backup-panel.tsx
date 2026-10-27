import { useState, type FormEvent } from 'react'
import { api } from './client-api.js'
import { Dialog, Field, PasswordInput, errorMessage } from './ui-components.js'
import { t } from './i18n.js'
import { useSshLocale } from './use-ssh-locale.js'
import { refreshWorkspace } from './use-workspace-refresh.js'

const countKeys = ['profiles', 'ftpProfiles', 'remoteProjects', 'credentialEntries', 'proxyEntries', 'commands', 'groupProxies'] as const
export function ConfigBackupPanel(): JSX.Element {
  useSshLocale()
  const [mode, setMode] = useState<'import' | 'export'>()
  const [notice, setNotice] = useState('')
  return <section className="dsh-ssh-settings-section dsh-ssh-backup-section" aria-labelledby="ssh-backup-title">
    <div className="dsh-ssh-settings-section-heading"><span><strong id="ssh-backup-title">{t('backup.title')}</strong><small>{t('backup.description')}</small></span></div>
    <div className="dsh-ssh-backup-content"><p>{t('backup.scope')}</p><div className="dsh-ssh-backup-actions">
      <button type="button" className="dsh-ssh-secondary-button" onClick={() => { setNotice(''); setMode('import') }}>{t('backup.import')}</button>
      <button type="button" className="dsh-ssh-secondary-button" onClick={() => { setNotice(''); setMode('export') }}>{t('backup.export')}</button>
    </div><small>{t('backup.excluded')}</small>{notice && <p className="dsh-ssh-inline-success" role="status">{notice}</p>}</div>
    {mode && <BackupDialog mode={mode} onClose={() => setMode(undefined)} onDone={() => { setMode(undefined); setNotice(mode === 'export' ? t('backup.exported') : t('backup.imported')); if (mode === 'import') refreshWorkspace() }} />}
  </section>
}
function BackupDialog({ mode, onClose, onDone }: { mode: 'import' | 'export'; onClose(): void; onDone(): void }): JSX.Element {
  const [passphrase, setPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [file, setFile] = useState<File>()
  const [preview, setPreview] = useState<{ content: string; counts: Record<string, number> }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const exporting = mode === 'export'
  const labels = { profiles: t('backup.profiles'), ftpProfiles: t('backup.ftpProfiles'), remoteProjects: t('backup.remoteProjects'), credentialEntries: t('backup.credentialEntries'), proxyEntries: t('backup.proxyEntries'), commands: t('backup.commands'), groupProxies: t('backup.groupProxies') }
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy) return
    setError(''); setBusy(true)
    try {
      if (exporting) {
        if (passphrase !== confirmation) throw new Error(t('backup.mismatch'))
        const { content } = await api<{ content: string }>('/config-backup/export', { method: 'POST', body: JSON.stringify({ passphrase }) })
        const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
        const link = document.createElement('a')
        link.href = url; link.download = `dsh-ssh-backup-${new Date().toISOString().slice(0, 10)}.json`
        document.body.append(link); link.click(); link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
        onDone()
      } else if (preview) {
        await api('/config-backup/import', { method: 'POST', body: JSON.stringify({ content: preview.content, passphrase }) })
        onDone()
      } else {
        if (!file) throw new Error(t('backup.chooseFile'))
        if (file.size > 1_048_576) throw new Error(t('backup.fileLimit'))
        const content = await file.text()
        const counts = await api<Record<string, number>>('/config-backup/preview', { method: 'POST', body: JSON.stringify({ content, passphrase }) })
        setPreview({ content, counts })
      }
    } catch (reason) { setError(errorMessage(reason)) } finally { setBusy(false) }
  }
  return <Dialog title={exporting ? t('backup.export') : t('backup.import')} subtitle={exporting ? t('backup.passwordHint') : t('backup.importHint')} onClose={onClose} dismissible={!busy}>
    <form className="dsh-ssh-form dsh-ssh-backup-form" onSubmit={event => { void submit(event) }}>
      {!preview && <fieldset disabled={busy} className="dsh-ssh-backup-fields">
        {!exporting && <Field label={t('backup.file')} hint={t('backup.fileHint')}><input type="file" accept=".json,application/json" required onChange={event => { setFile(event.target.files?.[0]); setError('') }} /></Field>}
        <Field label={t('backup.password')} hint={t('backup.passwordLength')}><PasswordInput required minLength={8} maxLength={256} autoComplete={exporting ? 'new-password' : 'current-password'} value={passphrase} onChange={event => setPassphrase(event.target.value)} /></Field>
        {exporting && <Field label={t('backup.confirmPassword')}><PasswordInput required minLength={8} maxLength={256} autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} /></Field>}
      </fieldset>}
      {preview && <div><h3>{t('backup.preview')}</h3><dl className="dsh-ssh-backup-counts">{countKeys.map(key => <div key={key}><dt>{labels[key]}</dt><dd>{preview.counts[key] ?? 0}</dd></div>)}</dl><p className="dsh-ssh-backup-hint">{t('backup.copyHint')}</p></div>}
      {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
      <div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" disabled={busy} onClick={() => { if (preview) { setPreview(undefined); setError('') } else onClose() }}>{preview ? t('backup.back') : t('client.cancel')}</button><button type="submit" className="dsh-ssh-primary-button" disabled={busy}>{busy ? t('backup.processing') : exporting ? t('backup.download') : preview ? t('backup.confirmImport') : t('backup.read')}</button></div>
    </form>
  </Dialog>
}
