import { useSshLocale } from './use-ssh-locale.js'
import { t } from './i18n.js'
import { useId, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  IconCheckOutline14,
  IconChevronDownOutline14,
  IconChevronUpOutline14,
  IconPlusOutline16,
  IconTrashOutline16,
  IconUserOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  ApiError,
  api,
  profileAddress,
  type ProfileView,
  type ProxyEntryView,
  type VaultEntryView,
} from './client-api.js'
import { Dialog, Field, SuggestionInput, errorMessage } from './ui-components.js'
import { findDuplicateProfileEndpoint } from './profile-endpoint.js'

export function ProfileDeleteDialog({ profile, dependents, onClose, onDeleted }: { profile: ProfileView; dependents: ProfileView[]; onClose(): void; onDeleted(): void }): JSX.Element {
  useSshLocale()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string>()

  const remove = async (): Promise<void> => {
    if (deleting || dependents.length > 0) return
    setDeleting(true)
    setError(undefined)
    try {
      await api(`/profiles/${encodeURIComponent(profile.id)}`, { method: 'DELETE' })
      onDeleted()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setDeleting(false)
    }
  }

  return <Dialog variant="confirmation" dismissible={!deleting} title={t("client.delete2", [profile.name])} subtitle={profileAddress(profile)} onClose={() => { if (!deleting) onClose() }}>
    <div className="dsh-ssh-delete-profile">
      <span className="dsh-ssh-delete-profile-mark"><IconTrashOutline16 size={19} /></span>
      <div><strong>{t("profile-editor.thisActionCannotBeUndone")}</strong><p>{t("profile-editor.theConnectionConfigThisHostSStandaloneCredentialsAnd")}</p></div>
      {dependents.length > 0 && <div className="dsh-ssh-delete-profile-block" role="alert"><strong>{t("profile-editor.cannotDeleteYet")}</strong><p>{t("profile-editor.theseConnectionsStillUseItAsAnSshJump")}{dependents.map(item => item.name).join('、')}{t("profile-editor.editTheirJumpChainsFirst")}</p></div>}
      {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
      <div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" data-ssh-dialog-close disabled={deleting} onClick={onClose}>{t("client.cancel")}</button><button type="button" className="dsh-ssh-danger-button" disabled={deleting || dependents.length > 0} onClick={() => { void remove() }}>{deleting ? t("file-entry-delete-dialog.deleting") : t("client.deleteHost2")}</button></div>
    </div>
  </Dialog>
}

export function ProfileEditor({ profile, profiles, vaultEntries, proxyEntries, onClose, onSaved }: { profile?: ProfileView | undefined; profiles: ProfileView[]; vaultEntries: VaultEntryView[]; proxyEntries: ProxyEntryView[]; onClose(): void; onSaved(): void }): JSX.Element {
  const sshLocale = useSshLocale()
  const [form, setForm] = useState(() => ({
    name: profile?.name ?? '',
    group: profile?.group ?? '',
    host: profile?.host ?? '',
    port: String(profile?.port ?? 22),
    username: profile?.username ?? '',
    authType: profile?.authType ?? 'password',
    credentialId: profile?.credentialId ?? '',
    proxyType: profile?.proxy.type ?? 'none',
    proxyEntryId: profile?.proxy.type === 'saved' ? profile.proxy.proxyId : '',
    proxyHost: profile?.proxy.type === 'http' || profile?.proxy.type === 'socks5' ? profile.proxy.host : '',
    proxyPort: profile?.proxy.type === 'http' || profile?.proxy.type === 'socks5' ? String(profile.proxy.port) : '1080',
    proxyUsername: profile?.proxy.type === 'http' || profile?.proxy.type === 'socks5' ? profile.proxy.username ?? '' : '',
    jumpProfileIds: profile?.proxy.type === 'jump' ? profile.proxy.profileIds : [],
    tags: profile?.tags.join(', ') ?? '',
    password: '',
    privateKey: '',
    passphrase: '',
    proxyPassword: '',
    hostFingerprint: profile?.hostFingerprint ?? '',
  }))
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testState, setTestState] = useState<'success'>()
  const [pendingFingerprint, setPendingFingerprint] = useState<{ fingerprint: string; previousFingerprint?: string; profileId?: string; profileName?: string; draft: string }>()
  const [error, setError] = useState<string>()
  const [endpointError, setEndpointError] = useState<string>()
  const [endpointTouched, setEndpointTouched] = useState(false)
  const endpointErrorId = useId()
  const hostInputRef = useRef<HTMLInputElement>(null)

  const field = (name: Exclude<keyof typeof form, 'jumpProfileIds'>) => ({
    value: form[name],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setForm(value => ({ ...value, [name]: event.target.value }))
      if (name === 'host' || name === 'port') setEndpointError(undefined)
      setTestState(undefined)
      setPendingFingerprint(undefined)
    },
  })
  const selectedCredential = vaultEntries.find(entry => entry.id === form.credentialId)
  const groupOptions = useMemo(() => profiles.flatMap(item => item.group === undefined ? [] : [item.group]), [profiles, sshLocale])
  const tagOptions = useMemo(() => profiles.flatMap(item => item.tags), [profiles, sshLocale])
  const duplicateProfile = useMemo(() => findDuplicateProfileEndpoint(profiles, { host: form.host, port: Number(form.port) }, profile?.id), [form.host, form.port, profile?.id, profiles, sshLocale])
  const endpointValidationMessage = endpointTouched
    ? duplicateProfile === undefined ? endpointError : t("profile-editor.thisAddressAndPortAreAlreadyUsedByChange", [duplicateProfile.name])
    : undefined
  const buildPayload = (hostFingerprint = form.hostFingerprint) => {
    const proxy = form.proxyType === 'none' ? { type: 'none' }
      : form.proxyType === 'saved' ? { type: 'saved', proxyId: form.proxyEntryId }
        : form.proxyType === 'jump' ? { type: 'jump', profileIds: form.jumpProfileIds }
          : { type: form.proxyType, host: form.proxyHost, port: Number(form.proxyPort), ...(form.proxyUsername.trim() ? { username: form.proxyUsername.trim() } : {}) }
    return {
      profile: {
        name: form.name,
        ...(form.group.trim() ? { group: form.group.trim() } : {}),
        host: form.host,
        port: Number(form.port),
        username: selectedCredential?.username ?? form.username,
        authType: selectedCredential?.authType ?? form.authType,
        ...(form.credentialId ? { credentialId: form.credentialId } : {}),
        ...(hostFingerprint ? { hostFingerprint } : {}),
        proxy,
        keepAliveIntervalMs: profile?.keepAliveIntervalMs ?? 15000,
        connectTimeoutMs: profile?.connectTimeoutMs ?? 15000,
        terminalType: profile?.terminalType ?? 'xterm-256color',
        tags: form.tags.split(',').map(item => item.trim()).filter(Boolean),
      },
      secrets: { password: form.password, privateKey: form.privateKey, passphrase: form.passphrase, proxyPassword: form.proxyPassword },
    }
  }

  const testConnection = async (confirmation?: typeof pendingFingerprint): Promise<void> => {
    setEndpointTouched(true)
    if (duplicateProfile !== undefined) { hostInputRef.current?.focus(); return }
    setTesting(true)
    setError(undefined)
    setTestState(undefined)
    setPendingFingerprint(undefined)
    try {
      if (confirmation && confirmation.draft !== JSON.stringify(buildPayload())) throw Error(t('host-key.retest'))
      const isJump = confirmation?.profileId !== undefined && confirmation.profileId !== profile?.id && profiles.some(item => item.id === confirmation.profileId)
      if (isJump) await api(`/profiles/${encodeURIComponent(confirmation!.profileId!)}/confirm-host`, { method: 'POST', body: JSON.stringify({ fingerprint: confirmation!.fingerprint, previousFingerprint: confirmation!.previousFingerprint }) })
      const confirmedFingerprint = isJump ? undefined : confirmation?.fingerprint
      await api('/profiles/test-draft', { method: 'POST', body: JSON.stringify({ ...buildPayload(confirmedFingerprint), ...(profile === undefined ? {} : { profileId: profile.id }) }) })
      if (confirmedFingerprint !== undefined) setForm(current => ({ ...current, hostFingerprint: confirmedFingerprint }))
      setTestState('success')
    } catch (reason) {
      if (reason instanceof ApiError && reason.body?.code === 'HOST_KEY_REQUIRED' && typeof reason.body.fingerprint === 'string') setPendingFingerprint({ fingerprint: reason.body.fingerprint, ...(typeof reason.body.previousFingerprint === 'string' ? { previousFingerprint: reason.body.previousFingerprint } : {}), ...(typeof reason.body.profileId === 'string' ? { profileId: reason.body.profileId } : {}), ...(typeof reason.body.profileName === 'string' ? { profileName: reason.body.profileName } : {}), draft: JSON.stringify(buildPayload()) })
      else if (reason instanceof ApiError && reason.body?.code === 'DUPLICATE_PROFILE_ENDPOINT') { setEndpointError(errorMessage(reason)); hostInputRef.current?.focus() }
      else setError(errorMessage(reason))
    } finally {
      setTesting(false)
    }
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setEndpointTouched(true)
    if (duplicateProfile !== undefined) { hostInputRef.current?.focus(); return }
    setSaving(true)
    setError(undefined)
    try {
      await api(profile === undefined ? '/profiles' : `/profiles/${profile.id}`, { method: profile === undefined ? 'POST' : 'PUT', body: JSON.stringify(buildPayload()) })
      onSaved()
    } catch (reason) {
      if (reason instanceof ApiError && reason.body?.code === 'DUPLICATE_PROFILE_ENDPOINT') { setEndpointError(errorMessage(reason)); hostInputRef.current?.focus() }
      else setError(errorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  return <Dialog title={profile === undefined ? t("profile-editor.newSshConnection") : t("client.edit2", [profile.name])} subtitle={t("profile-editor.credentialsAreNotShownAgainAfterSaving")} onClose={onClose}>
    <form className="dsh-ssh-form" onSubmit={event => { void submit(event) }}>
      <div className="dsh-ssh-form-section"><div className="dsh-ssh-form-section-heading"><strong>{t("profile-editor.connectionInfo")}</strong><small>{t("profile-editor.hostAddressAndDisplay")}</small></div>
        <div className="dsh-ssh-form-grid"><Field label={t("client.name")}><input required maxLength={80} placeholder={t("profile-editor.devServer")} {...field('name')} /></Field><Field label={t("profile-editor.group")}><SuggestionInput ariaLabel={t("profile-editor.hostGroup")} maxLength={64} options={groupOptions} placeholder={t("ftp-profile-editor.selectAnExistingGroupOrEnterANewOne")} value={form.group} onChange={group => setForm(current => ({ ...current, group }))} /></Field></div>
        <div className="dsh-ssh-form-grid is-host"><Field label={t("client.host")}><input ref={hostInputRef} required aria-invalid={endpointValidationMessage === undefined ? undefined : true} aria-describedby={endpointValidationMessage === undefined ? undefined : endpointErrorId} placeholder="server.example.com" spellCheck={false} {...field('host')} onBlur={() => setEndpointTouched(true)} />{endpointValidationMessage && <small id={endpointErrorId} className="dsh-ssh-field-error" role="alert">{endpointValidationMessage}</small>}</Field><Field label={t("ftp-profile-editor.port")}><input required aria-invalid={endpointValidationMessage === undefined ? undefined : true} aria-describedby={endpointValidationMessage === undefined ? undefined : endpointErrorId} type="number" inputMode="numeric" min="1" max="65535" {...field('port')} onBlur={() => setEndpointTouched(true)} /></Field></div>
        <Field label={t("profile-editor.tags")} hint={t("ftp-profile-editor.pickExistingTagsOrTypeNewOnesSeparateMultiple")}><SuggestionInput ariaLabel={t("profile-editor.hostTags")} multiple options={tagOptions} placeholder={t("ftp-profile-editor.selectOrEnterTags")} value={form.tags} onChange={tags => setForm(current => ({ ...current, tags }))} /></Field>
      </div>
      <div className="dsh-ssh-form-section"><div className="dsh-ssh-form-section-heading"><strong>{t("ftp-profile-editor.authentication")}</strong><small>{t("profile-editor.chooseSharedCredentialsOrSaveSeparately")}</small></div>
        <Field label={t("ftp-profile-editor.credentialSource")} hint={t("profile-editor.useThisConnectionSOwnCredentialsOrReferenceA")}><select {...field('credentialId')}><option value="">{t("profile-editor.savedWithThisConnectionOnly")}</option>{vaultEntries.map(entry => <option value={entry.id} key={entry.id}>{entry.name} · {entry.username}</option>)}</select></Field>
        {selectedCredential ? <div className="dsh-ssh-credential-reference"><span><IconUserOutline16 size={16} /></span><span><strong>{selectedCredential.name}</strong><small>{selectedCredential.username} · {selectedCredential.authType === 'password' ? t("client.password") : t("client.privateKey")}</small></span><em>{selectedCredential.credential.configured ? t("profile-editor.ready") : t("client.missingCredentials")}</em></div> : <>
          <div className="dsh-ssh-form-grid"><Field label={t("client.username")}><input required autoComplete="username" {...field('username')} /></Field><Field label={t("client.authMethod")}><select {...field('authType')}><option value="password">{t("client.password")}</option><option value="private-key">{t("client.privateKey")}</option><option value="agent">SSH Agent</option></select></Field></div>
          {form.authType === 'password' && <Field label={t("client.password")} hint={profile?.credential.source === 'profile' && profile.credential.fields.includes('password') ? t("client.savedLeaveBlankToKeepUnchanged") : t("profile-editor.cannotBeReadBackAfterSaving")}><input required={profile === undefined} type="password" autoComplete="new-password" placeholder={profile?.credential.source === 'profile' && profile.credential.fields.includes('password') ? '••••••••' : ''} {...field('password')} /></Field>}
          {form.authType === 'private-key' && <><Field label={t("client.privateKey")} hint={profile?.credential.source === 'profile' && profile.credential.fields.includes('privateKey') ? t("client.savedLeaveBlankToKeepUnchanged") : t("profile-editor.pasteOpensshPemPrivateKey")}><textarea required={profile === undefined} rows={5} spellCheck={false} {...field('privateKey')} /></Field><Field label={t("client.keyPassphrase")}><input type="password" autoComplete="new-password" {...field('passphrase')} /></Field></>}
        </>}
      </div>
      <div className="dsh-ssh-form-section"><div className="dsh-ssh-form-section-heading"><strong>{t("profile-editor.connectionPath")}</strong><small>{t("profile-editor.directProxyOrJumpChain")}</small></div>
        <Field label={t("profile-editor.connectionMode")}><select {...field('proxyType')}><option value="none">{t("group-proxy.automatic")}</option><option value="saved">{t("client.commonProxies")}</option><option value="http">{t("profile-editor.customHttpConnect")}</option><option value="socks5">{t("profile-editor.customSocks5")}</option><option value="jump">{t("client.sshJumpHost")}</option></select></Field>
        {form.proxyType === 'saved' && <Field label={t("client.commonProxies")} hint={proxyEntries.length === 0 ? t("profile-editor.addAnHttpOrSocks5ProxyToTheProxy") : t("profile-editor.multipleHostsCanShareTheSameProxyConfiguration")}><select required {...field('proxyEntryId')}><option value="">{t("profile-editor.selectProxy")}</option>{proxyEntries.map(entry => <option value={entry.id} key={entry.id}>{entry.name} · {entry.proxyType === 'http' ? 'HTTP' : 'SOCKS5'} · {entry.host}:{entry.port}</option>)}</select></Field>}
        {(form.proxyType === 'http' || form.proxyType === 'socks5') && <><div className="dsh-ssh-form-grid is-host"><Field label={t("client.proxyHost")}><input required spellCheck={false} {...field('proxyHost')} /></Field><Field label={t("client.proxyPort")}><input required type="number" inputMode="numeric" min="1" max="65535" {...field('proxyPort')} /></Field></div><div className="dsh-ssh-form-grid"><Field label={t("client.proxyUsername")}><input autoComplete="username" {...field('proxyUsername')} /></Field><Field label={t("client.proxyPassword")}><input type="password" autoComplete="new-password" {...field('proxyPassword')} /></Field></div></>}
        {form.proxyType === 'jump' && <JumpChainEditor profiles={profiles.filter(item => item.id !== profile?.id)} value={form.jumpProfileIds} onChange={jumpProfileIds => setForm(current => ({ ...current, jumpProfileIds }))} />}
      </div>
      {pendingFingerprint && <div className="dsh-ssh-test-result is-warning" role="alert"><span><strong>{pendingFingerprint.previousFingerprint ? t('host-key.changed') : t("profile-editor.firstConnectionVerifyTheHostFingerprint")}</strong><span>{pendingFingerprint.profileName ?? form.name}</span><span>{t('host-key.warning')}</span>{pendingFingerprint.previousFingerprint && <><span>{t('host-key.previous')}</span><code>{pendingFingerprint.previousFingerprint}</code></>}<span>{t('host-key.current')}</span><code>{pendingFingerprint.fingerprint}</code><small>{t('host-key.saveHint')}</small></span><button type="button" className="dsh-ssh-small-primary" disabled={testing} onClick={() => { void testConnection(pendingFingerprint) }}>{t('host-key.confirm')}</button></div>}
      {testState === 'success' && <p className="dsh-ssh-test-result is-success" role="status"><IconCheckOutline14 size={14} />{t("profile-editor.connectionTestSucceeded")}</p>}
      {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
      <div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button dsh-ssh-test-button" disabled={saving || testing} onClick={event => { if (event.currentTarget.form?.reportValidity()) void testConnection() }}>{testing ? t("ftp-profile-editor.testing") : t("client.testConnection")}</button><button type="button" className="dsh-ssh-secondary-button" data-ssh-dialog-close disabled={saving || testing} onClick={onClose}>{t("client.cancel")}</button><button className="dsh-ssh-primary-button" disabled={saving || testing}>{saving ? t("client.saving") : t("ftp-profile-editor.saveConnection")}</button></div>
    </form>
  </Dialog>
}

function JumpChainEditor({ profiles, value, onChange }: { profiles: ProfileView[]; value: string[]; onChange(value: string[]): void }): JSX.Element {
  useSshLocale()
  const add = (): void => {
    const next = profiles.find(profile => !value.includes(profile.id))
    if (next !== undefined && value.length < 8) onChange([...value, next.id])
  }
  const update = (index: number, profileId: string): void => onChange(value.map((id, current) => current === index ? profileId : id))
  const move = (index: number, offset: -1 | 1): void => {
    const target = index + offset
    if (target < 0 || target >= value.length) return
    const next = [...value]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    onChange(next)
  }

  return <fieldset className="dsh-ssh-jump-chain"><legend>{t("profile-editor.jumpChain")}</legend><p>{t("profile-editor.connectionsAreEstablishedHopByHopTopToBottom")}</p>
    <div>{value.map((profileId, index) => <div className="dsh-ssh-jump-row" key={`${profileId}-${index}`}><em>{index + 1}</em><select required value={profileId} onChange={event => update(index, event.target.value)}><option value="">{t("profile-editor.selectAnExistingConnection")}</option>{profiles.filter(profile => profile.id === profileId || !value.includes(profile.id)).map(profile => <option value={profile.id} key={profile.id}>{profile.name} · {profile.host}</option>)}</select><button type="button" className="dsh-ssh-icon-button" disabled={index === 0} aria-label={t("profile-editor.moveJumpHostUp")} onClick={() => move(index, -1)}><IconChevronUpOutline14 size={14} /></button><button type="button" className="dsh-ssh-icon-button" disabled={index === value.length - 1} aria-label={t("profile-editor.moveJumpHostDown")} onClick={() => move(index, 1)}><IconChevronDownOutline14 size={14} /></button><button type="button" className="dsh-ssh-icon-button is-danger" aria-label={t("profile-editor.removeJumpHost")} onClick={() => onChange(value.filter((_, current) => current !== index))}><IconTrashOutline16 size={15} /></button></div>)}</div>
    {value.length === 0 && <p className="dsh-ssh-jump-empty">{t("profile-editor.addAtLeastOneJumpHost")}</p>}
    <button type="button" className="dsh-ssh-secondary-button" disabled={value.length >= 8 || profiles.every(profile => value.includes(profile.id))} onClick={add}><IconPlusOutline16 size={15} />{t("profile-editor.addJumpHost")}</button>
  </fieldset>
}
