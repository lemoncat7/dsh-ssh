/** Explicit, host-specific directory aliases. Only browser initial/follow paths use these mappings. */
export interface SftpPathMapping { terminal: string; sftp: string }
export function normalizeSftpPathMappings(value: unknown): SftpPathMapping[] {
  if (!Array.isArray(value) || value.length > 32) throw Object.assign(new Error('sftpPathMappings must contain at most 32 mappings'), {status:400})
  const seen = new Set<string>()
  return value.map(item => {
    const result = {} as SftpPathMapping
    for (const key of ['terminal','sftp'] as const) {
      const path = item?.[key]
      if (typeof path !== 'string' || !path.startsWith('/') || path.length > 4096 || /[\x00-\x1f\x7f]/.test(path) || path.split('/').some(part => part === '.' || part === '..')) throw Object.assign(new Error('Directory mappings require absolute paths without traversal'), {status:400})
      result[key] = path.replace(/\/+$/, '') || '/'
    }
    if (seen.has(result.terminal)) throw Object.assign(new Error('Duplicate terminal directory mapping'), {status:400})
    seen.add(result.terminal)
    return result
  })
}
export function mapTerminalSftpPath(value: string, mappings: readonly SftpPathMapping[] = []): string {
  if (!value.startsWith('/') || value.split('/').some(part => part === '.' || part === '..')) return value
  const match = [...mappings].sort((a,b) => b.terminal.length-a.terminal.length).find(item => value === item.terminal || value.startsWith(item.terminal === '/' ? '/' : item.terminal + '/'))
  if (!match) return value
  const suffix = value.slice(match.terminal === '/' ? 1 : match.terminal.length).replace(/^\//, '')
  return (match.sftp === '/' ? '' : match.sftp) + (suffix ? '/' + suffix : '') || '/'
}
export function parseSftpPathMappings(text: string): SftpPathMapping[] {
  return normalizeSftpPathMappings(text.split('\n').filter(line=>line.trim()).map(line=>{
    const split=line.indexOf('=>')
    if(split<0)throw Object.assign(new Error('Use terminal path => SFTP path'),{status:400})
    return {terminal:line.slice(0,split).trim(),sftp:line.slice(split+2).trim()}
  }))
}
