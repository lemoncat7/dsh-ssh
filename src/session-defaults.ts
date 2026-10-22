import type { SessionInjection, SshSettings } from './domain.js'

/** Defaults select the execution mode; they never grant a host or filesystem. */
export function newSessionAccess(sessionId: string, settings: SshSettings): SessionInjection {
  return {
    sessionId, profileIds: [], fileEndpointIds: [], filePermission: 'browse',
    requireFileApproval: true,
    permission: settings.defaultSessionPermission === 'terminal' ? 'terminal' : 'exec',
    requireCommandApproval: settings.defaultRequireCommandApproval !== false,
    workingDirectories: {}, workingProjectIds: {}, updatedAt: 0,
  }
}
