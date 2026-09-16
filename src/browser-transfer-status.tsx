import { useSyncExternalStore } from 'react'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { browserTransfers, dismissBrowserTransfer } from './browser-transfers.js'
import { useSshLocale } from './use-ssh-locale.js'
import { t } from './i18n.js'

export function BrowserTransferStatus(): JSX.Element | null {
  useSshLocale()
  const jobs = useSyncExternalStore(browserTransfers.subscribe, browserTransfers.getSnapshot)
  if (!jobs.length) return null
  return <div className="dsh-ssh-browser-transfers" aria-label={t('browser-transfer.title')}>
    {jobs.map(job => {
      const done = job.state === 'completed'
      const progress = done ? 100 : job.totalBytes ? Math.min(99, job.transferredBytes / job.totalBytes * 100) : undefined
      const status = job.state === 'preparing' ? t('browser-transfer.preparing') : job.state === 'waiting' ? t('browser-transfer.waiting') : job.state === 'unavailable' ? t('browser-transfer.unavailable') : job.state === 'failed' ? job.error || t('browser-transfer.failed') : done ? job.direction === 'download' ? t('browser-transfer.delivered') : t('browser-transfer.saved') : `${progress === undefined ? '' : `${progress.toFixed(0)}% · `}${bytes(job.transferredBytes)}${job.totalBytes === undefined ? '' : ` / ${bytes(job.totalBytes)}`}`
      return <div className="dsh-ssh-browser-transfer" key={job.id}>
        <span><strong title={job.name}>{job.direction === 'upload' ? t('browser-transfer.upload') : t('browser-transfer.download')} · {job.name}</strong><small role="status">{status}</small><span className="dsh-ssh-transfer-progress" role="progressbar" aria-label={job.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ transform: `scaleX(${progress === undefined ? .12 : progress / 100})` }} /></span></span>
        {(done || job.state === 'failed' || job.state === 'unavailable') && <button type="button" className="dsh-ssh-icon-button" aria-label={t('client.close')} onClick={() => dismissBrowserTransfer(job.id)}><IconCloseOutline16 size={14}/></button>}
      </div>
    })}
  </div>
}
function bytes(value: number): string { return value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1048576).toFixed(1)} MB` }
