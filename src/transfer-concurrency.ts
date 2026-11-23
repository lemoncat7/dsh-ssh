export const transferConcurrencyChoices = [1, 2, 4, 8, 16]
export const defaultUploadConcurrency = 4
const key = 'dsh-ssh:sftp-upload-concurrency'
let preference = defaultUploadConcurrency

export function readUploadConcurrency(): number {
  try {
    const stored = Number(localStorage.getItem(key))
    if (transferConcurrencyChoices.includes(stored)) preference = stored
  } catch {}
  return preference
}

export function saveUploadConcurrency(value: number): void {
  if (!transferConcurrencyChoices.includes(value)) return
  preference = value
  try { localStorage.setItem(key, String(value)) } catch {}
}

export const defaultDownloadConcurrency = 4
const downloadKey = 'dsh-ssh:sftp-download-concurrency'

export function readDownloadConcurrency(): number {
  try {
    const stored = Number(localStorage.getItem(downloadKey))
    if (transferConcurrencyChoices.includes(stored)) return stored
  } catch {}
  return defaultDownloadConcurrency
}

export function saveDownloadConcurrency(value: number): void {
  if (!transferConcurrencyChoices.includes(value)) return
  try { localStorage.setItem(downloadKey, String(value)) } catch {}
}
