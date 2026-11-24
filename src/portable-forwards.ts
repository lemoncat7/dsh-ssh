import { normalizeForwardDraft, type ForwardRule, type SshProfile } from './domain.js'

/** Only the definition travels. Each DSH instance owns startup and open listeners. */
export function portableForward(rule: ForwardRule): ForwardRule {
  const draft = normalizeForwardDraft({ ...rule, autoStart: false })
  return { ...draft, bindHost: draft.bindHost ?? '127.0.0.1', autoStart: false, id: rule.id, createdAt: rule.createdAt, updatedAt: rule.updatedAt }
}

export function forwardRoute(rule: ForwardRule): string {
  return JSON.stringify([rule.profileId, rule.kind, rule.bindHost, rule.bindPort, ...(rule.kind === 'dynamic' ? [] : [rule.targetHost, rule.targetPort])])
}

export function restoreForwardPreferences(rules: ForwardRule[], previous: ForwardRule[]): ForwardRule[] {
  const local = new Map(previous.map(rule => [rule.id, rule]))
  return rules.map(rule => {
    const old = local.get(rule.id)
    return { ...rule, autoStart: old?.autoStart === true && forwardRoute(old) === forwardRoute(rule) }
  })
}

export function forwardHostEndpoint(profile: SshProfile | undefined): string {
  return JSON.stringify(profile ? [profile.host, profile.port ?? 22, profile.username] : null)
}
