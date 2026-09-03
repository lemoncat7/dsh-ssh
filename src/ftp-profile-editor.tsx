import { useMemo, useState, type FormEvent } from 'react'
import {
  IconChevronLeftOutline14, IconDataOutline16, IconPlusOutline16, IconTrashOutline16, IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { api, type FtpProfileView, type ProxyEntryView, type VaultEntryView } from './client-api.js'
import { Dialog, Field, SuggestionInput, errorMessage } from './ui-components.js'

type EditorTarget = FtpProfileView | 'new'

export function FtpConnectionsDialog({ profiles, vaultEntries, proxyEntries, onClose, onChanged }: { profiles: FtpProfileView[]; vaultEntries: VaultEntryView[]; proxyEntries: ProxyEntryView[]; onClose(): void; onChanged(): void }): JSX.Element {
  const [editing, setEditing] = useState<EditorTarget>()
  const [deleting, setDeleting] = useState<FtpProfileView>()
  const [error, setError] = useState<string>()
  const detailOpen = editing !== undefined || deleting !== undefined
  const select = (profile: FtpProfileView): void => { setDeleting(undefined); setEditing(profile); setError(undefined) }
  const create = (): void => { setDeleting(undefined); setEditing('new'); setError(undefined) }
  const confirmDelete = (profile: FtpProfileView): void => { setEditing(undefined); setDeleting(profile); setError(undefined) }
  const remove = async (profile: FtpProfileView): Promise<void> => {
    setError(undefined)
    try { await api(`/ftp-profiles/${encodeURIComponent(profile.id)}`, { method: 'DELETE' }); setDeleting(undefined); onChanged() }
    catch (reason) { setError(errorMessage(reason)) }
  }
  return <Dialog className="dsh-ssh-ftp-manager-dialog" title="File connections" subtitle="Manage FTP and FTPS; SFTP reuses existing SSH hosts directly" onClose={onClose}>
    <div className={`dsh-ssh-ftp-manager${detailOpen ? ' has-detail' : ''}`}>
      <aside className="dsh-ssh-ftp-manager-list">
        <header><span><strong>FTP / FTPS</strong><small>{profiles.length} connections</small></span><button type="button" className="dsh-ssh-primary-button" onClick={create}><IconPlusOutline16 size={15} />New</button></header>
        {profiles.length === 0 ? <div className="dsh-ssh-ftp-list-empty"><span><IconDataOutline16 size={20} /></span><strong>No standalone file connections yet</strong><p>SFTP appears in the file pane's connection list; only FTP and FTPS are managed here.</p><button type="button" className="dsh-ssh-secondary-button" onClick={create}>New FTPS connection</button></div> : <div className="dsh-ssh-ftp-profile-list" role="list">{profiles.map(profile => {
          const active = (editing !== 'new' && editing?.id === profile.id) || deleting?.id === profile.id
          return <article key={profile.id} role="listitem" data-ssh-interactive="choice" aria-selected={active} className={active ? 'is-active' : ''}>
            <button type="button" className="dsh-ssh-ftp-profile-main" onClick={() => select(profile)}>
              <span className={`dsh-ssh-protocol-badge is-${profile.protocol}`}>{protocolLabel(profile.protocol)}</span>
              <span><strong title={profile.name}>{profile.name}</strong><small title={`${profile.username}@${profile.host}:${profile.port}`}>{profile.username}@{profile.host}:{profile.port}</small></span>
              <i className={profile.credential.configured ? 'is-ready' : 'is-missing'}>{profile.credential.configured ? "Available" : "Missing password"}</i>
            </button>
            <button type="button" className="dsh-ssh-icon-button is-danger" aria-label={`Delete ${profile.name}`} onClick={() => confirmDelete(profile)}><IconTrashOutline16 size={15} /></button>
          </article>
        })}</div>}
      </aside>
      <main className="dsh-ssh-ftp-manager-detail">
        {deleting !== undefined ? <DeleteConnection profile={deleting} error={error} onBack={() => setDeleting(undefined)} onDelete={() => remove(deleting)} />
          : editing !== undefined ? <FtpProfileEditor key={editing === 'new' ? 'new' : editing.id} value={editing === 'new' ? undefined : editing} profiles={profiles} vaultEntries={vaultEntries} proxyEntries={proxyEntries} onBack={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); onChanged() }} />
            : <div className="dsh-ssh-ftp-manager-overview"><span><IconDataOutline16 size={22} /></span><h3>Select a connection to edit</h3><p>The file pane combines FTP, FTPS, and SFTP from SSH hosts saved here into one connection list.</p><dl><div><dt>FTPS</dt><dd>Encrypts control and file data; certificates strictly validated by default</dd></div><div><dt>FTP</dt><dd>Compatible with legacy servers, but accounts and file content are unencrypted</dd></div><div><dt>SFTP</dt><dd>Managed by SSH hosts; no need to configure it again here</dd></div></dl></div>}
      </main>
    </div>
  </Dialog>
}

function DeleteConnection({ profile, error, onBack, onDelete }: { profile: FtpProfileView; error?: string | undefined; onBack(): void; onDelete(): Promise<void> }): JSX.Element {
  const [deleting, setDeleting] = useState(false)
  return <div className="dsh-ssh-ftp-delete-panel">
    <button type="button" className="dsh-ssh-ftp-detail-back" onClick={onBack}><IconChevronLeftOutline14 size={14} />Back to connection list</button>
    <span className="dsh-ssh-ftp-delete-mark"><IconWarningOutline16 size={20} /></span>
    <h3>Delete “{profile.name}”? </h3>
    <p>This removes the FTP/FTPS connection and its separately saved password. No files on the remote server will be deleted.</p>
    <code>{profile.username}@{profile.host}:{profile.port}</code>
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    <div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" onClick={onBack} disabled={deleting}>Cancel</button><button type="button" className="dsh-ssh-danger-button" disabled={deleting} onClick={() => { setDeleting(true); void onDelete().finally(() => setDeleting(false)) }}>{deleting ? "Deleting…" : "Delete connection"}</button></div>
  </div>
}

function FtpProfileEditor({ value, profiles, vaultEntries, proxyEntries, onBack, onSaved }: { value?: FtpProfileView | undefined; profiles: FtpProfileView[]; vaultEntries: VaultEntryView[]; proxyEntries: ProxyEntryView[]; onBack(): void; onSaved(): void }): JSX.Element {
  const passwordEntries = vaultEntries.filter(entry => entry.authType === 'password')
  const [form, setForm] = useState({
    name: value?.name ?? '', group: value?.group ?? '', protocol: value?.protocol ?? 'ftps-explicit' as FtpProfileView['protocol'],
    host: value?.host ?? '', port: String(value?.port ?? 21), username: value?.username ?? '', credentialId: value?.credentialId ?? '', password: '',
    proxyId: value?.proxy.type === 'saved' ? value.proxy.proxyId : '', initialPath: value?.initialPath ?? '/', connectTimeoutMs: String(value?.connectTimeoutMs ?? 15_000), tlsServerName: value?.tlsServerName ?? '', tags: value?.tags.join(', ') ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string>()
  const [error, setError] = useState<string>()
  const payload = () => ({
    profile: {
      name: form.name, ...(form.group.trim() ? { group: form.group.trim() } : {}), protocol: form.protocol, host: form.host, port: Number(form.port), username: form.username,
      ...(form.credentialId ? { credentialId: form.credentialId } : {}), proxy: form.proxyId ? { type: 'saved', proxyId: form.proxyId } : { type: 'none' },
      initialPath: form.initialPath, connectTimeoutMs: Number(form.connectTimeoutMs), ...(form.tlsServerName.trim() ? { tlsServerName: form.tlsServerName.trim() } : {}),
      tags: form.tags.split(/[,，]/u).map(item => item.trim()).filter(Boolean),
    }, secrets: { password: form.password },
  })
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); setSaving(true); setError(undefined); setTestResult(undefined)
    try { await api(value === undefined ? '/ftp-profiles' : `/ftp-profiles/${encodeURIComponent(value.id)}`, { method: value === undefined ? 'POST' : 'PUT', body: JSON.stringify(payload()) }); onSaved() }
    catch (reason) { setError(errorMessage(reason)) } finally { setSaving(false) }
  }
  const test = async (): Promise<void> => {
    setTesting(true); setError(undefined); setTestResult(undefined)
    try { await api('/ftp-profiles/test-draft', { method: 'POST', body: JSON.stringify({ ...payload(), ...(value === undefined ? {} : { profileId: value.id }) }) }); setTestResult("Connected; initial directory is readable") }
    catch (reason) { setError(errorMessage(reason)) } finally { setTesting(false) }
  }
  const protocolChanged = (protocol: FtpProfileView['protocol']): void => setForm(current => ({ ...current, protocol, port: current.port === '21' || current.port === '990' ? String(protocol === 'ftps-implicit' ? 990 : 21) : current.port }))
  const groupOptions = useMemo(() => profiles.flatMap(item => item.group === undefined ? [] : [item.group]), [profiles])
  const tagOptions = useMemo(() => profiles.flatMap(item => item.tags), [profiles])
  return <form className="dsh-ssh-ftp-editor-form" onSubmit={event => { void submit(event) }}>
    <header className="dsh-ssh-ftp-editor-heading"><button type="button" className="dsh-ssh-ftp-detail-back" onClick={onBack}><IconChevronLeftOutline14 size={14} />Back to connection list</button><span><strong>{value === undefined ? "New file connection" : value.name}</strong><small>{value === undefined ? "Enter server and authentication details" : "After edits, test before saving"}</small></span></header>
    <div className="dsh-ssh-ftp-editor-scroll">
      <section className="dsh-ssh-ftp-editor-section"><div className="dsh-ssh-form-section-heading"><strong>Connection type</strong><small>Prefer FTPS; choose FTP only when the server lacks TLS support</small></div><div className="dsh-ssh-ftp-protocol-options" role="radiogroup" aria-label="Connection protocol">{([['ftps-explicit', 'FTPS', "Explicit TLS · recommended"], ['ftps-implicit', 'FTPS-I', "Implicit TLS"], ['ftp', 'FTP', "Unencrypted"]] as const).map(option => <button type="button" data-ssh-interactive="choice" role="radio" aria-checked={form.protocol === option[0]} className={form.protocol === option[0] ? 'is-active' : ''} key={option[0]} onClick={() => protocolChanged(option[0])}><span className={`dsh-ssh-protocol-badge is-${option[0]}`}>{option[1]}</span><span><strong>{option[1]}</strong><small>{option[2]}</small></span></button>)}</div>{form.protocol === 'ftp' && <p className="dsh-ssh-form-warning">Plain FTP sends your account, password, and file content unencrypted.</p>}</section>
      <section className="dsh-ssh-ftp-editor-section"><div className="dsh-ssh-form-section-heading"><strong>Server</strong><small>The name appears in the connection list; groups and tags can reuse existing options</small></div><div className="dsh-ssh-form-grid"><Field label="Connection name"><input autoFocus={value === undefined} required maxLength={80} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></Field><Field label="Group (optional)"><SuggestionInput ariaLabel="FTP groups" maxLength={64} options={groupOptions} placeholder="Select an existing group or enter a new one" value={form.group} onChange={group => setForm(current => ({ ...current, group }))} /></Field></div><div className="dsh-ssh-form-grid is-host"><Field label="Server address"><input required maxLength={253} spellCheck={false} value={form.host} onChange={event => setForm({ ...form, host: event.target.value })} /></Field><Field label="Port"><input required type="number" min="1" max="65535" value={form.port} onChange={event => setForm({ ...form, port: event.target.value })} /></Field></div><Field label="Tags (optional)" hint="Pick existing tags or type new ones; separate multiple tags with commas."><SuggestionInput ariaLabel="FTP tags" multiple options={tagOptions} placeholder="Select or enter tags" value={form.tags} onChange={tags => setForm(current => ({ ...current, tags }))} /></Field></section>
      <section className="dsh-ssh-ftp-editor-section"><div className="dsh-ssh-form-section-heading"><strong>Authentication</strong><small>The password is written only to the DSH credential service and never echoed in the UI</small></div><div className="dsh-ssh-form-grid"><Field label="Username"><input required maxLength={128} autoComplete="username" value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} /></Field><Field label="Credential source"><select value={form.credentialId} onChange={event => setForm({ ...form, credentialId: event.target.value })}><option value="">Save password for this connection only</option>{passwordEntries.map(entry => <option key={entry.id} value={entry.id}>{entry.name} · {entry.username}</option>)}</select></Field></div>{!form.credentialId && <Field label="Password" hint={value?.credential.configured && value.credential.source === 'profile' ? "Saved; leave blank to keep unchanged" : "Not echoed after saving"}><input required={value === undefined || value.credential.source !== 'profile' || !value.credential.configured} type="password" autoComplete="new-password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /></Field>}</section>
      <section className="dsh-ssh-ftp-editor-section"><div className="dsh-ssh-form-section-heading"><strong>Path and network</strong><small>Proxies reuse the SSH plugin's proxy vault; control and data connections take the same path</small></div><div className="dsh-ssh-form-grid"><Field label="Initial directory"><input required maxLength={4096} spellCheck={false} value={form.initialPath} onChange={event => setForm({ ...form, initialPath: event.target.value })} /></Field><Field label="Connection proxy"><select value={form.proxyId} onChange={event => setForm({ ...form, proxyId: event.target.value })}><option value="">Direct</option>{proxyEntries.map(entry => <option key={entry.id} value={entry.id}>{entry.name} · {entry.proxyType.toUpperCase()}</option>)}</select></Field></div><details className="dsh-ssh-form-advanced"><summary>Advanced connection settings</summary><div className="dsh-ssh-form-grid"><Field label="Connection timeout (ms)"><input required type="number" min="1000" max="120000" step="1000" value={form.connectTimeoutMs} onChange={event => setForm({ ...form, connectTimeoutMs: event.target.value })} /></Field><Field label="TLS server name" hint="Fill in when the certificate name differs from the host"><input maxLength={253} spellCheck={false} value={form.tlsServerName} onChange={event => setForm({ ...form, tlsServerName: event.target.value })} /></Field></div></details></section>
      {testResult && <p className="dsh-ssh-inline-success" role="status">{testResult}</p>}{error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    </div>
    <footer className="dsh-ssh-ftp-editor-actions"><button type="button" className="dsh-ssh-secondary-button" onClick={() => { void test() }} disabled={testing || saving}>{testing ? "Testing…" : "Test connection"}</button><span /><button type="button" className="dsh-ssh-secondary-button" onClick={onBack} disabled={saving || testing}>Cancel</button><button type="submit" className="dsh-ssh-primary-button" disabled={saving || testing}>{saving ? "Saving…" : "Save connection"}</button></footer>
  </form>
}

function protocolLabel(protocol: FtpProfileView['protocol']): string { return protocol === 'ftp' ? 'FTP' : protocol === 'ftps-explicit' ? 'FTPS' : 'FTPS-I' }
