import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type SettingsView, type GistSyncView, type GitHubDeviceFlowStart, type GitHubDeviceFlowStatus } from './client-api.js'
import { Dialog, Field, PasswordInput, errorMessage as message } from './ui-components.js'
import { useSshLocale } from './use-ssh-locale.js'
import { t } from './i18n.js'
import { refreshWorkspace } from './use-workspace-refresh.js'
import Stepper, { Step } from './sync-stepper.js'

// A transport owns its setup workflow; its authorization choices are not sync methods.
const syncMethods = [
  { id: 'github', name: 'GitHub Gist', available: true },
  { id: 'webdav', name: 'WebDAV', available: false },
  { id: 's3', name: 'S3', available: false },
] as const
type Policy = Pick<GistSyncView, 'autoSync' | 'strategy' | 'backupRetention'>
const policyOf = (view: GistSyncView): Policy => ({ autoSync: view.autoSync, strategy: view.strategy, backupRetention: view.backupRetention })
function configOf(view: GistSyncView) {
  return { ...policyOf(view), gistId: view.gistId ?? '', oauthClientId: view.oauthClientId ?? '' }
}
async function configure(view: GistSyncView, patch: Record<string, unknown> = {}, secrets: Record<string, string> = {}): Promise<GistSyncView> {
  return api('/gist-sync', { method: 'PUT', body: JSON.stringify({ settings: { ...configOf(view), ...patch }, ...secrets }) })
}

export function SyncPane({ active }: { active: boolean }): JSX.Element {
  useSshLocale()
  const [saved, setSaved] = useState<GistSyncView>()
  const [policy, setPolicy] = useState<Policy>()
  const [settings, setSettings] = useState<SettingsView>()
  const [setup, setSetup] = useState(false)
  const [busy, setBusy] = useState<'save' | 'sync' | 'network'>()
  const [notice, setNotice] = useState<string>()
  const [error, setError] = useState<string>()
  const load = useCallback(async () => {
    setError(undefined)
    try {
      const [next, local] = await Promise.all([api<GistSyncView>('/gist-sync'), api<SettingsView>('/settings')])
      setSaved(next); setPolicy(policyOf(next)); setSettings(local)
    } catch (reason) { setError(message(reason)) }
  }, [])
  useEffect(() => { void load() }, [load])
  // Refresh automatic-sync status without discarding unsaved policy edits.
  useEffect(() => {
    if (!active || setup || busy || !saved) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try { const next = await api<GistSyncView>('/gist-sync'); if (!cancelled) setSaved(next) } catch { /* Manual actions surface network errors. */ }
      if (!cancelled) timer = setTimeout(() => { void poll() }, 10_000)
    }
    timer = setTimeout(() => { void poll() }, 10_000)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [active, setup, busy, Boolean(saved)])
  const persist = async (kind: 'save' | 'sync') => {
    if (!saved || !policy || busy) return
    setBusy(kind); setError(undefined); setNotice(undefined)
    try {
      const next = await configure(saved, policy); setSaved(next)
      if (kind === 'sync') {
        const synced = await api<GistSyncView>('/gist-sync/run', { method: 'POST' })
        setSaved(synced); refreshWorkspace(); setNotice(syncResultLabel(synced.lastResult))
      } else setNotice(t('client.gistSyncSettingsSaved'))
    } catch (reason) { setError(message(reason)) }
    finally { setBusy(undefined) }
  }
  const saveNetwork = async () => {
    if (!settings || busy) return
    setBusy('network'); setError(undefined); setNotice(undefined)
    try {
      const current = await api<SettingsView>('/settings')
      setSettings(await api('/settings', { method: 'PUT', body: JSON.stringify({ ...current, githubProxy: settings.githubProxy ?? '' }) }))
      const result = await api<{ route: 'direct' | 'proxy' }>('/gist-sync/network/test', { method: 'POST' })
      setNotice(t('client.githubReachable', [result.route === 'proxy' ? t('client.viaProxy') : t('client.direct')]))
    } catch (reason) { setError(message(reason)) }
    finally { setBusy(undefined) }
  }
  const ready = saved?.tokenConfigured && saved.encryptionConfigured && !saved.authPaused
  const blocked = Boolean(busy || saved?.running || setup)
  const dirty = saved && policy && JSON.stringify(policy) !== JSON.stringify(policyOf(saved))
  return <div className="dsh-ssh-settings-pane dsh-ssh-sync-page">
    <div className="dsh-ssh-content-heading"><div><h1>{t('sync.title')}</h1><p>{t('sync.description')}</p></div></div>
    <div className="dsh-ssh-sync-layout">
      <aside className="dsh-ssh-sync-methods" aria-label={t('sync.methods')}><h2>{t('sync.methods')}</h2>
        {syncMethods.map(method => <button key={method.id} type="button" className={`dsh-ssh-sync-method${method.available ? ' is-selected' : ''}`} disabled={!method.available} aria-current={method.available ? 'page' : undefined}>
          <span className="dsh-ssh-sync-method-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d={method.id === 'github' ? 'M8 3H4v18h4M16 3h4v18h-4M14 7l-4 10' : 'M6 18a5 5 0 0 1-1-9.9 7 7 0 0 1 13.4 1.4A4.3 4.3 0 0 1 18 18Z'} /></svg></span>
          <span><strong>{method.name}</strong><small>{method.available ? t('sync.githubMethod') : t('sync.unavailable')}</small></span>
        </button>)}<p>{t('sync.methodsHint')}</p>
      </aside>
      <div className="dsh-ssh-sync-detail">
        {!saved && !error && <p role="status">{t('sync.loading')}</p>}
        {notice && <p className="dsh-ssh-inline-success" role="status">{notice}</p>}
        {error && <div className="dsh-ssh-inline-error" role="alert">{error}{!saved && <button type="button" className="dsh-ssh-text-button" onClick={() => { void load() }}>{t('session-defaults.retry')}</button>}</div>}
        {saved && policy && <>
          <div className="dsh-ssh-sync-overview"><div><h2>GitHub Gist</h2><p>{t('sync.githubDescription')}</p></div><SyncStatus view={saved} /></div>
          <section className="dsh-ssh-sync-account"><div><strong>{saved.authPaused ? t('client.checkGithubAuthorization') : saved.tokenConfigured ? t('client.connected2', [saved.githubLogin ?? 'GitHub']) : t('sync.notConnected')}</strong><p>{saved.tokenConfigured ? saved.encryptionConfigured ? t('sync.configuredHint') : t('sync.encryptionMissing') : t('sync.setupHint')}</p></div><button type="button" className={ready ? 'dsh-ssh-secondary-button' : 'dsh-ssh-primary-button'} disabled={blocked} onClick={() => { setSetup(true); setNotice(undefined); setError(undefined) }}>{saved.tokenConfigured ? t('sync.manage') : t('sync.startSetup')}</button></section>
          {saved.lastError && <p className="dsh-ssh-inline-error" role="alert">{saved.lastError}</p>}
          <form onSubmit={event => { event.preventDefault(); void persist('save') }}>
            <fieldset className="dsh-ssh-sync-controls" disabled={blocked}>
              <section className="dsh-ssh-sync-section"><h3>{t('sync.behavior')}</h3>
                <label className="dsh-ssh-switch-row dsh-ssh-auto-sync"><span><strong>{t('client.autoSync')}</strong><small>{t('sync.autoHint')}</small></span><input type="checkbox" checked={policy.autoSync} onChange={event => setPolicy({ ...policy, autoSync: event.target.checked })} /></label>
                <Field label={t('sync.conflicts')} hint={t('sync.conflictsHint')}><select value={policy.strategy} onChange={event => setPolicy({ ...policy, strategy: event.target.value as Policy['strategy'] })}><option value="smart">{t('sync.smart')}</option><option value="local-first">{t('client.localFirst')}</option><option value="cloud-first">{t('client.cloudFirst')}</option></select></Field>
                <Field label={t('client.backupsToKeep')} hint={t('sync.backupHint')}><input type="number" min="0" max="50" required step="1" value={policy.backupRetention} onChange={event => setPolicy({ ...policy, backupRetention: Number(event.target.value) })} /></Field>
              </section>
            </fieldset>
            <div className="dsh-ssh-sync-footer"><span role="status">{dirty ? t('sync.unsaved') : t('sync.saved')}</span><div>
              <button type="submit" className="dsh-ssh-secondary-button" disabled={blocked || !dirty}>{busy === 'save' ? t('client.saving2') : t('client.saveSyncSettings')}</button>
              <button type="button" className="dsh-ssh-primary-button" disabled={blocked || !ready} onClick={event => { if (event.currentTarget.form?.reportValidity()) void persist('sync') }}>{busy === 'sync' || saved.running ? t('client.syncing') : t('client.syncNow')}</button>
            </div></div>
          </form>
          <div className="dsh-ssh-sync-record"><span>{t('client.lastSync')}: {saved.lastSyncAt ? new Date(saved.lastSyncAt).toLocaleString() : t('client.neverSynced')}</span>{saved.gistUrl && <a href={saved.gistUrl} target="_blank" rel="noreferrer">{t('sync.openCloud')}</a>}</div>
        </>}
        <details className="dsh-ssh-sync-disclosure"><summary>{t('sync.scope')}</summary><div><p>{t('sync.scopeHint')}</p><p>{t('sync.privacyHint')}</p><p>{t('client.keptLocalOnly')}: {t('client.sessionGrantsPortForwardingPublicBindsAndCommandLimits')}</p></div></details>
        {settings && <details className="dsh-ssh-sync-disclosure"><summary>{t('sync.network')}</summary><form onSubmit={event => { event.preventDefault(); void saveNetwork() }}>
          <Field label={t('client.githubOutboundProxy')} hint={t('client.usedOnlyForOauthAndTheGistApiE')}><input maxLength={2048} spellCheck={false} value={settings.githubProxy ?? ''} onChange={event => setSettings(withGitHubProxy(settings, event.target.value))} placeholder={t('client.connectToGithubDirectly')} /></Field>
          <button type="submit" className="dsh-ssh-secondary-button" disabled={blocked}>{busy === 'network' ? t('client.testing') : t('sync.saveNetwork')}</button>
        </form></details>}
      </div>
    </div>
    {active && setup && saved && <SyncSetupDialog initial={saved} onUpdated={setSaved} onClose={() => setSetup(false)} />}
  </div>
}

function SyncSetupDialog({ initial, onUpdated, onClose }: { initial: GistSyncView; onUpdated(value: GistSyncView): void; onClose(): void }): JSX.Element {
  useSshLocale()
  const [saved, setSaved] = useState(initial)
  const [step, setStep] = useState(1)
  const [method, setMethod] = useState<'token' | 'device'>(initial.oauthClientId ? 'device' : 'token')
  const [reauthorize, setReauthorize] = useState(!initial.tokenConfigured || initial.authPaused === true)
  const [token, setToken] = useState('')
  const [clientId, setClientId] = useState(initial.oauthClientId ?? '')
  const [destination, setDestination] = useState<'new' | 'existing'>(initial.gistId ? 'existing' : 'new')
  const [gistId, setGistId] = useState(initial.gistId ?? '')
  const [passphrase, setPassphrase] = useState('')
  const [flow, setFlow] = useState<GitHubDeviceFlowStart>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [copied, setCopied] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  const update = (value: GistSyncView) => { setSaved(value); onUpdated(value) }
  useEffect(() => {
    if (!flow) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        if (Date.now() >= flow.expiresAt) throw new Error(t('sync.expired'))
        const status = await api<GitHubDeviceFlowStatus>('/gist-sync/oauth/poll', { method: 'POST', body: JSON.stringify({ id: flow.id }) })
        if (cancelled) return
        if (status.state === 'complete') {
          const next = await api<GistSyncView>('/gist-sync')
          if (cancelled) return
          update(next); setFlow(undefined); setReauthorize(false); setStep(2)
        } else timer = setTimeout(() => { void poll() }, Math.max(1_000, status.retryAfterMs))
      } catch (reason) { if (!cancelled) { setFlow(undefined); setError(message(reason)) } }
    }
    timer = setTimeout(() => { void poll() }, Math.max(1_000, flow.retryAfterMs))
    return () => { cancelled = true; clearTimeout(timer) }
  }, [flow?.id])
  const advance = async () => {
    if (busy || flow || !form.current?.reportValidity()) return
    setError(undefined)
    if (step === 2) { setStep(3); return }
    if (step === 1 && saved.tokenConfigured && !reauthorize && !saved.authPaused) { setStep(2); return }
    setBusy(true)
    try {
      if (step === 1) {
        if (method === 'device') {
          const next = await configure(saved, { oauthClientId: clientId.trim() }); update(next)
          setFlow(await api('/gist-sync/oauth/start', { method: 'POST' })); setCopied(false)
          return
        }
        const next = await configure(saved, {}, { token: token.trim() }); update(next); setToken('')
        await api('/gist-sync/account/test', { method: 'POST' })
        update(await api('/gist-sync')); setReauthorize(false); setStep(2)
      } else {
        const next = await configure(saved, { gistId: destination === 'existing' ? gistId.trim() : '' }, passphrase ? { encryptionPassphrase: passphrase } : {})
        update(next); setPassphrase(''); onClose()
      }
    } catch (reason) { setError(message(reason)) }
    finally { setBusy(false) }
  }
  const disconnect = async () => {
    setBusy(true); setError(undefined)
    try { update(await api('/gist-sync/oauth/disconnect', { method: 'POST' })); setReauthorize(true); setToken(''); setFlow(undefined) }
    catch (reason) { setError(message(reason)) }
    finally { setBusy(false) }
  }
  return <Dialog title={t('sync.setupTitle')} subtitle={t('sync.setupSubtitle')} className="dsh-ssh-sync-dialog" dismissible={!busy} onClose={() => { if (!busy) onClose() }}>
    <form ref={form} className="dsh-ssh-sync-wizard" onSubmit={event => { event.preventDefault(); void advance() }}>
      {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
      <Stepper step={step} onStepChange={next => { setStep(next); setError(undefined) }} onNext={() => { void advance() }} busy={busy || Boolean(flow)} backButtonText={t('sync.back')} nextButtonText={busy ? t('sync.processing') : step === 1 && reauthorize ? method === 'device' ? t('sync.authorize') : t('sync.verifyContinue') : t('sync.continue')} completeButtonText={busy ? t('client.saving2') : t('sync.complete')}>
        <Step title={t('sync.account')}>
          <h3>{t('sync.accountHeading')}</h3><p>{t('sync.accountHint')}</p>
          {saved.tokenConfigured && !reauthorize ? <div className="dsh-ssh-sync-connected"><strong>{t('client.connected2', [saved.githubLogin ?? 'GitHub'])}</strong><p>{t('sync.keepAuth')}</p><button type="button" className="dsh-ssh-secondary-button" disabled={busy} onClick={() => setReauthorize(true)}>{t('sync.changeAuth')}</button><button type="button" className="dsh-ssh-text-button" disabled={busy} onClick={() => { void disconnect() }}>{t('client.disconnect')}</button></div> : <>
            <fieldset className="dsh-ssh-sync-controls" disabled={busy || Boolean(flow)}>
              <div className="dsh-ssh-sync-choice" role="group" aria-label={t('sync.authMethod')}>
                <button type="button" aria-pressed={method === 'token'} onClick={() => { setMethod('token'); setToken(''); setError(undefined) }}>{t('sync.tokenMode')}</button>
                <button type="button" aria-pressed={method === 'device'} onClick={() => { setMethod('device'); setToken(''); setError(undefined) }}>{t('sync.deviceMode')}</button>
              </div>
              {method === 'token' ? <>
                <ol className="dsh-ssh-sync-instructions"><li><a href="https://github.com/settings/tokens/new?scopes=gist&description=DSH%20SSH%20Sync" target="_blank" rel="noreferrer">{t('sync.createToken')}</a>{t('sync.tokenScope')}</li><li>{t('sync.tokenPaste')}</li></ol>
                <Field label={t('sync.tokenLabel')} hint={t('sync.tokenHint')}><PasswordInput required={!saved.tokenConfigured || Boolean(saved.authPaused)} autoComplete="new-password" spellCheck={false} value={token} onChange={event => setToken(event.target.value)} placeholder={saved.tokenConfigured ? t('client.savedLeaveBlankToKeepUnchanged') : 'ghp_…'} /></Field>
              </> : <>
                <p>{t('sync.deviceHelp')} <a href="https://github.com/settings/applications/new" target="_blank" rel="noreferrer">{t('sync.createApp')}</a></p>
                <Field label="GitHub OAuth Client ID" hint={t('client.enableDeviceFlowInTheGithubOauthAppNo')}><input required maxLength={128} spellCheck={false} value={clientId} onChange={event => setClientId(event.target.value)} placeholder="Ov23li…" /></Field>
              </>}
            </fieldset>
            {flow && <div className="dsh-ssh-sync-device" role="status"><p>{t('client.copyTheDeviceCodeThenGoToGithubTo')}</p><div className="dsh-ssh-device-code-block"><code>{flow.userCode}</code><button type="button" className="dsh-ssh-secondary-button" onClick={() => { void navigator.clipboard.writeText(flow.userCode).then(() => setCopied(true)).catch(() => setError(t('client.theBrowserBlockedAutomaticCopyingSelectTheDeviceCode'))) }}>{copied ? t('client.copied') : t('client.copyCode')}</button></div><a className="dsh-ssh-primary-button" href={flow.verificationUri} target="_blank" rel="noreferrer">{t('client.goToGithubToAuthorize')}</a><p>{t('client.theConnectionCompletesAutomaticallyOnceAuthorized')}</p><button type="button" className="dsh-ssh-text-button" onClick={() => setFlow(undefined)}>{t('sync.cancelAuth')}</button></div>}
          </>}
          <p className="dsh-ssh-sync-footnote">{t('sync.authSavedHint')}</p>
        </Step>
        <Step title={t('sync.storage')}>
          <h3>{t('sync.storageHeading')}</h3><p>{t('sync.storageHint')}</p>
          <div className="dsh-ssh-sync-choice" role="group" aria-label={t('sync.storage')}>
            <button type="button" aria-pressed={destination === 'new'} onClick={() => setDestination('new')}>{t('sync.newSpace')}</button>
            <button type="button" aria-pressed={destination === 'existing'} onClick={() => setDestination('existing')}>{t('sync.existingSpace')}</button>
          </div>
          {destination === 'existing' ? <Field label="Gist ID" hint={t('sync.gistHelp')}><input required maxLength={64} pattern="[a-fA-F0-9]+" spellCheck={false} value={gistId} onChange={event => setGistId(event.target.value)} /></Field> : <p>{t('sync.newSpaceHint')}</p>}
          <Field label={t('client.syncEncryptionPassword')} hint={saved.encryptionConfigured ? t('client.savedSecurelyEnterTheSamePasswordOnANew') : t('sync.passwordHint')}><PasswordInput required={!saved.encryptionConfigured} minLength={6} maxLength={512} autoComplete="new-password" value={passphrase} onChange={event => setPassphrase(event.target.value)} placeholder={saved.encryptionConfigured ? t('client.configured') : t('client.setASeparateEncryptionPassword')} /></Field>
        </Step>
        <Step title={t('sync.review')}>
          <h3>{t('sync.reviewHeading')}</h3><p>{t('sync.reviewHint')}</p>
          <dl className="dsh-ssh-sync-review"><div><dt>{t('sync.account')}</dt><dd>{saved.githubLogin ?? 'GitHub'}</dd></div><div><dt>{t('sync.storage')}</dt><dd>{destination === 'existing' ? gistId : t('sync.newSpace')}</dd></div><div><dt>{t('client.syncEncryptionPassword')}</dt><dd>{passphrase ? t('sync.passwordWillSave') : t('client.configured')}</dd></div><div><dt>{t('client.autoSync')}</dt><dd>{saved.autoSync ? t('sync.autoEnabled') : t('sync.manualEnabled')}</dd></div></dl>
          <p className="dsh-ssh-sync-footnote">{t('sync.privacyHint')}</p>
        </Step>
      </Stepper>
    </form>
  </Dialog>
}
function withGitHubProxy(view: SettingsView, value: string): SettingsView {
  if (value !== '') return { ...view, githubProxy: value }
  const { githubProxy: _githubProxy, ...rest } = view
  return rest
}

function SyncStatus({ view }: { view: GistSyncView }): JSX.Element {
  useSshLocale()
  const ready = view.tokenConfigured && view.encryptionConfigured
  const label = view.running ? t("client.syncing2") : view.lastError ? t("client.actionNeeded") : view.lastSyncAt === undefined ? ready ? t("client.waitingForFirstSync") : t("client.notConfigured") : t("client.lastSynced", [formatRelativeTime(view.lastSyncAt)])
  return <span className={`dsh-ssh-sync-status${view.running ? ' is-running' : view.lastError ? ' is-error' : ready ? ' is-ready' : ''}`} role="status"><i aria-hidden="true" />{label}</span>
}

function syncResultLabel(result: GistSyncView['lastResult']): string {
  return result === 'uploaded' ? t("client.localConfigUploaded") : result === 'downloaded' ? t("client.cloudConfigApplied") : result === 'merged' ? t("client.configsFromBothSidesMergedIntelligently") : t("client.configIsAlreadyUpToDate")
}

function formatRelativeTime(value: number): string {
  const elapsed = Math.max(0, Date.now() - value)
  if (elapsed < 60_000) return t("client.justNow")
  if (elapsed < 3_600_000) return t("client.minutesAgo", [Math.floor(elapsed / 60_000)])
  if (elapsed < 86_400_000) return t("client.hoursAgo", [Math.floor(elapsed / 3_600_000)])
  return new Date(value).toLocaleString()
}

