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
  if (typeof input.name !== 'string' || typeof input.proxyId !== 'string') throw Object.assign(new Error('Group name and proxy selection are required'), { status: 400 })
  const name = input.name.trim(), proxyId = input.proxyId, now = Date.now()
  await store.update(state => {
    if (!state.profiles.some(profile => profile.group?.trim() === name)) throw Object.assign(new Error('SSH group no longer exists'), { status: 404 })
    const previous = state.groupProxies?.find(group => group.name === name)
    const next = parseGroupProxy({ id: groupProxyId(name), name, ...(proxyId ? { proxyId } : {}), createdAt: previous?.createdAt ?? now, updatedAt: now })
    state.groupProxies = [...(state.groupProxies ?? []).filter(group => group.name !== name), next]
  })
}
