import { credentialKey, type CredentialProvider, type GrantRecord } from '@deepseek-ai/dsh-credentials'
import { compactSecrets, type SshCredentialPayload } from './domain.js'

const SCOPE = 'dsh-ssh'
const FTP_SCOPE = 'dsh-ftp'
const VAULT_SCOPE = 'dsh-ssh-vault'
const PROXY_SCOPE = 'dsh-ssh-proxy'

export class SshCredentialVault {
  constructor(private readonly provider: CredentialProvider) {}

  async describe(profileId: string): Promise<{ configured: boolean; writable: boolean; fields: string[] }> {
    return this.describeScoped(SCOPE, profileId, 'credential')
  }

  async read(profileId: string): Promise<SshCredentialPayload> {
    return this.readScoped(SCOPE, profileId, 'credential')
  }

  async write(profileId: string, patch: SshCredentialPayload): Promise<void> {
    await this.writeScoped(SCOPE, profileId, 'credential', patch)
  }

  async replace(profileId: string, value: SshCredentialPayload): Promise<void> {
    await this.replaceScoped(SCOPE, profileId, value)
  }

  async delete(profileId: string): Promise<void> {
    await this.deleteScoped(SCOPE, profileId)
  }

  async describeFtp(profileId: string): Promise<{ configured: boolean; writable: boolean; fields: string[] }> {
    return this.describeScoped(FTP_SCOPE, profileId, 'FTP credential')
  }

  async readFtp(profileId: string): Promise<SshCredentialPayload> {
    return this.readScoped(FTP_SCOPE, profileId, 'FTP credential')
  }

  async writeFtp(profileId: string, patch: SshCredentialPayload): Promise<void> {
    await this.writeScoped(FTP_SCOPE, profileId, 'FTP credential', patch)
  }

  async replaceFtp(profileId: string, value: SshCredentialPayload): Promise<void> {
    await this.replaceScoped(FTP_SCOPE, profileId, value)
  }

  async deleteFtp(profileId: string): Promise<void> {
    await this.deleteScoped(FTP_SCOPE, profileId)
  }

  async describeEntry(entryId: string): Promise<{ configured: boolean; writable: boolean; fields: string[] }> {
    return this.describeScoped(VAULT_SCOPE, entryId, 'vault entry')
  }

  async readEntry(entryId: string): Promise<SshCredentialPayload> {
    return this.readScoped(VAULT_SCOPE, entryId, 'vault entry')
  }

  async writeEntry(entryId: string, patch: SshCredentialPayload): Promise<void> {
    await this.writeScoped(VAULT_SCOPE, entryId, 'vault entry', patch)
  }

  async replaceEntry(entryId: string, value: SshCredentialPayload): Promise<void> {
    await this.replaceScoped(VAULT_SCOPE, entryId, value)
  }

  async deleteEntry(entryId: string): Promise<void> {
    await this.deleteScoped(VAULT_SCOPE, entryId)
  }

  async describeProxyEntry(entryId: string): Promise<{ configured: boolean; writable: boolean; fields: string[] }> {
    return this.describeScoped(PROXY_SCOPE, entryId, 'proxy entry')
  }

  async readProxyEntry(entryId: string): Promise<SshCredentialPayload> {
    return this.readScoped(PROXY_SCOPE, entryId, 'proxy entry')
  }

  async writeProxyEntry(entryId: string, patch: SshCredentialPayload): Promise<void> {
    await this.writeScoped(PROXY_SCOPE, entryId, 'proxy entry', patch)
  }

  async replaceProxyEntry(entryId: string, value: SshCredentialPayload): Promise<void> {
    await this.replaceScoped(PROXY_SCOPE, entryId, value)
  }

  async deleteProxyEntry(entryId: string): Promise<void> {
    await this.deleteScoped(PROXY_SCOPE, entryId)
  }

  private async describeScoped(scope: string, id: string, label: string): Promise<{ configured: boolean; writable: boolean; fields: string[] }> {
    const info = await this.provider.describeRecord(credentialKey(scope, id))
    const payload = await this.readScoped(scope, id, label)
    return { configured: info.configured, writable: info.writable, fields: Object.keys(payload) }
  }

  private async readScoped(scope: string, id: string, label: string): Promise<SshCredentialPayload> {
    const record = await this.provider.readRecord(credentialKey(scope, id))
    if (record === undefined) return {}
    if (record.kind !== 'grant') throw new Error(`SSH ${label} ${id} has an incompatible record type`)
    return parsePayload(record.payload)
  }

  private async writeScoped(scope: string, id: string, label: string, patch: SshCredentialPayload): Promise<void> {
    const key = credentialKey(scope, id)
    await this.provider.modifyRecord(key, async current => {
      if (current !== undefined && current.kind !== 'grant') throw new Error(`SSH ${label} ${id} has an incompatible record type`)
      const previous = current === undefined ? {} : parsePayload(current.payload)
      return { kind: 'grant', payload: compactSecrets({ ...previous, ...patch }) } satisfies GrantRecord
    })
  }

  private async replaceScoped(scope: string, id: string, value: SshCredentialPayload): Promise<void> {
    await this.provider.modifyRecord(credentialKey(scope, id), async () => ({ kind: 'grant', payload: compactSecrets(value) }))
  }

  private async deleteScoped(scope: string, id: string): Promise<void> {
    await this.provider.deleteRecord(credentialKey(scope, id))
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
