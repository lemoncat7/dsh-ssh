import type { SshProfile } from './domain.js'

export interface HostMention {
  id: string
  name: string
  host: string
  port: number
  username: string
  group?: string
}

/** Discovery uses saved metadata only; never read credentials or dial a host. */
export function hostMention(profile: HostMention): HostMention {
  const { id, name, host, port, username, group } = profile
  return { id, name, host, port, username, ...(group ? { group } : {}) }
}

export function hostMentionAddress(host: HostMention): string {
  return `${host.username}@${host.host.includes(':') ? `[${host.host}]` : host.host}:${host.port}`
}

export function hostMentionText(host: HostMention): string {
  return `SSH 主机 ${JSON.stringify(host.name)}：${JSON.stringify(hostMentionAddress(host))}；profileId=${JSON.stringify(host.id)}`
}

export function searchHostMentions(profiles: SshProfile[], query: string): HostMention[] {
  const key = query.normalize('NFKC').trim().toLowerCase()
  const words = key.split(/\s+/).filter(Boolean)
  return profiles.map(profile => ({ profile, name: profile.name.normalize('NFKC').toLowerCase() }))
    .filter(({ profile, name }) => words.every(word => `${name} ${profile.host} ${profile.username} ${profile.group ?? ''}`.toLowerCase().includes(word)))
    .sort((a, b) => rank(a.profile, a.name, key) - rank(b.profile, b.name, key) || a.name.localeCompare(b.name) || a.profile.id.localeCompare(b.profile.id))
    .slice(0, 20).map(({ profile }) => hostMention(profile))
}

function rank(profile: SshProfile, name: string, key: string): number {
  if (name === key || profile.host.toLowerCase() === key) return 0
  return name.startsWith(key) || profile.host.toLowerCase().startsWith(key) ? 1 : 2
}
