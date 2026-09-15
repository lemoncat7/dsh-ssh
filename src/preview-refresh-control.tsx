import { useSshLocale } from './use-ssh-locale.js'
import { t } from './i18n.js'
import { IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

export function PreviewRefreshControl({ busy, blocked = false, automatic, available, onRefresh, onToggle }: {
  busy: boolean; blocked?: boolean; automatic: boolean; available: boolean; onRefresh(): void; onToggle(): void
}): JSX.Element {
  useSshLocale()
  return <span className="dsh-ssh-preview-refresh" role="group" aria-label={t("preview-refresh-control.previewRefresh")} data-automatic={automatic}>
    <button type="button" aria-label={t("preview-refresh-control.refreshPreview")} title={blocked ? t("preview-refresh-control.saveYourChangesFirst") : busy ? t("preview-refresh-control.refreshing") : t("preview-refresh-control.refreshPreviewAndKeepReadingPosition")} disabled={busy || blocked} onClick={onRefresh}><IconRefreshOutline16 size={16} /></button>
    <button type="button" className="dsh-ssh-preview-refresh-mode" aria-label={t("preview-refresh-control.autoRefresh")} aria-pressed={automatic} disabled={!available} title={!available ? t("preview-refresh-control.autoRefreshIsUnavailableForThisPreview") : automatic ? t("preview-refresh-control.checkForChangesEvery5SecondsClickForManual") : t("preview-refresh-control.manualRefreshClickToEnableAutoRefresh")} onClick={onToggle}>{automatic ? t("preview-refresh-control.auto") : t("preview-refresh-control.manual")}</button>
  </span>
}
