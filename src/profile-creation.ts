import {randomBytes} from 'node:crypto'
import {normalizeProfileDraft,normalizeFtpProfileDraft,normalizeSecrets,type SshProfile,type FtpProfile} from './domain.js'
import {findDuplicateProfileEndpoint} from './profile-endpoint.js'
import type {SshStore} from './store.js'
import type {SshCredentialVault} from './credentials.js'

/** Save configuration through the same transaction for browser and AI callers. */
export async function createSshProfile(store:SshStore,credentials:SshCredentialVault,input:unknown,secretInput:unknown):Promise<SshProfile> {
  const draft=normalizeProfileDraft(input),secrets=normalizeSecrets(secretInput),now=Date.now()
  const profile:SshProfile={...draft,id:createId('host'),port:draft.port??22,proxy:draft.proxy??{type:'none'},keepAliveIntervalMs:draft.keepAliveIntervalMs??15_000,connectTimeoutMs:draft.connectTimeoutMs??15_000,terminalType:draft.terminalType??'xterm-256color',tags:draft.tags??[],createdAt:now,updatedAt:now}
  if(profile.credentialId===undefined)await credentials.replace(profile.id,secrets)
  try {
    await store.update(state=>{
      const duplicate=findDuplicateProfileEndpoint(state.profiles,profile)
      if(duplicate)throw Object.assign(new Error(`该主机地址和端口已存在：${duplicate.name}`),{status:409,code:'DUPLICATE_PROFILE_ENDPOINT'})
      state.profiles.push(profile)
    })
  }catch(error){if(profile.credentialId===undefined)await credentials.delete(profile.id).catch(()=>{});throw error}
  return profile
}

/** FTP passwords remain in the credential provider, outside profile state. */
export async function createFtpProfile(store:SshStore,credentials:SshCredentialVault,input:unknown,secretInput:unknown):Promise<FtpProfile> {
  const draft=normalizeFtpProfileDraft(input),secrets=normalizeSecrets(secretInput),now=Date.now()
  if(draft.credentialId!==undefined){
    const entry=store.credentialEntry(draft.credentialId)
    if(!entry)throw Object.assign(new Error('credential entry was not found'),{status:404})
    if(entry.authType!=='password')throw Object.assign(new Error('FTP connections require a password credential'),{status:400})
  }
  if(draft.authMode!=='anonymous'&&draft.credentialId===undefined&&!secrets.password)throw Object.assign(new Error('FTP password is required'),{status:400})
  const profile:FtpProfile={...draft,id:createId('ftp'),port:draft.port??(draft.protocol==='ftps-implicit'?990:21),proxy:draft.proxy??{type:'none'},initialPath:draft.initialPath??'/',connectTimeoutMs:draft.connectTimeoutMs??15_000,createdAt:now,updatedAt:now}
  if(profile.authMode!=='anonymous'&&profile.credentialId===undefined)await credentials.replaceFtp(profile.id,{password:secrets.password!})
  try {await store.update(state=>{state.ftpProfiles.push(profile)})}
  catch(error){if(profile.credentialId===undefined)await credentials.deleteFtp(profile.id).catch(()=>{});throw error}
  return profile
}

function createId(prefix:string):string{return `${prefix}-${randomBytes(10).toString('hex')}`}
