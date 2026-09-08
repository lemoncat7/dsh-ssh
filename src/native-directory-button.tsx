import { useEffect, useState } from 'react'
import { IconFolderOpenOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { loadNativeDirectorySupport, openNativeDirectory } from './client-api.js'

export function NativeDirectoryButton({ sessionId, path, onMessage }: { sessionId: string; path: string | undefined; onMessage(message: string): void }): JSX.Element {
  const [available, setAvailable] = useState(false)
  const [checking, setChecking] = useState(true)
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('DSH 运行环境不支持系统文件管理器，请使用目录弹窗或下载')
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
    try { await openNativeDirectory(sessionId, path); onMessage('已请求在 DSH 所在电脑打开文件管理器') }
    catch (error) { onMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <button type="button" aria-label="打开文件管理器" data-unavailable={!available || undefined} disabled={checking || busy || !path}
    title={checking ? '正在检测文件管理器支持' : available ? '在 DSH 所在电脑的文件管理器中打开当前目录' : reason}
    onClick={() => { void open() }}><IconFolderOpenOutline16 size={16} /></button>
}
