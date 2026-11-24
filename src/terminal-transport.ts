import type { TerminalOutputDelta } from './client-api.js'

interface TerminalTransportEndpoints {
  isVisible?(): boolean
  streamUrl: string
  read(cursor: number): Promise<TerminalOutputDelta>
  send(text: string, sequence: number): Promise<void>
}

export interface TerminalObservation {
  (): void
  setVisible(visible: boolean): void
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

  observe(observer: TerminalOutputObserver, initiallyVisible = true, initialCursor = 0): TerminalObservation {
    let stopped = false
    let visible = initiallyVisible
    let cursor = initialCursor
    let generation = 0
    let source: EventSource | undefined
    let streamWatchdog: number | undefined
    let pollTimer: number | undefined
    let polling = false
    const clearConnection = (): void => {
      generation++
      source?.close()
      source = undefined
      if (streamWatchdog !== undefined) clearTimeout(streamWatchdog)
      if (pollTimer !== undefined) clearTimeout(pollTimer)
      streamWatchdog = pollTimer = undefined
      polling = false
    }
    const stop = (() => {
      if (stopped) return
      stopped = true
      clearConnection()
    }) as TerminalObservation
    const current = (epoch: number): boolean => !stopped && visible && generation === epoch
    const accept = (value: TerminalOutputDelta): void => {
      cursor = value.cursor
      observer.output(value)
      if (value.closed) stop()
    }
    const start = (): void => {
      if (stopped || !visible) return
      const epoch = generation
      let streamConfirmed = false
      const poll = async (): Promise<void> => {
        if (!current(epoch)) return
        try {
          const value = await this.endpoints.read(cursor)
          if (!current(epoch)) return
          accept(value)
          if (current(epoch)) pollTimer = window.setTimeout(() => { void poll() }, document.hidden || this.endpoints.isVisible?.() === false ? 1000 : value.data ? 16 : 64)
        } catch (reason) {
          if (!current(epoch)) return
          observer.error(reason)
          pollTimer = window.setTimeout(() => { void poll() }, 500)
        }
      }
      const startPolling = (): void => {
        if (!current(epoch) || polling) return
        polling = true
        source?.close()
        source = undefined
        if (streamWatchdog !== undefined) clearTimeout(streamWatchdog)
        streamWatchdog = undefined
        void poll()
      }
      if (typeof EventSource === 'undefined') { startPolling(); return }
      // Native SSE retries use Last-Event-ID; visibility resumes need the saved cursor too.
      const url = new URL(this.endpoints.streamUrl, window.location.href)
      url.searchParams.set('cursor', String(cursor))
      const connection = new EventSource(url.toString())
      source = connection
      connection.onmessage = event => {
        if (!current(epoch) || source !== connection) return
        try {
          const value = parseOutput(event.data)
          streamConfirmed = true
          if (streamWatchdog !== undefined) clearTimeout(streamWatchdog)
          streamWatchdog = undefined
          accept(value)
        } catch (reason) {
          observer.error(reason)
          startPolling()
        }
      }
      connection.onerror = () => {
        if (!current(epoch) || source !== connection) return
        if (streamWatchdog !== undefined) clearTimeout(streamWatchdog)
        streamWatchdog = window.setTimeout(startPolling, 1500)
      }
      streamWatchdog = window.setTimeout(() => {
        if (!streamConfirmed) startPolling()
      }, 1500)
    }
    stop.setVisible = next => {
      if (stopped || visible === next) return
      visible = next
      clearConnection()
      if (visible) start()
    }
    start()
    return stop
  }

  dispose(): void {
    this.disposed = true
    this.input = ''
  }

  private deliverInput(text: string, sequence: number, onError: (reason: unknown) => void, attempt = 0): void {
    if (this.disposed) return
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
