/** A comparison-only view. Raw bytes are retained until an exact bootstrap match. */
function echoView(raw: string): { text: string; offsets: number[]; incomplete: number } {
  let text = '', incomplete = raw.length
  const offsets: number[] = []
  for (let i = 0; i < raw.length;) {
    // Readline can force a right-margin wrap by writing an extra blank then CR.
    // CRLF is an ordinary newline and must not consume a real preceding space.
    if (raw[i] === ' ' && raw[i + 1] === '\r') {
      if (i + 2 === raw.length) { incomplete = i; break }
      if (raw[i + 2] !== '\n') { i += 2; continue }
    }
    if (raw[i] === '\x1b') {
      const tail = raw.slice(i)
      const csi = /^\x1b\[[0-?]*[ -/]*[@-~]/.exec(tail)
      if (csi) { i += csi[0].length; continue }
      if (tail === '\x1b' || /^\x1b\[[0-?]*[ -/]*$/.test(tail)) { incomplete = i; break }
    }
    if (raw[i] !== '\r' && raw[i] !== '\n') { text += raw[i]; offsets.push(i) }
    i++
  }
  return { text, offsets, incomplete }
}

/** Removes only exact, uniquely tagged bootstrap echoes, never execution output.
 * A mismatch/timeout is fail-open: original bytes are displayed unchanged.
 */
export class TerminalBootstrapEcho {
  private pending = ''
  private done = false
  constructor(private readonly command: string, private readonly start: string, private readonly end: string, private readonly completed: string) {}

  push(text: string): string {
    if (this.done) return text
    this.pending += text
    let output = ''
    while (!this.done) {
      const view = echoView(this.pending)
      const start = view.text.indexOf(this.start)
      const completed = view.text.indexOf(this.completed)
      if (completed >= 0 && (start < 0 || completed < start)) {
        const begin = view.offsets[completed]!, end = view.offsets[completed + this.completed.length - 1]! + 1
        output += this.pending.slice(0, begin) + this.pending.slice(end)
        this.pending = ''; this.done = true
        return output
      }
      if (start < 0) {
        let keep = Math.min(Math.max(this.start.length, this.completed.length) - 1, view.text.length)
        while (keep > 0 && !this.start.startsWith(view.text.slice(-keep)) && !this.completed.startsWith(view.text.slice(-keep))) keep--
        const cutoff = keep ? view.offsets[view.text.length - keep]! : view.incomplete
        output += this.pending.slice(0, cutoff)
        this.pending = this.pending.slice(cutoff)
        return output
      }
      const begin = view.offsets[start]!
      const end = view.text.indexOf(this.end, start + this.start.length)
      if (end < 0) {
        output += this.pending.slice(0, begin); this.pending = this.pending.slice(begin)
        return output + (this.pending.length > 65_536 ? this.flush() : '')
      }
      if (view.text.slice(start, end + this.end.length) !== this.command) return output + this.flush()
      output += this.pending.slice(0, begin)
      this.pending = this.pending.slice(view.offsets[end + this.end.length - 1]! + 1)
    }
    return output
  }

  flush(): string {
    const text = this.pending
    this.pending = ''; this.done = true
    return text
  }
}
