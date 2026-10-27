import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scrypt } from 'node:crypto'
import { promisify } from 'node:util'
import type { SshStore } from './store.js'
import type { SshCredentialVault } from './credentials.js'
import { createEncryptedPortableSnapshot, decryptPortableSecrets, parsePortableSnapshot, type PortableSshSnapshot } from './gist-sync.js'
import { groupProxyId } from './group-proxy.js'

const derive = promisify(scrypt)
const FORMAT = 'dsh-ssh-backup'
const invalid = (message: string): Error => Object.assign(new Error(message), { status: 400 })
const LIMIT = 1_048_576
const collections = ['profiles', 'ftpProfiles', 'remoteProjects', 'credentialEntries', 'proxyEntries', 'commands', 'groupProxies'] as const
const emptyTombstones = () => ({ profiles: {}, ftpProfiles: {}, remoteProjects: {}, credentialEntries: {}, proxyEntries: {}, commands: {}, groupProxies: {} })
function password(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 256) throw invalid('备份密码需要 8–256 个字符')
  return value
}
function bounded(value: unknown): string {
  if (typeof value !== 'string' || Buffer.byteLength(value) > LIMIT) throw invalid('备份文件不能超过 1 MB')
  return value
}
export async function exportConfiguration(store: SshStore, vault: SshCredentialVault, passphrase: unknown): Promise<string> {
  const pass = password(passphrase), revision = store.workspaceRevision()
  const snapshot = await createEncryptedPortableSnapshot(store.snapshot(), randomUUID(), emptyTombstones(), vault, pass)
  if (revision !== store.workspaceRevision()) throw new Error('配置刚刚发生变化，请重新导出')
  // Authenticate and encrypt the entire file, including addresses and configuration metadata.
  const salt = randomBytes(16), iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', await derive(pass, salt, 32) as Buffer, iv)
  const plaintext = bounded(JSON.stringify(snapshot))
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return bounded(JSON.stringify({ format: FORMAT, version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }))
}
async function decode(content: unknown, passphrase: unknown): Promise<PortableSshSnapshot> {
  const pass = password(passphrase)
  let file: Record<string, unknown>
  try { file = JSON.parse(bounded(content)) as Record<string, unknown> } catch { throw invalid('备份文件格式不正确，或文件超过 1 MB') }
  if (!file || file.format !== FORMAT || file.version !== 1) throw invalid('不是受支持的 SSH 配置备份文件')
  const bytes = (key: string, length?: number): Buffer => {
    if (typeof file[key] !== 'string') throw invalid('备份文件格式不正确')
    const value = Buffer.from(file[key], 'base64')
    if (!value.length || value.toString('base64') !== file[key] || length !== undefined && value.length !== length) throw invalid('备份文件格式不正确')
    return value
  }
  const salt = bytes('salt', 16), iv = bytes('iv', 12), tag = bytes('tag', 16), ciphertext = bytes('ciphertext')
  let plaintext: string
  try {
    const decipher = createDecipheriv('aes-256-gcm', await derive(pass, salt, 32) as Buffer, iv)
    decipher.setAuthTag(tag)
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch { throw invalid('密码不正确，或备份文件已损坏') }
  return parsePortableSnapshot(plaintext)
}
export async function previewConfiguration(content: unknown, passphrase: unknown): Promise<Record<string, number>> {
  const snapshot = await decode(content, passphrase)
  await decryptPortableSecrets(snapshot, password(passphrase))
  return Object.fromEntries(collections.map(name => [name, snapshot.collections[name]?.length ?? 0]))
}
export async function importConfiguration(store: SshStore, vault: SshCredentialVault, content: unknown, passphrase: unknown): Promise<void> {
  const snapshot = await decode(content, passphrase)
  const secrets = await decryptPortableSecrets(snapshot, password(passphrase))
  const items = snapshot.collections
  // A fresh namespace preserves existing data and keeps every imported reference within its copy.
  const maps = Object.fromEntries(collections.map(name => [name, new Map((items[name] ?? []).map(item => [item.id, `import-${randomUUID()}`]))])) as Record<typeof collections[number], Map<string, string>>
  const ref = (name: typeof collections[number], id: string): string => {
    const result = maps[name].get(id)
    if (!result) throw invalid('备份中存在无效引用')
    return result
  }
  const groupNames = new Map<string, string>()
  const group = (name: string): string => {
    if (!groupNames.has(name)) groupNames.set(name, `${name.slice(0, 38)} (import ${randomBytes(8).toString('hex')})`)
    return groupNames.get(name)!
  }
  for (const profile of [...items.profiles, ...items.ftpProfiles]) {
    if (profile.credentialId) profile.credentialId = ref('credentialEntries', profile.credentialId)
    if (profile.proxy.type === 'saved') profile.proxy.proxyId = ref('proxyEntries', profile.proxy.proxyId)
    if (profile.proxy.type === 'jump') profile.proxy.profileIds = profile.proxy.profileIds.map(id => ref('profiles', id))
    if (profile.group) profile.group = group(profile.group)
  }
  for (const project of items.remoteProjects) project.profileId = ref('profiles', project.profileId)
  for (const entry of items.groupProxies ?? []) {
    entry.name = group(entry.name)
    maps.groupProxies.set(entry.id, groupProxyId(entry.name))
    if (entry.proxyId) entry.proxyId = ref('proxyEntries', entry.proxyId)
  }
  const scopes = {
    'ssh-profile': { name: 'profiles', write: vault.replace.bind(vault), remove: vault.delete.bind(vault) },
    'ftp-profile': { name: 'ftpProfiles', write: vault.replaceFtp.bind(vault), remove: vault.deleteFtp.bind(vault) },
    'vault-entry': { name: 'credentialEntries', write: vault.replaceEntry.bind(vault), remove: vault.deleteEntry.bind(vault) },
    'proxy-entry': { name: 'proxyEntries', write: vault.replaceProxyEntry.bind(vault), remove: vault.deleteProxyEntry.bind(vault) },
  } as const
  const cleanup: Array<() => Promise<void>> = []
  try {
    for (const record of snapshot.secrets) {
      const scope = scopes[record.scope], id = ref(scope.name, record.id)
      cleanup.push(() => scope.remove(id))
      await scope.write(id, secrets[`${record.scope}:${record.id}`]!)
    }
    const now = Date.now()
    for (const name of collections) for (const item of items[name] ?? []) {
      item.id = ref(name, item.id); item.createdAt = now; item.updatedAt = now
    }
    // Validate the remapped graph before publishing it to readers or automatic sync.
    parsePortableSnapshot(JSON.stringify({ ...snapshot, secrets: [] }))
    await store.update(state => {
      state.profiles.push(...items.profiles)
      state.ftpProfiles.push(...items.ftpProfiles)
      state.remoteProjects.push(...items.remoteProjects)
      state.credentialEntries.push(...items.credentialEntries)
      state.proxyEntries.push(...items.proxyEntries)
      state.commands = [...(state.commands ?? []), ...(items.commands ?? [])]
      state.groupProxies = [...(state.groupProxies ?? []), ...(items.groupProxies ?? [])]
    })
  } catch (error) {
    await Promise.allSettled(cleanup.map(remove => remove()))
    throw error
  }
}
