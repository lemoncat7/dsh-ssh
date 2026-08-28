import { useState, type FormEvent } from 'react'
import { IconEditOutline16, IconPlusOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { api, type FtpProfileView, type ProxyEntryView, type VaultEntryView } from './client-api.js'
import { Dialog, Field, errorMessage } from './ui-components.js'

export function FtpConnectionsDialog({ profiles, vaultEntries, proxyEntries, onClose, onChanged }: { profiles: FtpProfileView[]; vaultEntries: VaultEntryView[]; proxyEntries: ProxyEntryView[]; onClose(): void; onChanged(): void }): JSX.Element {
  const [editing, setEditing] = useState<FtpProfileView | 'new'>()
  const [error, setError] = useState<string>()
  const remove = async (profile: FtpProfileView): Promise<void> => {
    if (!window.confirm(`删除文件连接“${profile.name}”？`)) return
    try { await api(`/ftp-profiles/${encodeURIComponent(profile.id)}`, { method: 'DELETE' }); onChanged() }
    catch (reason) { setError(errorMessage(reason)) }
  }
  if (editing !== undefined) return <FtpProfileEditor value={editing === 'new' ? undefined : editing} vaultEntries={vaultEntries} proxyEntries={proxyEntries} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); onChanged() }} />
  return <Dialog className="dsh-ssh-ftp-connections-dialog" title="FTP 与 FTPS 连接" subtitle="SFTP 连接直接复用已有 SSH 主机" onClose={onClose}>
    <div className="dsh-ssh-transfer-dialog-toolbar"><span>{profiles.length} 个独立文件连接</span><button type="button" className="dsh-ssh-primary-button" onClick={() => setEditing('new')}><IconPlusOutline16 size={16} />新建连接</button></div>
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    <div className="dsh-ssh-ftp-profile-list">{profiles.length === 0 ? <div className="dsh-ssh-table-empty">还没有 FTP 或 FTPS 连接。</div> : profiles.map(profile => <article key={profile.id}>
      <span className={`dsh-ssh-protocol-badge is-${profile.protocol}`}>{protocolLabel(profile.protocol)}</span>
      <span><strong>{profile.name}</strong><small>{profile.username}@{profile.host}:{profile.port}</small></span>
      <span className={profile.credential.configured ? 'is-ready' : 'is-missing'}>{profile.credential.configured ? '可连接' : '缺少密码'}</span>
      <button type="button" className="dsh-ssh-icon-button" aria-label={`编辑 ${profile.name}`} onClick={() => setEditing(profile)}><IconEditOutline16 size={16} /></button>
      <button type="button" className="dsh-ssh-icon-button is-danger" aria-label={`删除 ${profile.name}`} onClick={() => { void remove(profile) }}><IconTrashOutline16 size={16} /></button>
    </article>)}</div>
  </Dialog>
}

function FtpProfileEditor({ value, vaultEntries, proxyEntries, onClose, onSaved }: { value?: FtpProfileView | undefined; vaultEntries: VaultEntryView[]; proxyEntries: ProxyEntryView[]; onClose(): void; onSaved(): void }): JSX.Element {
  const passwordEntries = vaultEntries.filter(entry => entry.authType === 'password')
  const [form, setForm] = useState({
    name: value?.name ?? '', group: value?.group ?? '', protocol: value?.protocol ?? 'ftps-explicit' as FtpProfileView['protocol'],
    host: value?.host ?? '', port: String(value?.port ?? 21), username: value?.username ?? '', credentialId: value?.credentialId ?? '', password: '',
    proxyId: value?.proxy.type === 'saved' ? value.proxy.proxyId : '', initialPath: value?.initialPath ?? '/', connectTimeoutMs: String(value?.connectTimeoutMs ?? 15_000), tlsServerName: value?.tlsServerName ?? '',
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
    }, secrets: { password: form.password },
  })
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); setSaving(true); setError(undefined)
    try { await api(value === undefined ? '/ftp-profiles' : `/ftp-profiles/${encodeURIComponent(value.id)}`, { method: value === undefined ? 'POST' : 'PUT', body: JSON.stringify(payload()) }); onSaved() }
    catch (reason) { setError(errorMessage(reason)) } finally { setSaving(false) }
  }
  const test = async (): Promise<void> => {
    setTesting(true); setError(undefined); setTestResult(undefined)
    try { await api('/ftp-profiles/test-draft', { method: 'POST', body: JSON.stringify({ ...payload(), ...(value === undefined ? {} : { profileId: value.id }) }) }); setTestResult('连接与目录读取正常') }
    catch (reason) { setError(errorMessage(reason)) } finally { setTesting(false) }
  }
  const protocolChanged = (protocol: FtpProfileView['protocol']): void => setForm(current => ({ ...current, protocol, port: current.port === '21' || current.port === '990' ? String(protocol === 'ftps-implicit' ? 990 : 21) : current.port }))
  return <Dialog className="dsh-ssh-ftp-editor" title={value === undefined ? '新建文件连接' : `编辑 ${value.name}`} subtitle="FTP 使用被动模式；FTPS 默认严格校验证书" onClose={onClose}><form className="dsh-ssh-form" onSubmit={event => { void submit(event) }}>
    <div className="dsh-ssh-form-grid"><Field label="连接名称"><input required maxLength={80} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></Field><Field label="分组"><input maxLength={64} value={form.group} onChange={event => setForm({ ...form, group: event.target.value })} /></Field></div>
    <Field label="协议"><select value={form.protocol} onChange={event => protocolChanged(event.target.value as FtpProfileView['protocol'])}><option value="ftps-explicit">FTPS（显式 TLS，推荐）</option><option value="ftps-implicit">FTPS（隐式 TLS）</option><option value="ftp">FTP（未加密）</option></select></Field>
    {form.protocol === 'ftp' && <p className="dsh-ssh-form-warning">普通 FTP 的账号、密码和文件内容均不加密。</p>}
    <div className="dsh-ssh-form-grid is-host"><Field label="服务器"><input required maxLength={253} value={form.host} onChange={event => setForm({ ...form, host: event.target.value })} /></Field><Field label="端口"><input required type="number" min="1" max="65535" value={form.port} onChange={event => setForm({ ...form, port: event.target.value })} /></Field></div>
    <div className="dsh-ssh-form-grid"><Field label="用户名"><input required maxLength={128} autoComplete="username" value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} /></Field><Field label="凭据来源"><select value={form.credentialId} onChange={event => setForm({ ...form, credentialId: event.target.value })}><option value="">此连接单独保存密码</option>{passwordEntries.map(entry => <option key={entry.id} value={entry.id}>{entry.name} · {entry.username}</option>)}</select></Field></div>
    {!form.credentialId && <Field label="密码" hint={value?.credential.configured ? '已保存；留空保持不变' : '保存至 DSH 凭据服务，不会回显'}><input required={value === undefined || !value.credential.configured} type="password" autoComplete="new-password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /></Field>}
    <div className="dsh-ssh-form-grid"><Field label="连接代理"><select value={form.proxyId} onChange={event => setForm({ ...form, proxyId: event.target.value })}><option value="">直连</option>{proxyEntries.map(entry => <option key={entry.id} value={entry.id}>{entry.name} · {entry.proxyType.toUpperCase()}</option>)}</select></Field><Field label="初始目录"><input required maxLength={4096} value={form.initialPath} onChange={event => setForm({ ...form, initialPath: event.target.value })} /></Field></div>
    <details className="dsh-ssh-form-advanced"><summary>高级连接设置</summary><div className="dsh-ssh-form-grid"><Field label="连接超时（毫秒）"><input required type="number" min="1000" max="120000" step="1000" value={form.connectTimeoutMs} onChange={event => setForm({ ...form, connectTimeoutMs: event.target.value })} /></Field><Field label="TLS 服务器名称" hint="通常留空，仅证书名称与主机不同才填写"><input maxLength={253} value={form.tlsServerName} onChange={event => setForm({ ...form, tlsServerName: event.target.value })} /></Field></div></details>
    {testResult && <p className="dsh-ssh-inline-success" role="status">{testResult}</p>}{error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    <div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" onClick={() => { void test() }} disabled={testing || saving}>{testing ? '正在测试…' : '测试连接'}</button><span /><button type="button" className="dsh-ssh-secondary-button" onClick={onClose}>取消</button><button className="dsh-ssh-primary-button" disabled={saving || testing}>{saving ? '正在保存…' : '保存连接'}</button></div>
  </form></Dialog>
}

function protocolLabel(protocol: FtpProfileView['protocol']): string { return protocol === 'ftp' ? 'FTP' : protocol === 'ftps-explicit' ? 'FTPS' : 'FTPS-I' }
