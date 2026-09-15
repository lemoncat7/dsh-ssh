import { useSshLocale } from './use-ssh-locale.js'
import { t } from './i18n.js'
import { useEffect, useState } from 'react'
import { IconFolderOpenOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { loadNativeDirectorySupport, openNativeDirectory } from './client-api.js'

export function NativeDirectoryButton({ sessionId, path, onMessage }: { sessionId: string; path: string | undefined; onMessage(message: string): void }): JSX.Element {
  useSshLocale()
  const [available, setAvailable] = useState(false)
  const [checking, setChecking] = useState(true)
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState(t("native-directory-button.theDshEnvironmentHasNoSupportedFileManagerUse"))
  useEffect(() => {
    let active = true
    void loadNativeDirectorySupport().then(value => { if (active) setAvailable(value.available) })
      .catch(error => { if (active) setReason(error instanceof Error ? error.message : String(error)) })
      .finally(() => { if (active) setChecking(false) })
    return () => { active = false }
  }, [])
  const open = async (): Promise<void> => {
    if (!available) { onMessage(reason); return }
    if (!path || busy) return
    setBusy(true)
    try { await openNativeDirectory(sessionId, path); onMessage(t("native-directory-button.requestedTheFileManagerOnTheComputerRunningDsh")) }
    catch (error) { onMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <button type="button" aria-label={t("native-directory-button.openFileManager")} data-unavailable={!available || undefined} disabled={checking || busy || !path}
    title={checking ? t("native-directory-button.checkingFileManagerSupport") : available ? t("native-directory-button.openThisDirectoryInTheFileManagerOnThe") : reason}
    onClick={() => { void open() }}><IconFolderOpenOutline16 size={16} /></button>
}
