import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SshProfile } from './domain.js'

/** Only human messages entered in this turn count; plugin notices and old chats do not. */
export function currentHumanText(events: readonly SessionEvent[], turn: number): string | undefined {
  let start = -1
  for (let i = events.length - 1; i >= 0; i--) { const e = events[i]; if (e?.type === 'turn/start' && e.data.turn === turn) { start = i; break } }
  if (start < 0) return undefined
  const entered = events.slice(start + 1).filter(e => {
    if (e.type !== 'user/message') return false
    const source: { kind: string; form?: string } = e.data.source
    return source.kind !== 'runtime-context' && source.form !== 'recall'
  })
  const latest = entered.at(-1)
  if (latest?.type !== 'user/message' || latest.data.source.kind !== 'user') return undefined
  return latest.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim()
}

export function hasName(text: string, name: string): boolean {
  if (!name.trim()) return false
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![a-z0-9_.-])${escaped}(?![a-z0-9_.-])`, 'iu').test(text)
}

/** Deliberately conservative. Ambiguity asks for a short human confirmation, not an LLM attestation. */
export function consentMatches(text: string | undefined, profile: SshProfile, recipient?: string): boolean {
  if (!text || text.length > 4000) return false
  // Do not treat quotations, questions, conditional statements or prohibitions as consent.
  if (/[?？`<>“”「」"'\n]|(?:不|没|未|勿|禁止|拒绝|撤销|取消|别|如果|假如|假设|是否|能否|为什么|如何|怎么|他说|原文|例如|比如|解释|说明|翻译|讨论|示例|举例|告诉我|请问|会不会|据说|声称)|\b(?:not|never|don't|if|example|said|revoke|cancel)\b/iu.test(text)) return false
  if (!/^(?:(?:我(?:明确)?(?:授权|允许|同意|让你|要你))|(?:请|麻烦|你|让|帮我|帮忙|到|去|授权|允许|同意|确认|可以)|临时(?:访问|授权|使用))/u.test(text.trim())) return false
  const host = [profile.name, profile.host, profile.id].some(name => hasName(text, name))
    || (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(profile.host) && new RegExp(`(?:到|去|连接|访问|主机)\\s*${profile.host.split('.').at(-1)}(?![0-9])`, 'u').test(text))
  if (!host || (recipient && !hasName(text, recipient))) return false
  return /(?:授权|允许|同意|确认|可以|临时访问|临时使用|帮我|请|去|到).*(?:SSH|访问|连接|执行|检查|查看|看看|操作|排查|安装|部署|运行|下载|修复|配置|更新|重启)|(?:授权|允许|同意|确认).*临时|^临时(?:授权|访问|使用)/iu.test(text)
}

export function confirmsPending(text: string | undefined): boolean {
  return !!text && /^(?:确认|同意|允许)(?:本次|这次)?(?:SSH\s*)?临时(?:访问|授权)(?:[，, ](?:按上述范围|仅限本次任务))?[。.!！\s]*$/iu.test(text.trim())
}
