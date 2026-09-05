import { t, tx } from './i18n.js'
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

  return <Dialog title={tx`Delete ${profile.name}`} subtitle={profileAddress(profile)} onClose={onClose}>
    <div className="dsh-ssh-delete-profile">
      <span className="dsh-ssh-delete-profile-mark"><IconTrashOutline16 size={19} /></span>
      <div><strong>{t("This action cannot be undone")}</strong><p>{t("The connection config, this host's standalone credentials, and its port forwards are all deleted; it is also removed from every session grant. Shared credentials in the vault are not deleted.")}</p></div>
      {dependents.length > 0 && <div className="dsh-ssh-delete-profile-block" role="alert"><strong>{t("Cannot delete yet")}</strong><p>These connections still use it as an SSH jump host: {dependents.map(item => item.name).join(t(", "))}. Edit their jump chains first.</p></div>}
      {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
      <div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" data-ssh-dialog-close disabled={deleting} onClick={onClose}>{t("Cancel")}</button><button type="button" className="dsh-ssh-danger-button" disabled={deleting || dependents.length > 0} onClick={() => { void remove() }}>{deleting ? t("Deleting…") : t("Delete host")}</button></div>
    </div>
  </Dialog>
}

export function ProfileEditor({ profile, profiles, vaultEntries, proxyEntries, onClose, onSaved }: { profile?: ProfileView | undefined; profiles: ProfileView[]; vaultEntries: VaultEntryView[]; proxyEntries: ProxyEntryView[]; onClose(): void; onSaved(): void }): JSX.Element {
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
    tags: profile?.tags.join(t(", ")) ?? '',
    password: '',
    privateKey: '',
    passphrase: '',
    proxyPassword: '',
    hostFingerprint: profile?.hostFingerprint ?? '',
  }))
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testState, setTestState] = useState<'success'>()
  const [pendingFingerprint, setPendingFingerprint] = useState<string>()
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
  const groupOptions = useMemo(() => profiles.flatMap(item => item.group === undefined ? [] : [item.group]), [profiles])
  const tagOptions = useMemo(() => profiles.flatMap(item => item.tags), [profiles])
  const duplicateProfile = useMemo(() => findDuplicateProfileEndpoint(profiles, { host: form.host, port: Number(form.port) }, profile?.id), [form.host, form.port, profile?.id, profiles])
  const endpointValidationMessage = endpointTouched
    ? duplicateProfile === undefined ? endpointError : tx`This address and port are already used by “${duplicateProfile.name}” — change the host or port.`
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

  const testConnection = async (confirmedFingerprint?: string): Promise<void> => {
    setEndpointTouched(true)
    if (duplicateProfile !== undefined) { hostInputRef.current?.focus(); return }
    setTesting(true)
    setError(undefined)
    setTestState(undefined)
    setPendingFingerprint(undefined)
    try {
      await api('/profiles/test-draft', { method: 'POST', body: JSON.stringify({ ...buildPayload(confirmedFingerprint), ...(profile === undefined ? {} : { profileId: profile.id }) }) })
      if (confirmedFingerprint !== undefined) setForm(current => ({ ...current, hostFingerprint: confirmedFingerprint }))
      setTestState('success')
    } catch (reason) {
      if (reason instanceof ApiError && reason.body?.code === 'HOST_KEY_REQUIRED' && typeof reason.body.fingerprint === 'string') setPendingFingerprint(reason.body.fingerprint)
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

  return <Dialog title={profile === undefined ? t("New SSH connection") : tx`Edit ${profile.name}`} subtitle={t("Credentials are not shown again after saving")} onClose={onClose}>
    <form className="dsh-ssh-form" onSubmit={event => { void submit(event) }}>
      <div className="dsh-ssh-form-section"><div className="dsh-ssh-form-section-heading"><strong>{t("Connection info")}</strong><small>{t("Host address and display")}</small></div>
        <div className="dsh-ssh-form-grid"><Field label={t("Name")}><input required maxLength={80} placeholder={t("Dev server")} {...field('name')} /></Field><Field label={t("Group")}><SuggestionInput ariaLabel={t("Host group")} maxLength={64} options={groupOptions} placeholder={t("Select an existing group or enter a new one")} value={form.group} onChange={group => setForm(current => ({ ...current, group }))} /></Field></div>
        <div className="dsh-ssh-form-grid is-host"><Field label={t("Host")}><input ref={hostInputRef} required aria-invalid={endpointValidationMessage === undefined ? undefined : true} aria-describedby={endpointValidationMessage === undefined ? undefined : endpointErrorId} placeholder="server.example.com" spellCheck={false} {...field('host')} onBlur={() => setEndpointTouched(true)} />{endpointValidationMessage && <small id={endpointErrorId} className="dsh-ssh-field-error" role="alert">{endpointValidationMessage}</small>}</Field><Field label={t("Port")}><input required aria-invalid={endpointValidationMessage === undefined ? undefined : true} aria-describedby={endpointValidationMessage === undefined ? undefined : endpointErrorId} type="number" inputMode="numeric" min="1" max="65535" {...field('port')} onBlur={() => setEndpointTouched(true)} /></Field></div>
        <Field label={t("Tags")} hint={t("Pick existing tags or type new ones; separate multiple tags with commas.")}><SuggestionInput ariaLabel={t("Host tags")} multiple options={tagOptions} placeholder={t("Select or enter tags")} value={form.tags} onChange={tags => setForm(current => ({ ...current, tags }))} /></Field>
      </div>
      <div className="dsh-ssh-form-section"><div className="dsh-ssh-form-section-heading"><strong>{t("Authentication")}</strong><small>{t("Choose shared credentials or save separately")}</small></div>
        <Field label={t("Credential source")} hint={t("Use this connection's own credentials, or reference a common account from the key store.")}><select {...field('credentialId')}><option value="">{t("Saved separately for this connection")}</option>{vaultEntries.map(entry => <option value={entry.id} key={entry.id}>{entry.name} · {entry.username}</option>)}</select></Field>
        {selectedCredential ? <div className="dsh-ssh-credential-reference"><span><IconUserOutline16 size={16} /></span><span><strong>{selectedCredential.name}</strong><small>{selectedCredential.username} · {selectedCredential.authType === 'password' ? t("Password") : t("Private key")}</small></span><em>{selectedCredential.credential.configured ? t("Ready") : t("Missing credentials")}</em></div> : <>
          <div className="dsh-ssh-form-grid"><Field label={t("Username")}><input required autoComplete="username" {...field('username')} /></Field><Field label={t("Auth method")}><select {...field('authType')}><option value="password">{t("Password")}</option><option value="private-key">{t("Private key")}</option><option value="agent">SSH Agent</option></select></Field></div>
          {form.authType === 'password' && <Field label={t("Password")} hint={profile?.credential.source === 'profile' && profile.credential.fields.includes('password') ? t("Saved; leave blank to keep unchanged") : t("Cannot be read back after saving")}><input required={profile === undefined} type="password" autoComplete="new-password" placeholder={profile?.credential.source === 'profile' && profile.credential.fields.includes('password') ? '••••••••' : ''} {...field('password')} /></Field>}
          {form.authType === 'private-key' && <><Field label={t("Private key")} hint={profile?.credential.source === 'profile' && profile.credential.fields.includes('privateKey') ? t("Saved; leave blank to keep unchanged") : t("Paste OpenSSH/PEM private key")}><textarea required={profile === undefined} rows={5} spellCheck={false} {...field('privateKey')} /></Field><Field label={t("Key passphrase")}><input type="password" autoComplete="new-password" {...field('passphrase')} /></Field></>}
        </>}
      </div>
      <div className="dsh-ssh-form-section"><div className="dsh-ssh-form-section-heading"><strong>{t("Connection path")}</strong><small>{t("Direct, proxy, or jump chain")}</small></div>
        <Field label={t("Connection mode")}><select {...field('proxyType')}><option value="none">{t("Direct")}</option><option value="saved">{t("Common proxies")}</option><option value="http">{t("Custom HTTP CONNECT")}</option><option value="socks5">{t("Custom SOCKS5")}</option><option value="jump">{t("SSH jump host")}</option></select></Field>
        {form.proxyType === 'saved' && <Field label={t("Common proxies")} hint={proxyEntries.length === 0 ? t("Add an HTTP or SOCKS5 proxy to the proxy library first.") : t("Multiple hosts can share the same proxy configuration.")}><select required {...field('proxyEntryId')}><option value="">{t("Select proxy")}</option>{proxyEntries.map(entry => <option value={entry.id} key={entry.id}>{entry.name} · {entry.proxyType === 'http' ? 'HTTP' : 'SOCKS5'} · {entry.host}:{entry.port}</option>)}</select></Field>}
        {(form.proxyType === 'http' || form.proxyType === 'socks5') && <><div className="dsh-ssh-form-grid is-host"><Field label={t("Proxy host")}><input required spellCheck={false} {...field('proxyHost')} /></Field><Field label={t("Proxy port")}><input required type="number" inputMode="numeric" min="1" max="65535" {...field('proxyPort')} /></Field></div><div className="dsh-ssh-form-grid"><Field label={t("Proxy username")}><input autoComplete="username" {...field('proxyUsername')} /></Field><Field label={t("Proxy password")}><input type="password" autoComplete="new-password" {...field('proxyPassword')} /></Field></div></>}
        {form.proxyType === 'jump' && <JumpChainEditor profiles={profiles.filter(item => item.id !== profile?.id)} value={form.jumpProfileIds} onChange={jumpProfileIds => setForm(current => ({ ...current, jumpProfileIds }))} />}
      </div>
      {pendingFingerprint && <div className="dsh-ssh-test-result is-warning" role="alert"><span><strong>{t("First connection — verify the host fingerprint")}</strong><code>{pendingFingerprint}</code></span><button type="button" className="dsh-ssh-small-primary" disabled={testing} onClick={() => { void testConnection(pendingFingerprint) }}>{t("Confirm and retry")}</button></div>}
      {testState === 'success' && <p className="dsh-ssh-test-result is-success" role="status"><IconCheckOutline14 size={14} />{t("Connection test succeeded")}</p>}
      {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
      <div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button dsh-ssh-test-button" disabled={saving || testing} onClick={event => { if (event.currentTarget.form?.reportValidity()) void testConnection() }}>{testing ? t("Testing…") : t("Test connection")}</button><button type="button" className="dsh-ssh-secondary-button" data-ssh-dialog-close disabled={saving || testing} onClick={onClose}>{t("Cancel")}</button><button className="dsh-ssh-primary-button" disabled={saving || testing}>{saving ? t("Saving…") : t("Save connection")}</button></div>
    </form>
  </Dialog>
}

function JumpChainEditor({ profiles, value, onChange }: { profiles: ProfileView[]; value: string[]; onChange(value: string[]): void }): JSX.Element {
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

  return <fieldset className="dsh-ssh-jump-chain"><legend>{t("Jump chain")}</legend><p>{t("Connections are established hop by hop, top to bottom.")}</p>
    <div>{value.map((profileId, index) => <div className="dsh-ssh-jump-row" key={`${profileId}-${index}`}><em>{index + 1}</em><select required value={profileId} onChange={event => update(index, event.target.value)}><option value="">{t("Select an existing connection")}</option>{profiles.filter(profile => profile.id === profileId || !value.includes(profile.id)).map(profile => <option value={profile.id} key={profile.id}>{profile.name} · {profile.host}</option>)}</select><button type="button" className="dsh-ssh-icon-button" disabled={index === 0} aria-label={t("Move jump host up")} onClick={() => move(index, -1)}><IconChevronUpOutline14 size={14} /></button><button type="button" className="dsh-ssh-icon-button" disabled={index === value.length - 1} aria-label={t("Move jump host down")} onClick={() => move(index, 1)}><IconChevronDownOutline14 size={14} /></button><button type="button" className="dsh-ssh-icon-button is-danger" aria-label={t("Remove jump host")} onClick={() => onChange(value.filter((_, current) => current !== index))}><IconTrashOutline16 size={15} /></button></div>)}</div>
    {value.length === 0 && <p className="dsh-ssh-jump-empty">{t("Add at least one jump host.")}</p>}
    <button type="button" className="dsh-ssh-secondary-button" disabled={value.length >= 8 || profiles.every(profile => value.includes(profile.id))} onClick={add}><IconPlusOutline16 size={15} />{t("Add jump host")}</button>
  </fieldset>
}
