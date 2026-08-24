import type { IncomingMessage, ServerResponse } from 'node:http'

const MAX_EVENT_HISTORY = 256

export interface TerminalOpenedEvent {
  type: 'terminal-opened'
  sessionId: string
  terminalId: string
  profileId: string
  createdAt: number
}

export interface ActivityEventEnvelope {
  id: number
  event: TerminalOpenedEvent
}

type ActivityEventListener = (event: ActivityEventEnvelope) => void

/** Owner-scoped event fan-out used only for immediate Web UI feedback. */
export class ActivityEventBus {
  private sequence = 0
  private readonly history: ActivityEventEnvelope[] = []
  private readonly listeners = new Map<string, Set<ActivityEventListener>>()

  currentId(): number { return this.sequence }

  publish(event: TerminalOpenedEvent): ActivityEventEnvelope {
    const envelope = { id: ++this.sequence, event }
    this.history.push(envelope)
    if (this.history.length > MAX_EVENT_HISTORY) this.history.splice(0, this.history.length - MAX_EVENT_HISTORY)
    for (const listener of this.listeners.get(event.sessionId) ?? []) {
      try { listener(envelope) } catch { /* A UI listener must never break terminal creation. */ }
    }
    return envelope
  }

  subscribe(sessionId: string, afterId: number, listener: ActivityEventListener): () => void {
    for (const envelope of this.history) {
      if (envelope.id > afterId && envelope.event.sessionId === sessionId) listener(envelope)
    }
    const owned = this.listeners.get(sessionId) ?? new Set<ActivityEventListener>()
    owned.add(listener)
    this.listeners.set(sessionId, owned)
    return () => {
      owned.delete(listener)
      if (owned.size === 0) this.listeners.delete(sessionId)
    }
  }
}

/** New subscribers start at "now"; EventSource reconnects replay missed events by Last-Event-ID. */
export function streamActivityEvents(
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
  events: ActivityEventBus,
): Promise<void> {
  const header = Array.isArray(req.headers['last-event-id']) ? req.headers['last-event-id'][0] : req.headers['last-event-id']
  const afterId = header === undefined ? events.currentId() : parseEventId(header)
  res.statusCode = 200
  res.setHeader('Cache-Control', 'no-cache, no-store, no-transform')
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.flushHeaders()

  return new Promise(resolve => {
    let finished = false
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let unsubscribe = (): void => {}
    const cleanup = (): void => {
      if (finished) return
      finished = true
      if (heartbeat !== undefined) clearInterval(heartbeat)
      unsubscribe()
      resolve()
    }
    const send = (envelope: ActivityEventEnvelope): void => {
      if (finished || res.destroyed || res.writableEnded) return cleanup()
      res.write(`id: ${envelope.id}\nevent: ${envelope.event.type}\ndata: ${JSON.stringify(envelope.event)}\n\n`)
    }

    res.once('close', cleanup)
    res.once('finish', cleanup)
    unsubscribe = events.subscribe(sessionId, afterId, send)
    res.write(`id: ${events.currentId()}\nevent: ready\ndata: {}\n\n`)
    heartbeat = setInterval(() => {
      if (!finished && !res.destroyed && !res.writableEnded) res.write(': keepalive\n\n')
    }, 15_000)
  })
}

function parseEventId(value: string): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id < 0) throw Object.assign(new Error('activity event cursor is invalid'), { status: 400 })
  return id
}
