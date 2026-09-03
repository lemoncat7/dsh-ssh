import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

const TERMINAL_THEME = {
  background: '#101719',
  foreground: '#e3eaeb',
  cursor: '#8aced0',
  cursorAccent: '#101719',
  selectionBackground: '#69b6ba40',
  black: '#101719',
  red: '#ff453a',
  green: '#30d158',
  yellow: '#ffd60a',
  blue: '#69b6ba',
  magenta: '#bf5af2',
  cyan: '#8aced0',
  white: '#d5dede',
  brightBlack: '#687a7e',
  brightRed: '#ff6961',
  brightGreen: '#66d47e',
  brightYellow: '#ffe45c',
  brightBlue: '#8aced0',
  brightMagenta: '#da8fff',
  brightCyan: '#b9e5e7',
  brightWhite: '#f1f5f5',
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
