export interface ProfileEndpoint {
  host: string
  port?: number | undefined
}

export interface StoredProfileEndpoint extends ProfileEndpoint {
  id: string
  name: string
}

/**
 * Compare saved SSH endpoints without doing DNS lookups. Host names are
 * case-insensitive, a trailing DNS root dot is insignificant, and bracketed
 * IPv6 literals refer to the same endpoint as their unbracketed form.
 */
export function profileEndpointKey(endpoint: ProfileEndpoint): string | undefined {
  const port = endpoint.port ?? 22
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) return undefined
  let host = endpoint.host.trim().normalize('NFKC').toLocaleLowerCase()
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  host = host.replace(/\.+$/u, '')
  return host.length === 0 ? undefined : `${host}\u0000${port}`
}

export function findDuplicateProfileEndpoint<T extends StoredProfileEndpoint>(
  profiles: readonly T[],
  endpoint: ProfileEndpoint,
  excludeId?: string,
): T | undefined {
  const key = profileEndpointKey(endpoint)
  if (key === undefined) return undefined
  return profiles.find(profile => profile.id !== excludeId && profileEndpointKey(profile) === key)
}
