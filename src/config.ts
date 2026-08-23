import Schema from '@deepseek-ai/schemastery'

export interface Config {
  statePath: string
  exposeWeb: boolean
  apiPrefix: string
  defaultCommandTimeoutMs: number
  maxOutputChars: number
  allowPublicBind: boolean
}

export const Config: Schema<Config> = Schema.object({
  statePath: Schema.string().required(),
  exposeWeb: Schema.boolean().default(true),
  apiPrefix: Schema.string().default('/ssh-local/v1'),
  defaultCommandTimeoutMs: Schema.number().min(1000).max(300_000).default(30_000),
  maxOutputChars: Schema.number().min(1000).max(1_000_000).default(32_000),
  allowPublicBind: Schema.boolean().default(false),
})

export interface ResolvedConfig extends Config {}

export function resolveConfig(config: Config): ResolvedConfig {
  const apiPrefix = normalizePrefix(config.apiPrefix ?? '/ssh-local/v1')
  if (!config.statePath?.trim()) throw new Error('dsh-ssh requires statePath')
  return {
    statePath: config.statePath,
    exposeWeb: config.exposeWeb ?? true,
    apiPrefix,
    defaultCommandTimeoutMs: config.defaultCommandTimeoutMs ?? 30_000,
    maxOutputChars: config.maxOutputChars ?? 32_000,
    allowPublicBind: config.allowPublicBind ?? false,
  }
}

function normalizePrefix(value: string): string {
  const trimmed = value.trim()
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  const normalized = withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash
  if (!/^\/[a-zA-Z0-9/_-]+$/.test(normalized)) throw new Error('apiPrefix must be an absolute URL path')
  return normalized
}
