import {defineTool,type ParameterSchemaSpec,type ToolDefinition} from '@deepseek-ai/dsh-tools'
import {normalizeProfileDraft,normalizeSecrets} from './domain.js'
import {createSshProfile,createFtpProfile} from './profile-creation.js'
import type {SshStore} from './store.js'
import type {SshCredentialVault} from './credentials.js'

export const PROFILE_CREATION_TOOLS=new Set(['ssh_profile_create','ftp_profile_create'])
const common={
  name:{type:'string',required:true,description:'Connection display name, 1–80 characters.'},
  host:{type:'string',required:true,description:'Server hostname or IP address, without a URL scheme.'},
  port:{type:'integer',description:'SSH defaults to 22; FTP/explicit FTPS to 21; implicit FTPS to 990.'},
  group:{type:'string',description:'Optional existing or new group name.'},
  tags:{type:'array',items:{type:'string'},description:'Optional connection tags.'},
  connectTimeoutMs:{type:'integer',description:'Connection timeout, 1000–120000 milliseconds.'},
  credentialId:{type:'string',description:'Optional exact existing credential-library ID explicitly supplied by the user. Never guess IDs. Otherwise provide connection-specific secrets.'},
} as const satisfies ParameterSchemaSpec
const secrets={
  password:{type:'string',description:'Connection password supplied by the user; saved in the credential provider, never returned.'},
  privateKey:{type:'string',description:'For SSH private-key authentication: the actual PEM key text, not a path.'},
  passphrase:{type:'string',description:'Optional SSH private-key passphrase.'},
  proxyPassword:{type:'string',description:'Optional inline SSH proxy password.'},
} as const satisfies ParameterSchemaSpec
const output={schema:{type:'string' as const},render:(_args:unknown,value:unknown)=>[{type:'text' as const,text:String(value)}]}

/** Creation saves configuration only; it does not connect or change session mounts. */
export function profileCreationTools(store:SshStore,credentials:SshCredentialVault):ToolDefinition[] {
  return [defineTool({
    name:'ssh_profile_create',
    description:'新增 SSH 主机 / Add a saved SSH host to the normal host list. Supports password, PEM private key or SSH agent authentication, grouping and proxies. Secrets use the existing credential provider and are never echoed. Saves only: no network connection, fingerprint trust or automatic session mount. Use existing mount/temporary-access authorization before commands or SFTP. Do not create a duplicate host and port.',
    parameters:{
      profile:{type:'object',required:true,additionalProperties:false,properties:{...common,
        username:{type:'string',required:true},authType:{type:'string',required:true,enum:['password','private-key','agent']},
        hostFingerprint:{type:'string',description:'Only an independently verified fingerprint supplied by the user; omit to keep first-connection verification.'},
        proxy:{type:'object',additionalProperties:false,properties:{type:{type:'string',required:true,enum:['none','saved','http','socks5','jump']},host:{type:'string'},port:{type:'integer'},username:{type:'string'},proxyId:{type:'string'},profileIds:{type:'array',items:{type:'string'}}}},
        keepAliveIntervalMs:{type:'integer'},terminalType:{type:'string'},useDefaultConnectTimeout:{type:'boolean'},
      }},
      secrets:{type:'object',additionalProperties:false,properties:secrets},
    },output,isConcurrencySafe:()=>false,
    presentCall:args=>({card:'terminal',title:`新增 SSH 主机 · ${args.profile.name}`}),
    async execute(args,exec){
      if(!exec.agent)throw new Error('创建主机需要所属 DSH 会话')
      exec.signal.throwIfAborted()
      const draft=normalizeProfileDraft(args.profile),secret=normalizeSecrets(args.secrets)
      if(draft.credentialId){
        const entry=store.credentialEntry(draft.credentialId)
        if(!entry||entry.authType!==draft.authType)throw new Error('所指定的凭据不存在或认证类型不匹配')
      }else if(draft.authType==='password'&&!secret.password||draft.authType==='private-key'&&!secret.privateKey){
        throw new Error('请提供所选认证方式的密码或私钥，或指定已有凭据 ID')
      }
      try {
        const profile=await createSshProfile(store,credentials,draft,secret)
        return JSON.stringify({created:true,profile,endpointId:`sftp:${profile.id}`,connected:false,mounted:false,next:'The host is saved in SSH management. Session access is unchanged; mount it or request authorized temporary access before use.'})
      }catch(error){
        if((error as {code?:string}).code==='DUPLICATE_PROFILE_ENDPOINT')throw Object.assign(new Error('该主机地址和端口已存在，未新增或修改连接'),{code:'DUPLICATE_PROFILE_ENDPOINT'})
        throw error
      }
    },
  }),defineTool({
    name:'ftp_profile_create',
    description:'新增 FTP/FTPS 连接 / Add a saved FTP or FTPS connection to the normal file-transfer connection list. Supports password or anonymous login, explicit/implicit TLS, groups and saved proxies. Passwords use the existing credential provider and are never returned. Saves only: no test connection or automatic session authorization; authorize the returned endpoint for browsing/transfer before use.',
    parameters:{
      profile:{type:'object',required:true,additionalProperties:false,properties:{...common,
        protocol:{type:'string',required:true,enum:['ftp','ftps-explicit','ftps-implicit']},
        authMode:{type:'string',enum:['password','anonymous'],description:'Defaults to password.'},
        username:{type:'string',description:'Required for password authentication; anonymous mode sets anonymous automatically.'},
        initialPath:{type:'string',description:'Initial remote directory; defaults to /.'},tlsServerName:{type:'string'},
        proxy:{type:'object',additionalProperties:false,properties:{type:{type:'string',required:true,enum:['none','saved']},proxyId:{type:'string'}}},
      }},
      secrets:{type:'object',additionalProperties:false,properties:{password:secrets.password!}},
    },output,isConcurrencySafe:()=>false,
    presentCall:args=>({card:'terminal',title:`新增 FTP 连接 · ${args.profile.name}`}),
    async execute(args,exec){
      if(!exec.agent)throw new Error('创建 FTP 连接需要所属 DSH 会话')
      exec.signal.throwIfAborted()
      const profile=await createFtpProfile(store,credentials,args.profile,args.secrets)
      return JSON.stringify({created:true,profile,endpointId:`ftp:${profile.id}`,connected:false,mounted:false,next:'The connection is saved in File Transfer. Session access is unchanged; authorize this endpoint before browsing or transfer.'})
    },
  })]
}
