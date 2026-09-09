import { useCallback, useEffect, useRef, useState } from 'react'
import { loadInjection, saveSessionAccess, type InjectionView } from './client-api.js'
import { publishSessionAccess } from './session-access-channel.js'
import { mountedProjects } from './project-mounts.js'

export interface SessionAccessState {
  value: InjectionView | null
  loading: boolean
  saving: boolean
  error?: string | undefined
  setProfiles(profileIds: string[]): void
  setDirectory(profileId: string, path?: string, projectId?: string): void
  toggleProject(profileId: string, projectId: string, path: string): void
  setPermission(permission: InjectionView['permission']): void
  setRequireCommandApproval(value: boolean): void
  setFileEndpoints(endpointIds: string[]): void
  setFilePermission(permission: InjectionView['filePermission']): void
  setRequireFileApproval(value: boolean): void
  replace(value: InjectionView): Promise<InjectionView>
  refresh(): Promise<void>
}

export function useSessionAccess(sessionId?: string): SessionAccessState {
  const [value, setValue] = useState<InjectionView | null>(null)
  const [loading, setLoading] = useState(sessionId !== undefined)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const valueRef = useRef<InjectionView | null>(null)
  const confirmedRef = useRef<InjectionView | null>(null)
  const sessionRef = useRef(sessionId)
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())
  const pendingRef = useRef(0)
  sessionRef.current = sessionId

  useEffect(() => {
    let cancelled = false
    valueRef.current = null
    confirmedRef.current = null
    setValue(null)
    setError(undefined)
    setLoading(sessionId !== undefined)
    if (sessionId === undefined) return () => { cancelled = true }
    void loadInjection(sessionId).then(stored => {
      if (cancelled) return
      const next = stored ?? emptyAccess(sessionId)
      valueRef.current = next
      confirmedRef.current = next
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
      if (sessionRef.current === stored.sessionId) confirmedRef.current = stored
      if (sessionRef.current === stored.sessionId && valueRef.current === next) {
        valueRef.current = stored
        setValue(stored)
        publishSessionAccess(stored)
      }
      return stored
    } catch (reason) {
      if (sessionRef.current === next.sessionId) {
        setError(errorMessage(reason))
        if (valueRef.current === next && confirmedRef.current) {
          valueRef.current = confirmedRef.current
          setValue(confirmedRef.current)
          publishSessionAccess(confirmedRef.current)
        }
      }
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
    refresh: async () => {
      const id = sessionRef.current
      if (!id) return
      try {
        await queueRef.current.catch(() => {})
        const current = valueRef.current
        const next = await loadInjection(id) ?? emptyAccess(id)
        if (id !== sessionRef.current || current !== valueRef.current) return
        valueRef.current = next; confirmedRef.current = next; setValue(next); publishSessionAccess(next)
      } catch (reason) { if (id === sessionRef.current) setError(errorMessage(reason)) }
    },
    setProfiles: profileIds => {
      const current = valueRef.current
      update({ profileIds, mountedProjectIds: Object.fromEntries(profileIds.map(id => [id, current ? mountedProjects(current, id) : []])) })
    },
    toggleProject: (profileId, projectId, path) => {
      const current = valueRef.current
      if (!current || !current.profileIds.includes(profileId)) return
      const ids = mountedProjects(current, profileId)
      const removing = ids.includes(projectId)
      const nextIds = removing ? ids.filter(id => id !== projectId) : [...ids, projectId]
      const workingDirectories = { ...current.workingDirectories }
      const workingProjectIds = { ...current.workingProjectIds }
      if (!removing && workingProjectIds[profileId] === undefined) {
        workingDirectories[profileId] = path
        workingProjectIds[profileId] = projectId
      } else if (removing && workingProjectIds[profileId] === projectId) {
        delete workingDirectories[profileId]
        delete workingProjectIds[profileId]
      }
      update({ workingDirectories, workingProjectIds, mountedProjectIds: Object.fromEntries(current.profileIds.map(id => [id, id === profileId ? nextIds : mountedProjects(current, id)])) })
    },
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
    setFileEndpoints: fileEndpointIds => update({ fileEndpointIds }),
    setFilePermission: filePermission => update({ filePermission }),
    setRequireFileApproval: requireFileApproval => update({ requireFileApproval }),
    replace,
  }
}

export function emptyAccess(sessionId: string): InjectionView {
  return { sessionId, profileIds: [], permission: 'exec', requireCommandApproval: true, fileEndpointIds: [], filePermission: 'browse', requireFileApproval: true, workingDirectories: {}, workingProjectIds: {}, updatedAt: 0 }
}

function errorMessage(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason) }
