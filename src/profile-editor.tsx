import { useMemo, useState, type FormEvent } from 'react'
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

  return <Dialog title={`Delete ${profile.name}`} subtitle={profileAddress(profile)} onClose={onClose}>
    <div className="dsh-ssh-delete-profile">
      <span className="dsh-ssh-delete-profile-mark"><IconTrashOutline16 size={19} /></span>
      <div><strong>This action cannot be undone</strong><p>The connection config, this host's standalone credentials, and its port forwards are all deleted; it is also removed from every session grant. Shared credentials in the vault are not deleted.</p></div>
      {dependents.length > 0 && <div className="dsh-ssh-delete-profile-block" role="alert"><strong>Cannot delete yet</strong><p>These connections still use it as an SSH jump host: {dependents.map(item => item.name).join(", ")}. Edit their jump chains first.</p></div>}
      {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
      <div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" data-ssh-dialog-close disabled={deleting} onClick={onClose}>Cancel</button><button type="button" className="dsh-ssh-danger-button" disabled={deleting || dependents.length > 0} onClick={() => { void remove() }}>{deleting ? "Deleting…" : "Delete host"}</button></div>
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
  const [pendingFingerprint, setPendingFingerprint] = useState<string>()
  const [error, setError] = useState<string>()

  const field = (name: Exclude<keyof typeof form, 'jumpProfileIds'>) => ({
    value: form[name],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setForm(value => ({ ...value, [name]: event.target.value }))
      setTestState(undefined)
      setPendingFingerprint(undefined)
    },
  })
  const selectedCredential = vaultEntries.find(entry => entry.id === form.credentialId)
  const groupOptions = useMemo(() => profiles.flatMap(item => item.group === undefined ? [] : [item.group]), [profiles])
  const tagOptions = useMemo(() => profiles.flatMap(item => item.tags), [profiles])
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
      else setError(errorMessage(reason))
    } finally {
      setTesting(false)
    }
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSaving(true)
    setError(undefined)
    try {
      await api(profile === undefined ? '/profiles' : `/profiles/${profile.id}`, { method: profile === undefined ? 'POST' : 'PUT', body: JSON.stringify(buildPayload()) })
      onSaved()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  return <Dialog title={profile === undefined ? "New SSH connection" : `Edit ${profile.name}`} subtitle="Credentials are not shown again after saving" onClose={onClose}>
    <form className="dsh-ssh-form" onSubmit={event => { void submit(event) }}>
      <div className="dsh-ssh-form-section"><div className="dsh-ssh-form-section-heading"><strong>Connection info</strong><small>Host address and display</small></div>
        <div className="dsh-ssh-form-grid"><Field label="Name"><input required maxLength={80} placeholder="Dev server" {...field('name')} /></Field><Field label="Group"><SuggestionInput ariaLabel="Host group" maxLength={64} options={groupOptions} placeholder="Select an existing group or enter a new one" value={form.group} onChange={group => setForm(current => ({ ...current, group }))} /></Field></div>
        <div className="dsh-ssh-form-grid is-host"><Field label="Host"><input required placeholder="server.example.com" spellCheck={false} {...field('host')} /></Field><Field label="Port"><input required type="number" inputMode="numeric" min="1" max="65535" {...field('port')} /></Field></div>
        <Field label="Tags" hint="Pick existing tags or type new ones; separate multiple tags with commas."><SuggestionInput ariaLabel="Host tags" multiple options={tagOptions} placeholder="Select or enter tags" value={form.tags} onChange={tags => setForm(current => ({ ...current, tags }))} /></Field>
      </div>
      <div className="dsh-ssh-form-section"><div className="dsh-ssh-form-section-heading"><strong>Authentication</strong><small>Choose shared credentials or save separately</small></div>
        <Field label="Credential source" hint="Use this connection's own credentials, or reference a common account from the key store."><select {...field('credentialId')}><option value="">Saved separately for this connection</option>{vaultEntries.map(entry => <option value={entry.id} key={entry.id}>{entry.name} · {entry.username}</option>)}</select></Field>
        {selectedCredential ? <div className="dsh-ssh-credential-reference"><span><IconUserOutline16 size={16} /></span><span><strong>{selectedCredential.name}</strong><small>{selectedCredential.username} · {selectedCredential.authType === 'password' ? "Password" : "Private key"}</small></span><em>{selectedCredential.credential.configured ? "Ready" : "Missing credentials"}</em></div> : <>
          <div className="dsh-ssh-form-grid"><Field label="Username"><input required autoComplete="username" {...field('username')} /></Field><Field label="Auth method"><select {...field('authType')}><option value="password">Password</option><option value="private-key">Private key</option><option value="agent">SSH Agent</option></select></Field></div>
          {form.authType === 'password' && <Field label="Password" hint={profile?.credential.source === 'profile' && profile.credential.fields.includes('password') ? "Saved; leave blank to keep unchanged" : "Cannot be read back after saving"}><input required={profile === undefined} type="password" autoComplete="new-password" placeholder={profile?.credential.source === 'profile' && profile.credential.fields.includes('password') ? '••••••••' : ''} {...field('password')} /></Field>}
          {form.authType === 'private-key' && <><Field label="Private key" hint={profile?.credential.source === 'profile' && profile.credential.fields.includes('privateKey') ? "Saved; leave blank to keep unchanged" : "Paste OpenSSH/PEM private key"}><textarea required={profile === undefined} rows={5} spellCheck={false} {...field('privateKey')} /></Field><Field label="Key passphrase"><input type="password" autoComplete="new-password" {...field('passphrase')} /></Field></>}
        </>}
      </div>
      <div className="dsh-ssh-form-section"><div className="dsh-ssh-form-section-heading"><strong>Connection path</strong><small>Direct, proxy, or jump chain</small></div>
        <Field label="Connection mode"><select {...field('proxyType')}><option value="none">Direct</option><option value="saved">Common proxies</option><option value="http">Custom HTTP CONNECT</option><option value="socks5">Custom SOCKS5</option><option value="jump">SSH jump host</option></select></Field>
        {form.proxyType === 'saved' && <Field label="Common proxies" hint={proxyEntries.length === 0 ? "Add an HTTP or SOCKS5 proxy to the proxy library first." : "Multiple hosts can share the same proxy configuration."}><select required {...field('proxyEntryId')}><option value="">Select proxy</option>{proxyEntries.map(entry => <option value={entry.id} key={entry.id}>{entry.name} · {entry.proxyType === 'http' ? 'HTTP' : 'SOCKS5'} · {entry.host}:{entry.port}</option>)}</select></Field>}
        {(form.proxyType === 'http' || form.proxyType === 'socks5') && <><div className="dsh-ssh-form-grid is-host"><Field label="Proxy host"><input required spellCheck={false} {...field('proxyHost')} /></Field><Field label="Proxy port"><input required type="number" inputMode="numeric" min="1" max="65535" {...field('proxyPort')} /></Field></div><div className="dsh-ssh-form-grid"><Field label="Proxy username"><input autoComplete="username" {...field('proxyUsername')} /></Field><Field label="Proxy password"><input type="password" autoComplete="new-password" {...field('proxyPassword')} /></Field></div></>}
        {form.proxyType === 'jump' && <JumpChainEditor profiles={profiles.filter(item => item.id !== profile?.id)} value={form.jumpProfileIds} onChange={jumpProfileIds => setForm(current => ({ ...current, jumpProfileIds }))} />}
      </div>
      {pendingFingerprint && <div className="dsh-ssh-test-result is-warning" role="alert"><span><strong>First connection — verify the host fingerprint</strong><code>{pendingFingerprint}</code></span><button type="button" className="dsh-ssh-small-primary" disabled={testing} onClick={() => { void testConnection(pendingFingerprint) }}>Confirm and retry</button></div>}
      {testState === 'success' && <p className="dsh-ssh-test-result is-success" role="status"><IconCheckOutline14 size={14} />Connection test succeeded</p>}
      {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
      <div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button dsh-ssh-test-button" disabled={saving || testing} onClick={event => { if (event.currentTarget.form?.reportValidity()) void testConnection() }}>{testing ? "Testing…" : "Test connection"}</button><button type="button" className="dsh-ssh-secondary-button" data-ssh-dialog-close disabled={saving || testing} onClick={onClose}>Cancel</button><button className="dsh-ssh-primary-button" disabled={saving || testing}>{saving ? "Saving…" : "Save connection"}</button></div>
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

  return <fieldset className="dsh-ssh-jump-chain"><legend>Jump chain</legend><p>Connections are established hop by hop, top to bottom.</p>
    <div>{value.map((profileId, index) => <div className="dsh-ssh-jump-row" key={`${profileId}-${index}`}><em>{index + 1}</em><select required value={profileId} onChange={event => update(index, event.target.value)}><option value="">Select an existing connection</option>{profiles.filter(profile => profile.id === profileId || !value.includes(profile.id)).map(profile => <option value={profile.id} key={profile.id}>{profile.name} · {profile.host}</option>)}</select><button type="button" className="dsh-ssh-icon-button" disabled={index === 0} aria-label="Move jump host up" onClick={() => move(index, -1)}><IconChevronUpOutline14 size={14} /></button><button type="button" className="dsh-ssh-icon-button" disabled={index === value.length - 1} aria-label="Move jump host down" onClick={() => move(index, 1)}><IconChevronDownOutline14 size={14} /></button><button type="button" className="dsh-ssh-icon-button is-danger" aria-label="Remove jump host" onClick={() => onChange(value.filter((_, current) => current !== index))}><IconTrashOutline16 size={15} /></button></div>)}</div>
    {value.length === 0 && <p className="dsh-ssh-jump-empty">Add at least one jump host.</p>}
    <button type="button" className="dsh-ssh-secondary-button" disabled={value.length >= 8 || profiles.every(profile => value.includes(profile.id))} onClick={add}><IconPlusOutline16 size={15} />Add jump host</button>
  </fieldset>
}
