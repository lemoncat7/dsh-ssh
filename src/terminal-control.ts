/** Terminal input is not a verified POSIX process-group signal receipt.
 * These are the conventional PTY keys; raw mode or customized stty settings
 * may consume them as input instead of generating a signal.
 */
export const TERMINAL_CONTROL_SIGNALS = ['SIGINT', 'SIGQUIT', 'SIGTSTP'] as const
export type TerminalControlSignal = typeof TERMINAL_CONTROL_SIGNALS[number]
const bytes: Record<TerminalControlSignal, string> = { SIGINT: '\x03', SIGQUIT: '\x1c', SIGTSTP: '\x1a' }
export function terminalControlByte(signal: string): string {
  if (!Object.hasOwn(bytes, signal)) throw new Error('SSH cannot verify foreground process-group signals. Supported PTY keys: SIGINT (Ctrl-C), SIGQUIT (Ctrl-\\), SIGTSTP (Ctrl-Z). Use ssh_terminal_close to close the session.')
  return bytes[signal as TerminalControlSignal]
}
