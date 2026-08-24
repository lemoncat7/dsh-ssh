const MAX_PENDING_INPUTS = 256

export interface TerminalOutputDelta {
  data: string
  cursor: number
  truncated: boolean
  closed: boolean
}

export type TerminalOutputListener = (output: TerminalOutputDelta) => void

/**
 * Cursor-addressable terminal scrollback with synchronous fan-out for live transports.
 * A subscriber can attach and immediately call read() without an output race because
 * both operations complete in the same JavaScript turn.
 */
export class TerminalOutputBuffer {
  private value = ''
  private baseCursor = 0
  private closed = false
  private readonly listeners = new Set<TerminalOutputListener>()

  constructor(
    private readonly trimThreshold: number,
    private readonly retainChars: number,
  ) {}

  append(text: string): void {
    if (!text) return
    this.value += text
    if (this.value.length > this.trimThreshold) {
      const removed = this.value.length - this.retainChars
      this.value = this.value.slice(removed)
      this.baseCursor += removed
    }
    this.emit({ data: text, cursor: this.cursor(), truncated: false, closed: false })
  }

  read(cursor: number): TerminalOutputDelta {
    const safeCursor = Math.max(cursor, this.baseCursor)
    return {
      data: this.value.slice(safeCursor - this.baseCursor),
      cursor: this.cursor(),
      truncated: cursor < this.baseCursor,
      closed: this.closed,
    }
  }

  text(): string { return this.value }

  isTruncated(): boolean { return this.baseCursor > 0 }

  subscribe(listener: TerminalOutputListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.emit({ data: '', cursor: this.cursor(), truncated: false, closed: true })
  }

  private cursor(): number { return this.baseCursor + this.value.length }

  private emit(output: TerminalOutputDelta): void {
    for (const listener of this.listeners) listener(output)
  }
}

/** Preserves keystroke order while allowing browser requests to travel concurrently. */
export class OrderedTerminalInput {
  private nextSequence = 0
  private readonly pending = new Map<number, string>()

  constructor(private readonly write: (text: string) => void) {}

  push(sequence: number | undefined, text: string): void {
    if (sequence === undefined) {
      this.write(text)
      return
    }
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > this.nextSequence + MAX_PENDING_INPUTS) {
      throw Object.assign(new Error('terminal input sequence is invalid'), { status: 400 })
    }
    if (sequence < this.nextSequence || this.pending.has(sequence)) return
    this.pending.set(sequence, text)
    while (this.pending.has(this.nextSequence)) {
      const next = this.pending.get(this.nextSequence)!
      this.pending.delete(this.nextSequence)
      this.nextSequence += 1
      this.write(next)
    }
  }
}
