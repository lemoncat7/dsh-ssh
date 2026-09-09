import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconEditOutline16, IconPlusOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SavedCommand } from './domain.js'
import { api } from './client-api.js'
import { Dialog, Field, errorMessage } from './ui-components.js'

export function CommandsPanel({ onChoose }: { onChoose?: ((command: string) => void) | undefined }): JSX.Element {
  const [items, setItems] = useState<SavedCommand[]>([])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [editing, setEditing] = useState<SavedCommand | 'new'>()
  const [deleting, setDeleting] = useState<SavedCommand>()
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => {
    try { setItems(await api<SavedCommand[]>('/commands')); setError(undefined) }
    catch (reason) { setError(errorMessage(reason)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const searchIndex = useMemo(() => items.map(item => ({ item, text: `${item.name}\n${item.command}`.toLocaleLowerCase() })), [items])
  const filtered = useMemo(() => {
    const needle = query.toLocaleLowerCase()
    return searchIndex.filter(entry => entry.text.includes(needle)).map(entry => entry.item)
  }, [searchIndex, query])
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 50) - 1))
  const visible = filtered.slice(currentPage * 50, (currentPage + 1) * 50)
  return <div className={onChoose ? 'dsh-ssh-command-picker' : 'dsh-ssh-commands-pane'}>
    {!onChoose && <header className="dsh-ssh-content-heading"><div><h1>常用命令</h1><p>手动记录，在终端中选择并确认执行。请勿保存密码或 Token。</p></div><button type="button" className="dsh-ssh-primary-button" onClick={() => setEditing('new')}><IconPlusOutline16 size={16} />新建命令</button></header>}
    <label className="dsh-ssh-search"><span className="sr-only">搜索命令</span><input value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} placeholder="搜索名称或命令…" /></label>
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}<button type="button" className="dsh-ssh-secondary-button" onClick={() => { void refresh() }}>重试</button></p>}
    <div className="dsh-ssh-command-list dsh-ssh-scroll-surface">
      {loading ? <p role="status">正在读取命令…</p> : filtered.length === 0 ? <p className="dsh-ssh-command-empty">{query ? '没有匹配的命令' : onChoose ? '还没有常用命令，请先到工作台的常用命令页面新建。' : '还没有常用命令，点击新建开始记录。'}</p> : visible.map(item => <article key={item.id} data-ssh-interactive="row" className="dsh-ssh-command-row"><div><strong>{item.name}</strong><pre>{item.command}</pre></div><div className="dsh-ssh-heading-actions">
        {onChoose && <button type="button" className="dsh-ssh-secondary-button" onClick={() => onChoose(item.command)}>选用</button>}
        {!onChoose && <><button type="button" className="dsh-ssh-icon-button" title="编辑命令" aria-label={`编辑 ${item.name}`} onClick={() => setEditing(item)}><IconEditOutline16 size={16} /></button>
        <button type="button" className="dsh-ssh-icon-button is-danger" title="删除命令" aria-label={`删除 ${item.name}`} onClick={() => setDeleting(item)}><IconTrashOutline16 size={16} /></button></>}
      </div></article>)}
    </div>
    {filtered.length > 50 && <nav className="dsh-ssh-command-pagination" aria-label="命令分页"><span>{currentPage + 1} / {Math.ceil(filtered.length / 50)} 页 · {filtered.length} 条</span><button type="button" className="dsh-ssh-secondary-button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button><button type="button" className="dsh-ssh-secondary-button" disabled={(currentPage + 1) * 50 >= filtered.length} onClick={() => setPage(currentPage + 1)}>下一页</button></nav>}
    {editing && <CommandEditor value={editing === 'new' ? undefined : editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); void refresh() }} />}
    {deleting && <Dialog title="删除常用命令" subtitle={deleting.name} onClose={() => { if (!busy) setDeleting(undefined) }}><p>仅删除记录，不影响已经运行的终端。</p><div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" disabled={busy} onClick={() => setDeleting(undefined)}>取消</button><button type="button" className="dsh-ssh-danger-button" disabled={busy} onClick={() => {
      setBusy(true)
      void api(`/commands/${encodeURIComponent(deleting.id)}`, { method: 'DELETE' }).then(() => { setDeleting(undefined); return refresh() }).catch(reason => setError(errorMessage(reason))).finally(() => setBusy(false))
    }}>{busy ? '删除中…' : '删除'}</button></div>{error && <p role="alert" className="dsh-ssh-inline-error">{error}</p>}</Dialog>}
  </div>
}

function CommandEditor({ value, onClose, onSaved }: { value?: SavedCommand | undefined; onClose(): void; onSaved(): void }): JSX.Element {
  const [name, setName] = useState(value?.name ?? '')
  const [command, setCommand] = useState(value?.command ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  return <Dialog title={value ? '编辑命令' : '新建命令'} onClose={() => { if (!busy) onClose() }}><form className="dsh-ssh-form" onSubmit={event => {
    event.preventDefault(); setBusy(true); setError(undefined)
    void api(value ? `/commands/${encodeURIComponent(value.id)}` : '/commands', { method: value ? 'PUT' : 'POST', body: JSON.stringify({ name, command }) }).then(onSaved).catch(reason => setError(errorMessage(reason))).finally(() => setBusy(false))
  }}><Field label="名称"><input required maxLength={80} value={name} onChange={event => setName(event.target.value)} /></Field><Field label="命令" hint="支持多行脚本；记录保存在当前 DSH 实例，不会自动执行或上传到 Gist。"><textarea required rows={6} maxLength={16000} value={command} onChange={event => setCommand(event.target.value)} /></Field>{error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}<div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="dsh-ssh-primary-button" disabled={busy}>{busy ? '保存中…' : '保存'}</button></div></form></Dialog>
}
