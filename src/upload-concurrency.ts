export const uploadConcurrencyChoices = [1, 2, 4, 8, 16]
export const defaultUploadConcurrency = 4
const key = 'dsh-ssh:sftp-upload-concurrency'
let preference = defaultUploadConcurrency

export function readUploadConcurrency(): number {
  try {
    const stored = Number(localStorage.getItem(key))
    if (uploadConcurrencyChoices.includes(stored)) preference = stored
  } catch {}
  return preference
}

export function saveUploadConcurrency(value: number): void {
  if (!uploadConcurrencyChoices.includes(value)) return
  preference = value
  try { localStorage.setItem(key, String(value)) } catch {}
}
