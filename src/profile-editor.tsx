import { useState, type FormEvent } from 'react'
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
import { Dialog, Field, errorMessage } from './ui-components.js'

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

  return <Dialog title={`删除 ${profile.name}`} subtitle={profileAddress(profile)} onClose={onClose}>
    <div className="dsh-ssh-delete-profile">
      <span className="dsh-ssh-delete-profile-mark"><IconTrashOutline16 size={19} /></span>
      <div><strong>这个操作无法撤销</strong><p>连接配置、该主机的独立凭据和关联端口转发会一并删除；它也会从所有会话授权中移除。密钥库中的共享凭据不会删除。</p></div>
      {dependents.length > 0 && <div className="dsh-ssh-delete-profile-block" role="alert"><strong>暂时不能删除</strong><p>以下连接仍将它作为 SSH 跳板：{dependents.map(item => item.name).join('、')}。请先修改这些连接的跳板链。</p></div>}
      {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
      <div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" disabled={deleting} onClick={onClose}>取消</button><button type="button" className="dsh-ssh-danger-button" disabled={deleting || dependents.length > 0} onClick={() => { void remove() }}>{deleting ? '正在删除…' : '删除主机'}</button></div>
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

  return <Dialog title={profile === undefined ? '新建 SSH 连接' : `编辑 ${profile.name}`} subtitle="凭据保存后不会回显" onClose={onClose}>
    <form className="dsh-ssh-form" onSubmit={event => { void submit(event) }}>
      <div className="dsh-ssh-form-section"><div className="dsh-ssh-form-section-heading"><strong>连接信息</strong><small>主机地址与显示方式</small></div>
        <div className="dsh-ssh-form-grid"><Field label="名称"><input required maxLength={80} placeholder="开发服务器" {...field('name')} /></Field><Field label="分组"><input maxLength={64} placeholder="例如：生产环境" {...field('group')} /></Field></div>
        <div className="dsh-ssh-form-grid is-host"><Field label="主机"><input required placeholder="server.example.com" spellCheck={false} {...field('host')} /></Field><Field label="端口"><input required type="number" inputMode="numeric" min="1" max="65535" {...field('port')} /></Field></div>
        <Field label="标签" hint="多个标签使用英文逗号分隔。"><input placeholder="production, linux" {...field('tags')} /></Field>
      </div>
      <div className="dsh-ssh-form-section"><div className="dsh-ssh-form-section-heading"><strong>身份认证</strong><small>选择共享凭据或单独保存</small></div>
        <Field label="凭据来源" hint="可使用此连接自己的凭据，或引用密钥库中的常用账号。"><select {...field('credentialId')}><option value="">此连接独立保存</option>{vaultEntries.map(entry => <option value={entry.id} key={entry.id}>{entry.name} · {entry.username}</option>)}</select></Field>
        {selectedCredential ? <div className="dsh-ssh-credential-reference"><span><IconUserOutline16 size={16} /></span><span><strong>{selectedCredential.name}</strong><small>{selectedCredential.username} · {selectedCredential.authType === 'password' ? '密码' : '私钥'}</small></span><em>{selectedCredential.credential.configured ? '已就绪' : '缺少凭据'}</em></div> : <>
          <div className="dsh-ssh-form-grid"><Field label="用户名"><input required autoComplete="username" {...field('username')} /></Field><Field label="认证方式"><select {...field('authType')}><option value="password">密码</option><option value="private-key">私钥</option><option value="agent">SSH Agent</option></select></Field></div>
          {form.authType === 'password' && <Field label="密码" hint={profile?.credential.source === 'profile' && profile.credential.fields.includes('password') ? '已保存；留空保持不变' : '保存后不可读回'}><input required={profile === undefined} type="password" autoComplete="new-password" placeholder={profile?.credential.source === 'profile' && profile.credential.fields.includes('password') ? '••••••••' : ''} {...field('password')} /></Field>}
          {form.authType === 'private-key' && <><Field label="私钥" hint={profile?.credential.source === 'profile' && profile.credential.fields.includes('privateKey') ? '已保存；留空保持不变' : '粘贴 OpenSSH/PEM 私钥'}><textarea required={profile === undefined} rows={5} spellCheck={false} {...field('privateKey')} /></Field><Field label="私钥口令"><input type="password" autoComplete="new-password" {...field('passphrase')} /></Field></>}
        </>}
      </div>
      <div className="dsh-ssh-form-section"><div className="dsh-ssh-form-section-heading"><strong>连接路径</strong><small>直连、代理或跳板链</small></div>
        <Field label="连接方式"><select {...field('proxyType')}><option value="none">直连</option><option value="saved">常用代理</option><option value="http">自定义 HTTP CONNECT</option><option value="socks5">自定义 SOCKS5</option><option value="jump">SSH 跳板</option></select></Field>
        {form.proxyType === 'saved' && <Field label="常用代理" hint={proxyEntries.length === 0 ? '请先在代理库中添加 HTTP 或 SOCKS5 代理。' : '多台主机可引用同一条代理配置。'}><select required {...field('proxyEntryId')}><option value="">选择代理</option>{proxyEntries.map(entry => <option value={entry.id} key={entry.id}>{entry.name} · {entry.proxyType === 'http' ? 'HTTP' : 'SOCKS5'} · {entry.host}:{entry.port}</option>)}</select></Field>}
        {(form.proxyType === 'http' || form.proxyType === 'socks5') && <><div className="dsh-ssh-form-grid is-host"><Field label="代理主机"><input required spellCheck={false} {...field('proxyHost')} /></Field><Field label="代理端口"><input required type="number" inputMode="numeric" min="1" max="65535" {...field('proxyPort')} /></Field></div><div className="dsh-ssh-form-grid"><Field label="代理用户名"><input autoComplete="username" {...field('proxyUsername')} /></Field><Field label="代理密码"><input type="password" autoComplete="new-password" {...field('proxyPassword')} /></Field></div></>}
        {form.proxyType === 'jump' && <JumpChainEditor profiles={profiles.filter(item => item.id !== profile?.id)} value={form.jumpProfileIds} onChange={jumpProfileIds => setForm(current => ({ ...current, jumpProfileIds }))} />}
      </div>
      {pendingFingerprint && <div className="dsh-ssh-test-result is-warning" role="alert"><span><strong>首次连接，请核对主机指纹</strong><code>{pendingFingerprint}</code></span><button type="button" className="dsh-ssh-small-primary" disabled={testing} onClick={() => { void testConnection(pendingFingerprint) }}>确认并重试</button></div>}
      {testState === 'success' && <p className="dsh-ssh-test-result is-success" role="status"><IconCheckOutline14 size={14} />连接测试成功</p>}
      {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
      <div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button dsh-ssh-test-button" disabled={saving || testing} onClick={event => { if (event.currentTarget.form?.reportValidity()) void testConnection() }}>{testing ? '正在测试…' : '测试连接'}</button><button type="button" className="dsh-ssh-secondary-button" disabled={saving || testing} onClick={onClose}>取消</button><button className="dsh-ssh-primary-button" disabled={saving || testing}>{saving ? '正在保存…' : '保存连接'}</button></div>
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

  return <fieldset className="dsh-ssh-jump-chain"><legend>跳板链</legend><p>连接会按从上到下的顺序逐级建立。</p>
    <div>{value.map((profileId, index) => <div className="dsh-ssh-jump-row" key={`${profileId}-${index}`}><em>{index + 1}</em><select required value={profileId} onChange={event => update(index, event.target.value)}><option value="">选择已有连接</option>{profiles.filter(profile => profile.id === profileId || !value.includes(profile.id)).map(profile => <option value={profile.id} key={profile.id}>{profile.name} · {profile.host}</option>)}</select><button type="button" className="dsh-ssh-icon-button" disabled={index === 0} aria-label="上移跳板" onClick={() => move(index, -1)}><IconChevronUpOutline14 size={14} /></button><button type="button" className="dsh-ssh-icon-button" disabled={index === value.length - 1} aria-label="下移跳板" onClick={() => move(index, 1)}><IconChevronDownOutline14 size={14} /></button><button type="button" className="dsh-ssh-icon-button is-danger" aria-label="移除跳板" onClick={() => onChange(value.filter((_, current) => current !== index))}><IconTrashOutline16 size={15} /></button></div>)}</div>
    {value.length === 0 && <p className="dsh-ssh-jump-empty">至少添加一台跳板主机。</p>}
    <button type="button" className="dsh-ssh-secondary-button" disabled={value.length >= 8 || profiles.every(profile => value.includes(profile.id))} onClick={add}><IconPlusOutline16 size={15} />添加跳板</button>
  </fieldset>
}
