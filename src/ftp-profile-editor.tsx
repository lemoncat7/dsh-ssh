import { useState, type FormEvent } from 'react'
import {
  IconChevronLeftOutline14, IconDataOutline16, IconPlusOutline16, IconTrashOutline16, IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { api, type FtpProfileView, type ProxyEntryView, type VaultEntryView } from './client-api.js'
import { Dialog, Field, errorMessage } from './ui-components.js'

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
  return <Dialog className="dsh-ssh-ftp-manager-dialog" title="文件连接" subtitle="管理 FTP 与 FTPS；SFTP 直接复用已有 SSH 主机" onClose={onClose}>
    <div className={`dsh-ssh-ftp-manager${detailOpen ? ' has-detail' : ''}`}>
      <aside className="dsh-ssh-ftp-manager-list">
        <header><span><strong>FTP / FTPS</strong><small>{profiles.length} 个连接</small></span><button type="button" className="dsh-ssh-primary-button" onClick={create}><IconPlusOutline16 size={15} />新建</button></header>
        {profiles.length === 0 ? <div className="dsh-ssh-ftp-list-empty"><span><IconDataOutline16 size={20} /></span><strong>还没有独立文件连接</strong><p>SFTP 会显示在文件窗格的连接列表中；这里只管理 FTP 与 FTPS。</p><button type="button" className="dsh-ssh-secondary-button" onClick={create}>新建 FTPS 连接</button></div> : <div className="dsh-ssh-ftp-profile-list" role="list">{profiles.map(profile => {
          const active = (editing !== 'new' && editing?.id === profile.id) || deleting?.id === profile.id
          return <article key={profile.id} role="listitem" data-ssh-interactive="choice" aria-selected={active} className={active ? 'is-active' : ''}>
            <button type="button" className="dsh-ssh-ftp-profile-main" onClick={() => select(profile)}>
              <span className={`dsh-ssh-protocol-badge is-${profile.protocol}`}>{protocolLabel(profile.protocol)}</span>
              <span><strong title={profile.name}>{profile.name}</strong><small title={`${profile.username}@${profile.host}:${profile.port}`}>{profile.username}@{profile.host}:{profile.port}</small></span>
              <i className={profile.credential.configured ? 'is-ready' : 'is-missing'}>{profile.credential.configured ? '可用' : '缺少密码'}</i>
            </button>
            <button type="button" className="dsh-ssh-icon-button is-danger" aria-label={`删除 ${profile.name}`} onClick={() => confirmDelete(profile)}><IconTrashOutline16 size={15} /></button>
          </article>
        })}</div>}
      </aside>
      <main className="dsh-ssh-ftp-manager-detail">
        {deleting !== undefined ? <DeleteConnection profile={deleting} error={error} onBack={() => setDeleting(undefined)} onDelete={() => remove(deleting)} />
          : editing !== undefined ? <FtpProfileEditor key={editing === 'new' ? 'new' : editing.id} value={editing === 'new' ? undefined : editing} vaultEntries={vaultEntries} proxyEntries={proxyEntries} onBack={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); onChanged() }} />
            : <div className="dsh-ssh-ftp-manager-overview"><span><IconDataOutline16 size={22} /></span><h3>选择一个连接进行编辑</h3><p>文件窗格会把这里保存的 FTP、FTPS 与 SSH 主机提供的 SFTP 汇总成连接列表。</p><dl><div><dt>FTPS</dt><dd>加密控制与文件数据，默认严格校验证书</dd></div><div><dt>FTP</dt><dd>兼容旧服务器，但账号和文件内容不加密</dd></div><div><dt>SFTP</dt><dd>由 SSH 主机管理，不在这里重复配置</dd></div></dl></div>}
      </main>
    </div>
  </Dialog>
}

function DeleteConnection({ profile, error, onBack, onDelete }: { profile: FtpProfileView; error?: string | undefined; onBack(): void; onDelete(): Promise<void> }): JSX.Element {
  const [deleting, setDeleting] = useState(false)
  return <div className="dsh-ssh-ftp-delete-panel">
    <button type="button" className="dsh-ssh-ftp-detail-back" onClick={onBack}><IconChevronLeftOutline14 size={14} />返回连接列表</button>
    <span className="dsh-ssh-ftp-delete-mark"><IconWarningOutline16 size={20} /></span>
    <h3>删除“{profile.name}”？</h3>
    <p>将移除该 FTP/FTPS 连接及其独立保存的密码，不会删除远端服务器上的任何文件。</p>
    <code>{profile.username}@{profile.host}:{profile.port}</code>
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    <div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" onClick={onBack} disabled={deleting}>取消</button><button type="button" className="dsh-ssh-danger-button" disabled={deleting} onClick={() => { setDeleting(true); void onDelete().finally(() => setDeleting(false)) }}>{deleting ? '正在删除…' : '删除连接'}</button></div>
  </div>
}

function FtpProfileEditor({ value, vaultEntries, proxyEntries, onBack, onSaved }: { value?: FtpProfileView | undefined; vaultEntries: VaultEntryView[]; proxyEntries: ProxyEntryView[]; onBack(): void; onSaved(): void }): JSX.Element {
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
    event.preventDefault(); setSaving(true); setError(undefined); setTestResult(undefined)
    try { await api(value === undefined ? '/ftp-profiles' : `/ftp-profiles/${encodeURIComponent(value.id)}`, { method: value === undefined ? 'POST' : 'PUT', body: JSON.stringify(payload()) }); onSaved() }
    catch (reason) { setError(errorMessage(reason)) } finally { setSaving(false) }
  }
  const test = async (): Promise<void> => {
    setTesting(true); setError(undefined); setTestResult(undefined)
    try { await api('/ftp-profiles/test-draft', { method: 'POST', body: JSON.stringify({ ...payload(), ...(value === undefined ? {} : { profileId: value.id }) }) }); setTestResult('连接成功，初始目录可读取') }
    catch (reason) { setError(errorMessage(reason)) } finally { setTesting(false) }
  }
  const protocolChanged = (protocol: FtpProfileView['protocol']): void => setForm(current => ({ ...current, protocol, port: current.port === '21' || current.port === '990' ? String(protocol === 'ftps-implicit' ? 990 : 21) : current.port }))
  return <form className="dsh-ssh-ftp-editor-form" onSubmit={event => { void submit(event) }}>
    <header className="dsh-ssh-ftp-editor-heading"><button type="button" className="dsh-ssh-ftp-detail-back" onClick={onBack}><IconChevronLeftOutline14 size={14} />返回连接列表</button><span><strong>{value === undefined ? '新建文件连接' : value.name}</strong><small>{value === undefined ? '填写服务器和认证信息' : '修改后可先测试再保存'}</small></span></header>
    <div className="dsh-ssh-ftp-editor-scroll">
      <section className="dsh-ssh-ftp-editor-section"><div className="dsh-ssh-form-section-heading"><strong>连接类型</strong><small>优先使用 FTPS；仅在服务器不支持 TLS 时选择 FTP</small></div><div className="dsh-ssh-ftp-protocol-options" role="radiogroup" aria-label="连接协议">{([['ftps-explicit', 'FTPS', '显式 TLS · 推荐'], ['ftps-implicit', 'FTPS-I', '隐式 TLS'], ['ftp', 'FTP', '未加密']] as const).map(option => <button type="button" data-ssh-interactive="choice" role="radio" aria-checked={form.protocol === option[0]} className={form.protocol === option[0] ? 'is-active' : ''} key={option[0]} onClick={() => protocolChanged(option[0])}><span className={`dsh-ssh-protocol-badge is-${option[0]}`}>{option[1]}</span><span><strong>{option[1]}</strong><small>{option[2]}</small></span></button>)}</div>{form.protocol === 'ftp' && <p className="dsh-ssh-form-warning">普通 FTP 的账号、密码和文件内容均不加密。</p>}</section>
      <section className="dsh-ssh-ftp-editor-section"><div className="dsh-ssh-form-section-heading"><strong>服务器</strong><small>名称用于连接列表，分组用于区分环境或用途</small></div><div className="dsh-ssh-form-grid"><Field label="连接名称"><input autoFocus={value === undefined} required maxLength={80} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></Field><Field label="分组（可选）"><input maxLength={64} value={form.group} onChange={event => setForm({ ...form, group: event.target.value })} /></Field></div><div className="dsh-ssh-form-grid is-host"><Field label="服务器地址"><input required maxLength={253} spellCheck={false} value={form.host} onChange={event => setForm({ ...form, host: event.target.value })} /></Field><Field label="端口"><input required type="number" min="1" max="65535" value={form.port} onChange={event => setForm({ ...form, port: event.target.value })} /></Field></div></section>
      <section className="dsh-ssh-ftp-editor-section"><div className="dsh-ssh-form-section-heading"><strong>身份认证</strong><small>密码只写入 DSH 凭据服务，不会在界面回显</small></div><div className="dsh-ssh-form-grid"><Field label="用户名"><input required maxLength={128} autoComplete="username" value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} /></Field><Field label="凭据来源"><select value={form.credentialId} onChange={event => setForm({ ...form, credentialId: event.target.value })}><option value="">此连接单独保存密码</option>{passwordEntries.map(entry => <option key={entry.id} value={entry.id}>{entry.name} · {entry.username}</option>)}</select></Field></div>{!form.credentialId && <Field label="密码" hint={value?.credential.configured && value.credential.source === 'profile' ? '已保存；留空保持不变' : '保存后不会回显'}><input required={value === undefined || value.credential.source !== 'profile' || !value.credential.configured} type="password" autoComplete="new-password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /></Field>}</section>
      <section className="dsh-ssh-ftp-editor-section"><div className="dsh-ssh-form-section-heading"><strong>路径与网络</strong><small>代理复用 SSH 插件的代理库，控制和数据连接使用同一路径</small></div><div className="dsh-ssh-form-grid"><Field label="初始目录"><input required maxLength={4096} spellCheck={false} value={form.initialPath} onChange={event => setForm({ ...form, initialPath: event.target.value })} /></Field><Field label="连接代理"><select value={form.proxyId} onChange={event => setForm({ ...form, proxyId: event.target.value })}><option value="">直连</option>{proxyEntries.map(entry => <option key={entry.id} value={entry.id}>{entry.name} · {entry.proxyType.toUpperCase()}</option>)}</select></Field></div><details className="dsh-ssh-form-advanced"><summary>高级连接设置</summary><div className="dsh-ssh-form-grid"><Field label="连接超时（毫秒）"><input required type="number" min="1000" max="120000" step="1000" value={form.connectTimeoutMs} onChange={event => setForm({ ...form, connectTimeoutMs: event.target.value })} /></Field><Field label="TLS 服务器名称" hint="证书名称与主机不同时填写"><input maxLength={253} spellCheck={false} value={form.tlsServerName} onChange={event => setForm({ ...form, tlsServerName: event.target.value })} /></Field></div></details></section>
      {testResult && <p className="dsh-ssh-inline-success" role="status">{testResult}</p>}{error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
    </div>
    <footer className="dsh-ssh-ftp-editor-actions"><button type="button" className="dsh-ssh-secondary-button" onClick={() => { void test() }} disabled={testing || saving}>{testing ? '正在测试…' : '测试连接'}</button><span /><button type="button" className="dsh-ssh-secondary-button" onClick={onBack} disabled={saving || testing}>取消</button><button type="submit" className="dsh-ssh-primary-button" disabled={saving || testing}>{saving ? '正在保存…' : '保存连接'}</button></footer>
  </form>
}

function protocolLabel(protocol: FtpProfileView['protocol']): string { return protocol === 'ftp' ? 'FTP' : protocol === 'ftps-explicit' ? 'FTPS' : 'FTPS-I' }
