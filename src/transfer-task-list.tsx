import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { IconChevronDownOutline14, IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { browserTransfers, dismissBrowserTransfer, isBrowserTransferActive, canCancelBrowserTransfer, cancelBrowserTransfer, type BrowserTransfer } from './browser-transfers.js'
import { useSshLocale } from './use-ssh-locale.js'
import { t } from './i18n.js'

export function useBrowserTransferTasks(): BrowserTransfer[] {
  return useSyncExternalStore(browserTransfers.subscribe, browserTransfers.getSnapshot)
}

export { isBrowserTransferActive } from './browser-transfers.js'

/** The same task container is used for endpoint transfers and browser I/O. */
export function TransferTaskList({ activeCount, count, children }: { activeCount: number; count: number; children: ReactNode }): JSX.Element {
  useSshLocale()
  const [open, setOpen] = useState(true)
  return <section className={`dsh-ssh-transfer-queue${open ? ' is-open' : ''}`} aria-label={t('file-transfer-workspace.transferTasks')}>
    <button type="button" className="dsh-ssh-transfer-queue-heading" aria-expanded={open} title={open ? t('file-transfer-workspace.collapseTransferTasks') : t('file-transfer-workspace.expandTransferTasks')} onClick={() => setOpen(value => !value)}>
      <span><strong>{t('file-transfer-workspace.transferTasks')}</strong><small role="status">{activeCount > 0 ? t('file-transfer-workspace.inProgress', [activeCount]) : count > 0 ? t('file-transfer-workspace.recentTasks') : t('file-transfer-workspace.noTasksYet')}</small></span>
      <span className="dsh-ssh-transfer-queue-disclosure" aria-hidden="true"><IconChevronDownOutline14 size={14} /></span>
    </button>
    {open && <div className="dsh-ssh-transfer-job-list">{children}</div>}
  </section>
}

export function BrowserTransferTask({ job }: { job: BrowserTransfer }): JSX.Element {
  useSshLocale()
  const done = job.state === 'completed'
  const progress = job.state === 'unavailable' || job.state === 'cancelled' ? undefined : done ? 100 : job.totalBytes ? Math.min(99, job.transferredBytes / job.totalBytes * 100) : undefined
  const status = job.state === 'preparing' ? t('browser-transfer.preparing') : job.state === 'saving' ? t('browser-transfer.savingLocal') : job.state === 'cancelled' ? t('file-transfer-workspace.cancelled') : job.state === 'waiting' ? t('browser-transfer.waiting') : job.state === 'unavailable' ? t('browser-transfer.unavailable') : job.state === 'failed' ? job.error || t('browser-transfer.failed') : done ? job.direction === 'download' ? t('browser-transfer.savedLocal') : t('browser-transfer.saved') : `${progress === undefined ? '' : `${progress.toFixed(0)}% · `}${bytes(job.transferredBytes)}${job.totalBytes === undefined ? '' : ` / ${bytes(job.totalBytes)}`}`
  const title = `${job.direction === 'upload' ? t('browser-transfer.upload') : t('browser-transfer.download')} · ${job.name}`
  return <article>
    <span className={`dsh-ssh-transfer-state is-${job.state}`} aria-hidden="true" />
    <span className="dsh-ssh-transfer-job-copy"><strong title={title}>{title}</strong><small title={status} role="status" style={job.state === 'unavailable' ? { whiteSpace: 'normal' } : undefined}>{status}</small>
      <span className="dsh-ssh-transfer-job-time">{job.completedAt === undefined ? t('file-transfer-workspace.created', [new Date(job.createdAt).toLocaleTimeString()]) : t('browser-transfer.finishedAt', [new Date(job.completedAt).toLocaleTimeString()])}</span>
      {progress !== undefined && <span className="dsh-ssh-transfer-progress" role="progressbar" aria-label={job.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ transform: `scaleX(${progress / 100})` }} /></span>}
    </span>
    {canCancelBrowserTransfer(job) ? <button type="button" className="dsh-ssh-icon-button" aria-label={t('file-transfer-workspace.cancelTransfer')} onClick={() => cancelBrowserTransfer(job.id)}><IconCloseOutline16 size={15} /></button> : !isBrowserTransferActive(job) && <button type="button" className="dsh-ssh-icon-button" aria-label={t('client.close')} onClick={() => dismissBrowserTransfer(job.id)}><IconCloseOutline16 size={15} /></button>}
  </article>
}

/** Compact SFTP surfaces reuse the task list, not a separate progress widget. */
export function LocalTransferTasks(): JSX.Element | null {
  const jobs = useBrowserTransferTasks()
  if (!jobs.length) return null
  const active = jobs.filter(isBrowserTransferActive)
  const ordered = [...active, ...jobs.filter(job => !isBrowserTransferActive(job))]
  return <TransferTaskList activeCount={active.length} count={jobs.length}>{ordered.map(job => <BrowserTransferTask key={job.id} job={job} />)}</TransferTaskList>
}

function bytes(value: number): string { return value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1048576).toFixed(1)} MB` }
