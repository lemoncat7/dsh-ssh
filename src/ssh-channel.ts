import type { Client, ClientChannel } from 'ssh2'

/** Time out only this channel, never tear down another terminal's transport. */
export function openSshChannel(client: Client, timeoutMs: number, start: (done: (error: Error | undefined, channel: ClientChannel) => void) => void, signal?: AbortSignal): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', abort); client.off('close', close) }
    const fail = (error: unknown): void => { if (settled) return; settled = true; cleanup(); reject(error) }
    const abort = (): void => fail(signal?.reason ?? new Error('SSH channel opening was cancelled'))
    const close = (): void => fail(new Error('SSH connection closed while opening a channel'))
    const timer = setTimeout(() => fail(Object.assign(new Error('SSH channel opening timed out; the server may have reached its channel limit'), { code: 'SSH_CHANNEL_TIMEOUT' })), timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    client.once('close', close)
    if (signal?.aborted) { abort(); return }
    try {
      start((error, channel) => {
        if (settled) { channel?.destroy(); return }
        if (error) { fail(error); return }
        settled = true; cleanup(); resolve(channel)
      })
    } catch (error) { fail(error) }
  })
}
