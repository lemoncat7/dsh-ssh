import type { SessionInjection } from './domain.js'

/** SFTP access follows mounted hosts; standalone grants only apply to FTP/FTPS. */
export function fileEndpointIds(access: Pick<SessionInjection, 'profileIds' | 'fileEndpointIds'>): string[] {
  return [...new Set([
    ...(access.profileIds ?? []).map(id => `sftp:${id}`),
    ...(access.fileEndpointIds ?? []).filter(id => id.startsWith('ftp:')),
  ])]
}

export function canTransferFiles(access: SessionInjection, endpointId: string): boolean {
  return fileEndpointIds(access).includes(endpointId) && (endpointId.startsWith('sftp:') || access.filePermission === 'transfer')
}

export function requiresFileApproval(access: SessionInjection, endpointId: string): boolean {
  return endpointId.startsWith('sftp:') ? access.requireCommandApproval !== false : access.requireFileApproval !== false
}
