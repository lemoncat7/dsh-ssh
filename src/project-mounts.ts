import type { RemoteProject, SessionInjection } from './domain.js'

type MountAccess = Pick<SessionInjection, 'workingProjectIds' | 'mountedProjectIds'>

/** Older clients used a single project as both mount and default directory. */
export function mountedProjects(access: MountAccess, profileId: string): string[] {
  return access.mountedProjectIds?.[profileId] ?? (access.workingProjectIds[profileId] ? [access.workingProjectIds[profileId]!] : [])
}

export function parseProjectMounts(value: unknown, profileIds: string[], projects: RemoteProject[]): Record<string, string[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid()
  const entries = Object.entries(value)
  if (entries.length > profileIds.length) throw invalid()
  const byId = new Map(projects.map(project => [project.id, project]))
  return Object.fromEntries(entries.map(([profileId, ids]) => {
    if (!profileIds.includes(profileId) || !Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string' || byId.get(id)?.profileId !== profileId)) throw invalid()
    return [profileId, [...new Set(ids)]]
  }))
}

function invalid(): Error { return Object.assign(new Error('挂载目录必须属于当前会话已授权的主机，每台最多 100 个'), { status: 400 }) }
