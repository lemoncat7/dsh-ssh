import { useSshLocale } from './use-ssh-locale.js'
import { t } from './i18n.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconEditOutline16, IconPlusOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SavedCommand } from './domain.js'
import { api } from './client-api.js'
import { Dialog, Field, errorMessage } from './ui-components.js'
import { useWorkspaceRefresh } from './use-workspace-refresh.js'

export function CommandsPanel({ onChoose }: { onChoose?: ((command: string) => void) | undefined }): JSX.Element {
  const sshLocale = useSshLocale()
  const [items, setItems] = useState<SavedCommand[]>([])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [editing, setEditing] = useState<SavedCommand | 'new'>()
  const [deleting, setDeleting] = useState<SavedCommand>()
  const [busy, setBusy] = useState(false)
  const refreshGeneration = useRef(0)
  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      const next = await api<SavedCommand[]>('/commands', { signal: controller.signal, cache: 'no-store' })
      if (generation !== refreshGeneration.current) return false
      setItems(next); setError(undefined)
    }
    catch (reason) { if (generation === refreshGeneration.current) setError(errorMessage(reason)); return false }
    finally { clearTimeout(timeout); if (generation === refreshGeneration.current) setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  useWorkspaceRefresh(refresh)
  const searchIndex = useMemo(() => items.map(item => ({ item, text: `${item.name}\n${item.command}`.toLocaleLowerCase() })), [items, sshLocale])
  const filtered = useMemo(() => {
    const needle = query.toLocaleLowerCase()
    return searchIndex.filter(entry => entry.text.includes(needle)).map(entry => entry.item)
  }, [searchIndex, query, sshLocale])
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 50) - 1))
  const visible = filtered.slice(currentPage * 50, (currentPage + 1) * 50)
  return <div className={onChoose ? 'dsh-ssh-command-picker' : 'dsh-ssh-commands-pane'}>
    {!onChoose && <header className="dsh-ssh-content-heading"><div><h1>{t("client.savedCommands")}</h1><p>{t("commands-panel.saveCommandsManuallyThenSelectAndConfirmExecutionIn")}</p></div><button type="button" className="dsh-ssh-primary-button" onClick={() => setEditing('new')}><IconPlusOutline16 size={16} />{t("commands-panel.newCommand")}</button></header>}
    <label className="dsh-ssh-search"><span className="sr-only">{t("commands-panel.searchCommands")}</span><input value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} placeholder={t("commands-panel.searchNamesOrCommands")} /></label>
    {error && <p className="dsh-ssh-inline-error" role="alert">{error}<button type="button" className="dsh-ssh-secondary-button" onClick={() => { void refresh() }}>{t("commands-panel.retry")}</button></p>}
    <div className="dsh-ssh-command-list dsh-ssh-scroll-surface">
      {loading ? <p role="status">{t("commands-panel.loadingCommands")}</p> : filtered.length === 0 ? <p className="dsh-ssh-command-empty">{query ? t("commands-panel.noMatchingCommands") : onChoose ? t("commands-panel.noSavedCommandsYetCreateOneOnTheWorkspace") : t("commands-panel.noSavedCommandsYetClickNewCommandToGet")}</p> : visible.map(item => <article key={item.id} data-ssh-interactive="row" className="dsh-ssh-command-row"><div><strong>{item.name}</strong><pre>{item.command}</pre></div><div className="dsh-ssh-heading-actions">
        {onChoose && <button type="button" className="dsh-ssh-secondary-button" onClick={() => onChoose(item.command)}>{t("commands-panel.select")}</button>}
        {!onChoose && <><button type="button" className="dsh-ssh-icon-button" title={t("commands-panel.editCommand")} aria-label={t("client.edit2", [item.name])} onClick={() => setEditing(item)}><IconEditOutline16 size={16} /></button>
        <button type="button" className="dsh-ssh-icon-button is-danger" title={t("commands-panel.deleteCommand")} aria-label={t("client.delete2", [item.name])} onClick={() => setDeleting(item)}><IconTrashOutline16 size={16} /></button></>}
      </div></article>)}
    </div>
    {filtered.length > 50 && <nav className="dsh-ssh-command-pagination" aria-label={t("commands-panel.commandPages")}><span>{currentPage + 1} / {Math.ceil(filtered.length / 50)}  {t("commands-panel.pages")} {filtered.length}  {t("commands-panel.items")}</span><button type="button" className="dsh-ssh-secondary-button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t("commands-panel.previousPage")}</button><button type="button" className="dsh-ssh-secondary-button" disabled={(currentPage + 1) * 50 >= filtered.length} onClick={() => setPage(currentPage + 1)}>{t("commands-panel.nextPage")}</button></nav>}
    {editing && <CommandEditor value={editing === 'new' ? undefined : editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); void refresh() }} />}
    {deleting && <Dialog variant="confirmation" dismissible={!busy} title={t("commands-panel.deleteSavedCommand")} subtitle={deleting.name} onClose={() => { if (!busy) setDeleting(undefined) }}><p>{t("commands-panel.onlyThisRecordIsDeletedRunningTerminalsAreNot")}</p><div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" disabled={busy} onClick={() => setDeleting(undefined)}>{t("client.cancel")}</button><button type="button" className="dsh-ssh-danger-button" disabled={busy} onClick={() => {
      setBusy(true)
      void api(`/commands/${encodeURIComponent(deleting.id)}`, { method: 'DELETE' }).then(() => { setDeleting(undefined); return refresh() }).catch(reason => setError(errorMessage(reason))).finally(() => setBusy(false))
    }}>{busy ? t("commands-panel.deleting") : t("client.delete")}</button></div>{error && <p role="alert" className="dsh-ssh-inline-error">{error}</p>}</Dialog>}
  </div>
}

function CommandEditor({ value, onClose, onSaved }: { value?: SavedCommand | undefined; onClose(): void; onSaved(): void }): JSX.Element {
  useSshLocale()
  const [name, setName] = useState(value?.name ?? '')
  const [command, setCommand] = useState(value?.command ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  return <Dialog title={value ? t("commands-panel.editCommand") : t("commands-panel.newCommand")} onClose={() => { if (!busy) onClose() }}><form className="dsh-ssh-form" onSubmit={event => {
    event.preventDefault(); setBusy(true); setError(undefined)
    void api(value ? `/commands/${encodeURIComponent(value.id)}` : '/commands', { method: value ? 'PUT' : 'POST', body: JSON.stringify({ name, command }) }).then(onSaved).catch(reason => setError(errorMessage(reason))).finally(() => setBusy(false))
  }}><Field label={t("client.name")}><input required maxLength={80} value={name} onChange={event => setName(event.target.value)} /></Field><Field label={t("commands-panel.command")} hint={t("commands-panel.multiLineScriptsAreSupportedRecordsStayInThis")}><textarea required rows={6} maxLength={16000} value={command} onChange={event => setCommand(event.target.value)} /></Field>{error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}<div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" disabled={busy} onClick={onClose}>{t("client.cancel")}</button><button type="submit" className="dsh-ssh-primary-button" disabled={busy}>{busy ? t("client.saving2") : t("commands-panel.save")}</button></div></form></Dialog>
}
