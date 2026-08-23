import { credentialKey, type CredentialProvider, type GrantRecord } from '@deepseek-ai/dsh-credentials'
import { compactSecrets, type SshCredentialPayload } from './domain.js'

const SCOPE = 'dsh-ssh'

export class SshCredentialVault {
  constructor(private readonly provider: CredentialProvider) {}

  async describe(profileId: string): Promise<{ configured: boolean; writable: boolean; fields: string[] }> {
    const info = await this.provider.describeRecord(credentialKey(SCOPE, profileId))
    const payload = await this.read(profileId)
    return { configured: info.configured, writable: info.writable, fields: Object.keys(payload) }
  }

  async read(profileId: string): Promise<SshCredentialPayload> {
    const record = await this.provider.readRecord(credentialKey(SCOPE, profileId))
    if (record === undefined) return {}
    if (record.kind !== 'grant') throw new Error(`SSH credential ${profileId} has an incompatible record type`)
    return parsePayload(record.payload)
  }

  async write(profileId: string, patch: SshCredentialPayload): Promise<void> {
    const key = credentialKey(SCOPE, profileId)
    await this.provider.modifyRecord(key, async current => {
      if (current !== undefined && current.kind !== 'grant') throw new Error(`SSH credential ${profileId} has an incompatible record type`)
      const previous = current === undefined ? {} : parsePayload(current.payload)
      const payload = compactSecrets({ ...previous, ...patch })
      return { kind: 'grant', payload } satisfies GrantRecord
    })
  }

  async replace(profileId: string, value: SshCredentialPayload): Promise<void> {
    const payload = compactSecrets(value)
    await this.provider.modifyRecord(credentialKey(SCOPE, profileId), async () => ({ kind: 'grant', payload }))
  }

  async delete(profileId: string): Promise<void> {
    await this.provider.deleteRecord(credentialKey(SCOPE, profileId))
  }
}

function parsePayload(value: unknown): SshCredentialPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('stored SSH credential payload is invalid')
  const input = value as Record<string, unknown>
  const result: SshCredentialPayload = {}
  for (const field of ['password', 'privateKey', 'passphrase', 'proxyPassword'] as const) {
    const candidate = input[field]
    if (candidate !== undefined) {
      if (typeof candidate !== 'string' || candidate.length === 0) throw new Error(`stored SSH credential field ${field} is invalid`)
      result[field] = candidate
    }
  }
  return result
}
