import { createHash } from 'node:crypto'
import type { GroupProxy, ProxyConfig, SshProfile } from './domain.js'
import type { SshStore } from './store.js'

export function groupProxyId(name: string): string { return createHash('sha256').update(name).digest('hex') }

export function effectiveHostProxy(profile: Pick<SshProfile, 'proxy' | 'group'>, groups: GroupProxy[]): ProxyConfig {
  if (profile.proxy.type !== 'none') return profile.proxy
  const proxyId = groups.find(group => group.name === profile.group?.trim())?.proxyId
  return proxyId === undefined ? profile.proxy : { type: 'saved', proxyId }
}

export function parseGroupProxy(value: unknown): GroupProxy {
  const item = value as Partial<GroupProxy> | null
  if (!item || typeof item.name !== 'string' || !item.name.trim() || item.name !== item.name.trim() || item.name.length > 64 || /[\x00-\x1f\x7f]/.test(item.name)
    || item.id !== groupProxyId(item.name) || !Number.isSafeInteger(item.createdAt) || item.createdAt! < 0 || !Number.isSafeInteger(item.updatedAt) || item.updatedAt! < 0
    || (item.proxyId !== undefined && (typeof item.proxyId !== 'string' || !item.proxyId || item.proxyId.length > 100))) throw Object.assign(new Error('Invalid group proxy configuration'), { status: 400 })
  return { id: item.id, name: item.name, ...(item.proxyId === undefined ? {} : { proxyId: item.proxyId }), createdAt: item.createdAt!, updatedAt: item.updatedAt! }
}

export async function saveGroupProxy(store: SshStore, input: Record<string, unknown>): Promise<void> {
  if (input.resetHostProxies !== undefined && typeof input.resetHostProxies !== 'boolean') throw Object.assign(new Error('Invalid resetHostProxies'), { status: 400 })
  if (input.resetHostProxies === true && input.previousName === undefined) throw Object.assign(new Error('Reset requires an existing group'), { status: 400 })
  if (typeof input.proxyId !== 'string') throw Object.assign(new Error('Group name and proxy selection are required'), { status: 400 })
  const name = normalizeGroupName(input.name), previousName = input.previousName === undefined ? undefined : normalizeGroupName(input.previousName), proxyId = input.proxyId, now = Date.now()
  await store.update(state => {
    const sourceName = previousName ?? name
    const sourceExists = state.profiles.some(profile => profile.group?.trim() === sourceName) || state.groupProxies?.some(group => group.name === sourceName)
    if (previousName !== undefined && !sourceExists) throw Object.assign(new Error('SSH group no longer exists'), { status: 404 })
    const targetExists = state.profiles.some(profile => profile.group?.trim() === name && profile.group?.trim() !== sourceName)
      || state.groupProxies?.some(group => group.name === name && group.name !== sourceName)
    if (targetExists) throw Object.assign(new Error('SSH group name already exists'), { status: 409 })
    const previous = state.groupProxies?.find(group => group.name === sourceName)
    const next = parseGroupProxy({ id: groupProxyId(name), name, ...(proxyId ? { proxyId } : {}), createdAt: previous?.createdAt ?? now, updatedAt: now })
    state.profiles = state.profiles.map(profile => profile.group?.trim() === sourceName && (sourceName !== name || input.resetHostProxies === true)
      ? { ...profile, group: name, ...(input.resetHostProxies === true ? { proxy: { type: 'none' as const } } : {}), updatedAt: now } : profile)
    state.groupProxies = [...(state.groupProxies ?? []).filter(group => group.name !== sourceName && group.name !== name), next]
  })
}

export async function deleteGroup(store: SshStore, input: Record<string, unknown>): Promise<void> {
  const name = normalizeGroupName(input.name)
  await store.update(state => {
    if (!state.groupProxies?.some(group => group.name === name) && !state.profiles.some(profile => profile.group?.trim() === name)) throw Object.assign(new Error('SSH group no longer exists'), { status: 404 })
    state.groupProxies = (state.groupProxies ?? []).filter(group => group.name !== name)
    const now = Date.now()
    state.profiles = state.profiles.map(profile => profile.group?.trim() === name ? withoutGroup(profile, now) : profile)
  })
}

export async function moveProfileToGroup(store: SshStore, profileId: string, input: Record<string, unknown>): Promise<void> {
  if (typeof profileId !== 'string' || !profileId) throw Object.assign(new Error('Profile id is required'), { status: 400 })
  const group = input.group === null || input.group === undefined || input.group === '' ? undefined : normalizeGroupName(input.group)
  await store.update(state => {
    const profile = state.profiles.find(item => item.id === profileId)
    if (profile === undefined) throw Object.assign(new Error('SSH profile not found'), { status: 404 })
    if (group !== undefined && !state.profiles.some(item => item.group?.trim() === group) && !state.groupProxies?.some(item => item.name === group)) {
      throw Object.assign(new Error('SSH group no longer exists'), { status: 404 })
    }
    state.profiles = state.profiles.map(item => item.id !== profileId ? item : group === undefined
      ? withoutGroup(item, Date.now())
      : { ...item, group, updatedAt: Date.now() })
  })
}

function normalizeGroupName(value: unknown): string {
  if (typeof value !== 'string') throw Object.assign(new Error('Group name is required'), { status: 400 })
  const name = value.trim()
  if (!name || name !== value || name.length > 64 || /[\x00-\x1f\x7f]/.test(name)) throw Object.assign(new Error('Invalid SSH group name'), { status: 400 })
  return name
}

function withoutGroup(profile: SshProfile, updatedAt: number): SshProfile {
  const { group: _removed, ...next } = profile
  return { ...next, updatedAt }
}
