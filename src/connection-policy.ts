import type { SshProfile, SshSettings } from './domain.js'

export const DEFAULT_CONNECT_TIMEOUT_MS = 15_000

/** Legacy custom values survive; the old implicit 15s default follows settings. */
export function usesDefaultConnectTimeout(profile: Pick<SshProfile, 'connectTimeoutMs' | 'useDefaultConnectTimeout'>): boolean {
  return profile.useDefaultConnectTimeout ?? profile.connectTimeoutMs === DEFAULT_CONNECT_TIMEOUT_MS
}

export function connectionProfile(profile: SshProfile, settings: SshSettings): SshProfile {
  return { ...profile, connectTimeoutMs: usesDefaultConnectTimeout(profile)
    ? settings.defaultConnectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS : profile.connectTimeoutMs }
}
