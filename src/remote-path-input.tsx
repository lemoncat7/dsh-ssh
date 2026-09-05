import { t, tx } from './i18n.js'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { IconChevronRightOutline14, IconFolderClose16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { loadFileEndpointDirectory, type SftpDirectoryView } from './client-api.js'
import { isNavigableRemoteEntry } from './file-transfer-intent.js'

const DIRECTORY_LOOKUP_PANE_ID = 'project-directory-picker'
const LOOKUP_DELAY_MS = 600

interface RemotePathInputProps {
  profileId: string
  value: string
  disabled: boolean
  onChange(path: string): void
}

type LookupState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ready'; directory: SftpDirectoryView }
  | { kind: 'error'; message: string }

/** Keeps the path free-form while asynchronously offering verified remote subdirectories. */
export function RemotePathInput({ profileId, value, disabled, onChange }: RemotePathInputProps): JSX.Element {
  const inputId = useId()
  const feedbackId = useId()
  const requestGenerationRef = useRef(0)
  const [lookup, setLookup] = useState<LookupState>({ kind: 'idle' })
  const endpointId = `sftp:${profileId}`
  const folders = useMemo(() => lookup.kind === 'ready'
    ? lookup.directory.entries.filter(isNavigableRemoteEntry)
    : [], [lookup])

  useEffect(() => {
    const generation = ++requestGenerationRef.current
    const target = value.trim()
    if (target.length === 0) {
      setLookup({ kind: 'idle' })
      return
    }

    setLookup({ kind: 'checking' })
    const timer = window.setTimeout(() => {
      void loadFileEndpointDirectory(DIRECTORY_LOOKUP_PANE_ID, endpointId, target)
        .then(directory => {
          if (generation === requestGenerationRef.current) setLookup({ kind: 'ready', directory })
        })
        .catch((reason: unknown) => {
          if (generation === requestGenerationRef.current) setLookup({ kind: 'error', message: errorMessage(reason) })
        })
    }, LOOKUP_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [endpointId, value])

  const feedback = lookup.kind === 'idle'
    ? t("Type directly; the remote path is checked automatically after you stop typing.")
    : lookup.kind === 'checking'
      ? t("Checking the remote path…")
      : lookup.kind === 'error'
        ? tx`The path does not exist or cannot be accessed: ${lookup.message}. You can still save with the current input.`
        : folders.length === 0
          ? t("The path is accessible; no subdirectories yet.")
          : tx`The path is accessible; found ${folders.length} subdirectories.`

  return <div className="dsh-ssh-field dsh-ssh-remote-path-field">
    <label htmlFor={inputId}>{t("Remote path")}</label>
    <input
      id={inputId}
      required
      maxLength={4096}
      value={value}
      disabled={disabled}
      spellCheck={false}
      placeholder="/var/www/example"
      aria-invalid={lookup.kind === 'error' ? 'true' : undefined}
      aria-describedby={feedbackId}
      onChange={event => onChange(event.target.value)}
    />
    <small
      id={feedbackId}
      className={`dsh-ssh-remote-path-feedback is-${lookup.kind}`}
      role={lookup.kind === 'error' ? 'alert' : 'status'}
    >{feedback}</small>
    {lookup.kind === 'ready' && folders.length > 0 && <div className="dsh-ssh-remote-path-options" aria-label={t("Selectable remote subdirectories")}>
      {folders.map(folder => <button
        type="button"
        key={folder.path}
        disabled={disabled}
        title={tx`Select ${folder.path}`}
        onClick={() => onChange(folder.path)}
      ><IconFolderClose16 size={15} aria-hidden="true" /><span>{folder.name}</span><IconChevronRightOutline14 size={13} aria-hidden="true" /></button>)}
    </div>}
  </div>
}

function errorMessage(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason) }
