import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

const TERMINAL_THEME = {
  background: '#0c1212',
  foreground: '#d8e1de',
  cursor: '#82b9aa',
  cursorAccent: '#0c1212',
  selectionBackground: '#5f8f8366',
  black: '#0c1212',
  red: '#d18b84',
  green: '#82b39f',
  yellow: '#c4a66e',
  blue: '#82a9ba',
  magenta: '#aa96b2',
  cyan: '#7eb8b0',
  white: '#d8e1de',
  brightBlack: '#71817c',
  brightRed: '#e4a29b',
  brightGreen: '#a1cbb9',
  brightYellow: '#d8bd88',
  brightBlue: '#a1c4d2',
  brightMagenta: '#c1afc7',
  brightCyan: '#9bd0c8',
  brightWhite: '#f2f6f4',
} as const

export function createSshTerminal(options: { compact?: boolean; readOnly?: boolean; scrollback: number }): Terminal {
  return new Terminal({
    convertEol: true,
    cursorBlink: options.readOnly !== true,
    cursorInactiveStyle: 'outline',
    disableStdin: options.readOnly === true,
    fontFamily: '"SFMono-Regular", "Cascadia Code", "Liberation Mono", monospace',
    fontSize: options.compact === true ? 12 : 13,
    fontWeight: '400',
    fontWeightBold: '600',
    letterSpacing: 0,
    lineHeight: 1.25,
    scrollback: options.scrollback,
    theme: TERMINAL_THEME,
  })
}

export interface TerminalViewport {
  fit(): void
  dispose(): void
}

export function attachTerminalViewport(
  host: HTMLElement,
  terminal: Terminal,
  fitAddon: FitAddon,
  onSize?: (cols: number, rows: number) => void,
): TerminalViewport {
  let animationFrame: number | undefined
  let disposed = false
  let previousSize = ''

  const fit = (): void => {
    if (disposed || host.clientWidth === 0 || host.clientHeight === 0) return
    fitAddon.fit()
    terminal.scrollToBottom()
    const size = `${terminal.cols}x${terminal.rows}`
    if (size === previousSize) return
    previousSize = size
    onSize?.(terminal.cols, terminal.rows)
  }
  const scheduleFit = (): void => {
    if (animationFrame !== undefined) cancelAnimationFrame(animationFrame)
    animationFrame = requestAnimationFrame(() => {
      animationFrame = undefined
      fit()
    })
  }

  const resizeObserver = new ResizeObserver(scheduleFit)
  resizeObserver.observe(host)
  void document.fonts?.ready.then(scheduleFit).catch(() => {})
  scheduleFit()

  return {
    fit,
    dispose() {
      disposed = true
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
    },
  }
}
