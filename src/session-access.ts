import { useCallback, useEffect, useRef, useState } from 'react'
import { loadInjection, saveMountMode, saveSessionAccess, type InjectionView } from './client-api.js'
import type { MountMode } from './domain.js'
import { publishSessionAccess } from './session-access-channel.js'
import { mountedProjects, withMountedProfiles } from './project-mounts.js'

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
  setMountMode(workspaceId: string | null, mode: MountMode): Promise<InjectionView>
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
    setSaving(false)
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

  const commit = useCallback(async (
    id: string, save: () => Promise<InjectionView>, optimistic?: InjectionView,
  ): Promise<InjectionView> => {
    if (optimistic) {
      valueRef.current = optimistic
      setValue(optimistic)
      publishSessionAccess(optimistic)
    }
    setError(undefined)
    pendingRef.current += 1
    setSaving(true)
    const request = queueRef.current.catch(() => undefined).then(save)
    queueRef.current = request
    try {
      const stored = await request
      if (sessionRef.current === stored.sessionId) confirmedRef.current = stored
      if (sessionRef.current === stored.sessionId && queueRef.current === request) {
        valueRef.current = stored
        setValue(stored)
        publishSessionAccess(stored)
      }
      return stored
    } catch (reason) {
      if (optimistic && sessionRef.current === id) {
        setError(errorMessage(reason))
        if (queueRef.current === request && confirmedRef.current) {
          valueRef.current = confirmedRef.current
          setValue(confirmedRef.current)
          publishSessionAccess(confirmedRef.current)
        }
      }
      throw reason
    } finally {
      pendingRef.current = Math.max(0, pendingRef.current - 1)
      if (sessionRef.current === id && pendingRef.current === 0) setSaving(false)
    }
  }, [])

  const replace = useCallback((next: InjectionView): Promise<InjectionView> =>
    commit(next.sessionId, () => saveSessionAccess(next), next), [commit])

  const update = useCallback((patch: Partial<InjectionView>, changeMounts = false): void => {
    const currentSessionId = sessionRef.current
    if (currentSessionId === undefined) return
    const current = valueRef.current ?? emptyAccess(currentSessionId)
    if (changeMounts && current.mountMode === 'inherit') {
      const { mountSource, ...access } = current
      if (!mountSource) { setError('项目挂载信息已变化，请刷新后重试'); return }
      const next: InjectionView = { ...access, ...patch, sessionId: currentSessionId, mountMode: 'independent' }
      delete next.mountSource
      void commit(currentSessionId, () => saveSessionAccess(next, mountSource), next).catch(() => {})
      return
    }
    void replace({ ...current, ...patch, sessionId: currentSessionId }).catch(() => {})
  }, [commit, replace])

  return {
    value, loading, saving, error,
    setMountMode: (workspaceId, mode) => {
      const id = sessionRef.current
      if (id === undefined) return Promise.reject(new Error('No active SSH session'))
      return commit(id, () => saveMountMode(id, workspaceId, mode))
    },
    refresh: async () => {
      const id = sessionRef.current
      if (!id) return
      try {
        const pending = queueRef.current
        await pending.catch(() => {})
        if (id !== sessionRef.current || pending !== queueRef.current) return
        const current = valueRef.current
        const next = await loadInjection(id) ?? emptyAccess(id)
        if (id !== sessionRef.current || pending !== queueRef.current || current !== valueRef.current) return
        valueRef.current = next; confirmedRef.current = next; setValue(next); publishSessionAccess(next)
      } catch (reason) { if (id === sessionRef.current) setError(errorMessage(reason)) }
    },
    setProfiles: profileIds => {
      const current = valueRef.current
      if (current) update(withMountedProfiles(current, profileIds), true)
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
      update({ workingDirectories, workingProjectIds, mountedProjectIds: Object.fromEntries(current.profileIds.map(id => [id, id === profileId ? nextIds : mountedProjects(current, id)])) }, true)
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
      update({ workingDirectories, workingProjectIds }, true)
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
