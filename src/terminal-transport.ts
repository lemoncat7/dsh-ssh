import type { TerminalOutputDelta } from './client-api.js'

interface TerminalTransportEndpoints {
  streamUrl: string
  read(cursor: number): Promise<TerminalOutputDelta>
  send(text: string, sequence: number): Promise<void>
}

interface TerminalOutputObserver {
  output(value: TerminalOutputDelta): void
  error(reason: unknown): void
}

/**
 * Low-latency browser transport shared by the SSH panel and conversation activity.
 * SSE is the primary output path; cursor polling only starts when the stream cannot
 * pass through the current browser or reverse proxy.
 */
export class TerminalTransport {
  private input = ''
  private inputSequence = 0
  private inputScheduled = false
  private disposed = false

  constructor(private readonly endpoints: TerminalTransportEndpoints) {}

  sendInput(text: string, onError: (reason: unknown) => void): void {
    if (this.disposed || !text) return
    this.input += text
    if (this.inputScheduled) return
    this.inputScheduled = true
    queueMicrotask(() => {
      this.inputScheduled = false
      if (this.disposed) return
      const pending = this.input
      this.input = ''
      if (!pending) return
      const sequence = this.inputSequence++
      this.deliverInput(pending, sequence, onError)
    })
  }

  observe(observer: TerminalOutputObserver): () => void {
    let stopped = false
    let cursor = 0
    let source: EventSource | undefined
    let streamWatchdog: number | undefined
    let pollTimer: number | undefined
    let streamConfirmed = false

    const stop = (): void => {
      if (stopped) return
      stopped = true
      source?.close()
      if (streamWatchdog !== undefined) clearTimeout(streamWatchdog)
      if (pollTimer !== undefined) clearTimeout(pollTimer)
    }
    const accept = (value: TerminalOutputDelta): void => {
      if (stopped) return
      cursor = value.cursor
      observer.output(value)
      if (value.closed) stop()
    }
    const poll = async (): Promise<void> => {
      if (stopped) return
      try {
        const value = await this.endpoints.read(cursor)
        accept(value)
        if (!stopped) pollTimer = window.setTimeout(() => { void poll() }, document.hidden ? 500 : value.data ? 16 : 64)
      } catch (reason) {
        if (stopped) return
        observer.error(reason)
        pollTimer = window.setTimeout(() => { void poll() }, 500)
      }
    }
    const startPolling = (): void => {
      if (stopped || pollTimer !== undefined) return
      source?.close()
      source = undefined
      void poll()
    }

    if (typeof EventSource === 'undefined') {
      startPolling()
      return stop
    }

    source = new EventSource(this.endpoints.streamUrl)
    source.onmessage = event => {
      try {
        const value = parseOutput(event.data)
        streamConfirmed = true
        if (streamWatchdog !== undefined) {
          clearTimeout(streamWatchdog)
          streamWatchdog = undefined
        }
        accept(value)
      } catch (reason) {
        observer.error(reason)
        startPolling()
      }
    }
    source.onerror = () => {
      // A confirmed EventSource reconnects with Last-Event-ID and does not need a
      // competing poller. Before the first event, fall back if the proxy buffers SSE.
      if (!streamConfirmed && source?.readyState === EventSource.CLOSED) startPolling()
    }
    streamWatchdog = window.setTimeout(() => {
      if (!streamConfirmed) startPolling()
    }, 1_500)
    return stop
  }

  dispose(): void {
    this.disposed = true
    this.input = ''
  }

  private deliverInput(text: string, sequence: number, onError: (reason: unknown) => void, attempt = 0): void {
    void this.endpoints.send(text, sequence).catch(reason => {
      if (this.disposed) return
      if (attempt < 2 && isRetryable(reason)) {
        window.setTimeout(() => this.deliverInput(text, sequence, onError, attempt + 1), 60 * (attempt + 1))
        return
      }
      onError(reason)
    })
  }
}

function parseOutput(value: string): TerminalOutputDelta {
  const parsed = JSON.parse(value) as Partial<TerminalOutputDelta>
  if (
    typeof parsed.data !== 'string' ||
    typeof parsed.cursor !== 'number' ||
    !Number.isSafeInteger(parsed.cursor) ||
    parsed.cursor < 0 ||
    typeof parsed.truncated !== 'boolean' ||
    typeof parsed.closed !== 'boolean'
  ) throw new Error('SSH terminal stream returned an invalid event')
  return parsed as TerminalOutputDelta
}

function isRetryable(reason: unknown): boolean {
  if (typeof reason !== 'object' || reason === null || !('status' in reason)) return true
  const status = Number((reason as { status?: unknown }).status)
  return !Number.isFinite(status) || status >= 500
}
