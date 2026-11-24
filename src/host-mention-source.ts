import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { hostMention, hostMentionAddress, hostMentionText, type HostMention } from './host-mentions.js'
import { t } from './i18n.js'

export const HOST_MENTION_SOURCE = 'ssh-hosts'
const PATH = '/ssh-local/v1/host-mentions'
interface HostReference extends HostMention { sessionId: string }

/** The host owns candidate keyboard navigation and chips; this source only resolves metadata. */
export function createHostMentionSource(openHost: (id: string) => void, request: typeof fetch = fetch): InputTriggerSource {
  async function read(path: string, signal: AbortSignal): Promise<unknown> {
    const response = await request(path, { signal, headers: { accept: 'application/json' } })
    const body: unknown = await response.json()
    signal.throwIfAborted()
    if (!response.ok) throw new Error(isObject(body) && typeof body.error === 'string' ? body.error : t('mention.loadFailed'))
    return body
  }
  return {
    trigger: '@', name: HOST_MENTION_SOURCE, order: 25, showGroupTitle: false,
    async candidates(session, { query, quoted, drilled, signal }) {
      if (quoted || drilled || query.length > 255) return []
      await pause(150, signal)
      const body = await read(`${PATH}?${new URLSearchParams({ q: query.trim() })}`, signal)
      if (!isObject(body) || !Array.isArray(body.items)) throw new Error(t('mention.loadFailed'))
      return body.items.slice(0, 20).map((item: unknown) => {
        if (!isHost(item)) throw new Error(t('mention.loadFailed'))
        return {
          name: `${item.name} · ${hostMentionAddress(item)}`, section: t('mention.hosts'), description: hostMentionAddress(item) + (item.group ? ` · ${item.group}` : ''),
          value: JSON.stringify({ ...hostMention(item), sessionId: session.sessionId } satisfies HostReference),
        }
      })
    },
    onPick({ candidate, session, action }) {
      const host = parseReference(candidate.value)
      if (action !== 'pick' || !host || host.sessionId !== session.sessionId) return undefined
      return { insert: {
        source: HOST_MENTION_SOURCE, ref: candidate.value!, label: `${host.name} · ${host.host}`, appearance: 'file',
        clipboardText: hostMentionText(host),
      } }
    },
    openReference(session, { ref }) {
      const host = parseReference(ref)
      if (!host || host.sessionId !== session.sessionId) return false
      openHost(host.id)
      return true
    },
    codec: {
      clipboardText(ref) {
        const host = parseReference(ref)
        if (!host) throw new Error(t('mention.invalidReference'))
        return hostMentionText(host)
      },
      async serialize(ref, signal) {
        const host = parseReference(ref)
        if (!host) throw new Error(t('mention.invalidReference'))
        // Resolve the saved ID at send time: edits cannot leave the AI using a stale address.
        const body = await read(`${PATH}/${encodeURIComponent(host.id)}`, signal)
        if (!isObject(body) || typeof body.text !== 'string') throw new Error(t('mention.invalidReference'))
        return body.text
      },
    },
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function isHost(value: unknown): value is HostMention {
  return isObject(value) && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 100
    && typeof value.name === 'string' && value.name.length <= 200
    && typeof value.host === 'string' && value.host.length > 0 && value.host.length <= 255
    && typeof value.username === 'string' && value.username.length <= 200
    && typeof value.port === 'number' && Number.isInteger(value.port) && value.port > 0 && value.port <= 65535
    && (value.group === undefined || typeof value.group === 'string' && value.group.length <= 200)
}
function parseReference(raw: string | undefined): HostReference | undefined {
  if (!raw || raw.length > 4096) return undefined
  try {
    const value: unknown = JSON.parse(raw)
    if (isHost(value) && isObject(value) && typeof value.sessionId === 'string' && value.sessionId.length > 0) return value as unknown as HostReference
  } catch { /* Malformed or stale clipboard data never resolves to another host. */ }
  return undefined
}
function pause(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = (): void => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}
