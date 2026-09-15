import { useRef, useState } from 'react'
import { t } from './i18n.js'
import { Dialog, errorMessage } from './ui-components.js'

interface ConfirmationRequest {
  title: string
  description: string
  onConfirm(): Promise<void>
}

/** Keeps the selected target stable and failures visible until retry or cancellation. */
export function useConfirmationDialog() {
  const [request, setRequest] = useState<ConfirmationRequest>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const inFlight = useRef(false)
  const close = (): void => { if (!inFlight.current) setRequest(undefined) }
  const submit = async (): Promise<void> => {
    if (!request || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(undefined)
    try { await request.onConfirm(); setRequest(undefined) }
    catch (reason) { setError(errorMessage(reason)) }
    finally { inFlight.current = false; setBusy(false) }
  }
  return {
    confirm: (next: ConfirmationRequest): void => {
      if (inFlight.current) return
      setError(undefined)
      setRequest(next)
    },
    confirmation: request && <Dialog variant="confirmation" dismissible={!busy} title={request.title} subtitle={request.description} onClose={close}>
      {error && <p className="dsh-ssh-inline-error" role="alert">{error}</p>}
      <div className="dsh-ssh-dialog-actions">
        <button type="button" className="dsh-ssh-secondary-button" disabled={busy} onClick={close}>{t('client.cancel')}</button>
        <button type="button" className="dsh-ssh-danger-button" disabled={busy} onClick={() => { void submit() }}>{busy ? t('file-entry-delete-dialog.deleting') : t('file-entry-delete-dialog.confirmDelete')}</button>
      </div>
    </Dialog>,
  }
}
