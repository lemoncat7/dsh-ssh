import { useEffect, useRef } from 'react'
import { api } from './client-api.js'
import { WorkspaceRefresh } from './workspace-refresh.js'

const monitor = new WorkspaceRefresh(async () => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const { revision } = await api<{ revision: string }>('/workspace-revision', { cache: 'no-store', signal: controller.signal })
    if (typeof revision !== 'string') throw new Error('Invalid workspace revision')
    return revision
  } finally { clearTimeout(timeout) }
})
let users = 0
let timer: ReturnType<typeof setInterval> | undefined
const check = (): void => { if (!document.hidden) void monitor.check() }

export function refreshWorkspace(): void { check() }

export function useWorkspaceRefresh(refresh: () => Promise<boolean | void>): void {
  const callback = useRef(refresh)
  callback.current = refresh
  useEffect(() => {
    const unsubscribe = monitor.subscribe(() => callback.current())
    if (++users === 1) {
      timer = setInterval(check, 5000)
      document.addEventListener('visibilitychange', check)
      window.addEventListener('focus', check)
    }
    check()
    return () => {
      unsubscribe()
      if (--users === 0) {
        clearInterval(timer); timer = undefined
        document.removeEventListener('visibilitychange', check)
        window.removeEventListener('focus', check)
      }
    }
  }, [])
}
