import { useCallback, useEffect, useRef, useState } from 'react'
import { loadInjection, saveSessionAccess, type InjectionView } from './client-api.js'
import { publishSessionAccess } from './session-access-channel.js'

export interface SessionAccessState {
  value: InjectionView | null
  loading: boolean
  saving: boolean
  error?: string | undefined
  setProfiles(profileIds: string[]): void
  setDirectory(profileId: string, path?: string, projectId?: string): void
  setPermission(permission: InjectionView['permission']): void
  setRequireCommandApproval(value: boolean): void
  replace(value: InjectionView): Promise<InjectionView>
}

export function useSessionAccess(sessionId?: string): SessionAccessState {
  const [value, setValue] = useState<InjectionView | null>(null)
  const [loading, setLoading] = useState(sessionId !== undefined)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const valueRef = useRef<InjectionView | null>(null)
  const sessionRef = useRef(sessionId)
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())
  const pendingRef = useRef(0)
  sessionRef.current = sessionId

  useEffect(() => {
    let cancelled = false
    valueRef.current = null
    setValue(null)
    setError(undefined)
    setLoading(sessionId !== undefined)
    if (sessionId === undefined) return () => { cancelled = true }
    void loadInjection(sessionId).then(stored => {
      if (cancelled) return
      const next = stored ?? emptyAccess(sessionId)
      valueRef.current = next
      setValue(next)
      publishSessionAccess(next)
    }).catch(reason => { if (!cancelled) setError(errorMessage(reason)) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [sessionId])

  const replace = useCallback(async (next: InjectionView): Promise<InjectionView> => {
    valueRef.current = next
    setValue(next)
    publishSessionAccess(next)
    setError(undefined)
    pendingRef.current += 1
    setSaving(true)
    const request = queueRef.current.catch(() => undefined).then(() => saveSessionAccess(next))
    queueRef.current = request
    try {
      const stored = await request
      if (sessionRef.current === stored.sessionId && valueRef.current === next) {
        valueRef.current = stored
        setValue(stored)
        publishSessionAccess(stored)
      }
      return stored
    } catch (reason) {
      if (sessionRef.current === next.sessionId) setError(errorMessage(reason))
      throw reason
    } finally {
      pendingRef.current = Math.max(0, pendingRef.current - 1)
      if (sessionRef.current === next.sessionId && pendingRef.current === 0) setSaving(false)
    }
  }, [])

  const update = useCallback((patch: Partial<InjectionView>): void => {
    const currentSessionId = sessionRef.current
    if (currentSessionId === undefined) return
    const current = valueRef.current ?? emptyAccess(currentSessionId)
    void replace({ ...current, ...patch, sessionId: currentSessionId }).catch(() => {})
  }, [replace])

  return {
    value, loading, saving, error,
    setProfiles: profileIds => update({ profileIds }),
    setDirectory: (profileId, path, projectId) => {
      const currentSessionId = sessionRef.current
      if (currentSessionId === undefined) return
      const current = valueRef.current ?? emptyAccess(currentSessionId)
      const workingDirectories = { ...current.workingDirectories }
      const workingProjectIds = { ...current.workingProjectIds }
      if (path === undefined) delete workingDirectories[profileId]
      else workingDirectories[profileId] = path
      if (projectId === undefined) delete workingProjectIds[profileId]
      else workingProjectIds[profileId] = projectId
      update({ workingDirectories, workingProjectIds })
    },
    setPermission: permission => update({ permission }),
    setRequireCommandApproval: requireCommandApproval => update({ requireCommandApproval }),
    replace,
  }
}

export function emptyAccess(sessionId: string): InjectionView {
  return { sessionId, profileIds: [], permission: 'exec', requireCommandApproval: true, workingDirectories: {}, workingProjectIds: {}, updatedAt: 0 }
}

function errorMessage(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason) }
