/** Removes exact, uniquely tagged bootstrap echoes, never their execution output.
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
      const start = this.pending.indexOf(this.start)
      const completed = this.pending.indexOf(this.completed)
      if (completed >= 0 && (start < 0 || completed < start)) {
        output += this.pending.slice(0, completed) + this.pending.slice(completed + this.completed.length)
        this.pending = ''; this.done = true
        return output
      }
      if (start < 0) {
        // Retain only a possible marker prefix split between transport chunks.
        let keep = Math.min(Math.max(this.start.length, this.completed.length) - 1, this.pending.length)
        while (keep > 0 && !this.start.startsWith(this.pending.slice(-keep)) && !this.completed.startsWith(this.pending.slice(-keep))) keep--
        output += this.pending.slice(0, this.pending.length - keep)
        this.pending = this.pending.slice(this.pending.length - keep)
        return output
      }
      output += this.pending.slice(0, start)
      this.pending = this.pending.slice(start)
      const end = this.pending.indexOf(this.end, this.start.length)
      if (end < 0) return output + (this.pending.length > 65_536 ? this.flush() : '')
      const length = end + this.end.length
      const candidate = this.pending.slice(0, length)
      // PTYs may wrap with CR/LF and readline may insert CSI styling sequences.
      const normalized = candidate.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\r\n]/g, '')
      if (normalized !== this.command) return output + this.flush()
      this.pending = this.pending.slice(length)
    }
    return output
  }

  flush(): string {
    const text = this.pending
    this.pending = ''; this.done = true
    return text
  }
}
