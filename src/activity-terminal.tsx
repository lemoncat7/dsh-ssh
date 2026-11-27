import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { activityTerminalStreamUrl, readActivityTerminalOutput, resizeActivityTerminal, sendActivityTerminalInput, type ActivityTerminalView } from './client-api.js'
import { TerminalTransport, type TerminalObservation } from './terminal-transport.js'
import { attachTerminalViewport, createSshTerminal } from './terminal-view.js'
import { TerminalViewCache } from './terminal-view-cache.js'
import { errorMessage } from './ui-components.js'
import { useSshLocale } from './use-ssh-locale.js'
import { t } from './i18n.js'

interface ActivityTerminalSurface {
  terminal: Terminal
  fit: FitAddon
  element: HTMLDivElement
  transport: TerminalTransport
  cursor: number
  visible: boolean
  disposed: boolean
  scrollTarget: number | undefined
  size: string | undefined
  stop: TerminalObservation | undefined
  disposeViewport: (() => void) | undefined
  dispose(): void
}

const views = new TerminalViewCache<ActivityTerminalSurface>(16)
const keyFor = (sessionId: string, terminalId: string, viewId?: string): string => JSON.stringify([sessionId, viewId ?? 'activity', terminalId])
export function disposeActivityTerminalViews(): void { views.clear() }
export function dropActivityTerminalView(sessionId: string, terminalId: string, viewId?: string): void { views.drop(keyFor(sessionId, terminalId, viewId)) }

function rememberScroll(view: ActivityTerminalSurface): void {
  if (view.disposed || view.scrollTarget !== undefined) return
  const buffer = view.terminal.buffer.active
  if (buffer.viewportY < buffer.baseY) view.scrollTarget = buffer.viewportY
}

/** Only the local surface is retained. Hidden/unmounted panels have no output subscription. */
export function InteractiveTerminal({ sessionId, viewId, terminal: activity, visible, onError }: { visible: boolean; sessionId: string; viewId?: string | undefined; terminal: ActivityTerminalView; onError(value: string | undefined): void }): JSX.Element {
  useSshLocale()
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<ActivityTerminalSurface>()
  const viewportRef = useRef<ReturnType<typeof attachTerminalViewport>>()
  const startRef = useRef<() => void>()
  const visibleRef = useRef(visible)
  const statusRef = useRef(activity.status.kind)
  const errorRef = useRef(onError)
  visibleRef.current = visible
  statusRef.current = activity.status.kind
  errorRef.current = onError

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let startFrame: number | undefined
    let restoreFrame: number | undefined
    let detach: (() => void) | undefined
    const start = (): void => {
      if (disposed || !visibleRef.current || viewRef.current || startFrame !== undefined) return
      // Yield the conversation commit, and skip StrictMode's temporary mount.
      startFrame = requestAnimationFrame(() => {
        startFrame = undefined
        if (disposed || !visibleRef.current) return
        const retained = views.acquire(keyFor(sessionId, activity.terminalId, viewId), () => {
          const element = document.createElement('div')
          element.style.width = element.style.height = '100%'
          host.append(element)
          const terminal = createSshTerminal({ compact: true, readOnly: statusRef.current !== 'running', scrollback: 4000 })
          const fit = new FitAddon()
          terminal.loadAddon(fit); terminal.open(element)
          const view: ActivityTerminalSurface = {
            terminal, fit, element, cursor: 0, visible: true, disposed: false, scrollTarget: undefined, size: undefined, stop: undefined, disposeViewport: undefined,
            transport: new TerminalTransport({
              isVisible: () => view.visible,
              streamUrl: activityTerminalStreamUrl(sessionId, activity.terminalId),
              read: cursor => readActivityTerminalOutput(sessionId, activity.terminalId, cursor),
              send: (text, sequence) => sendActivityTerminalInput(sessionId, activity.terminalId, text, sequence),
            }),
            dispose() {
              if (view.disposed) return
              view.disposed = true; view.stop?.(); view.disposeViewport?.(); view.transport.dispose(); terminal.dispose(); element.remove()
            },
          }
          return view
        })
        const view = retained.view, terminal = view.terminal
        viewRef.current = view
        view.visible = true
        terminal.options.disableStdin = statusRef.current !== 'running'
        host.append(view.element)
        const interacted = (): void => { view.scrollTarget = undefined }
        const events = ['wheel', 'pointerdown', 'touchstart', 'keydown']
        for (const name of events) host.addEventListener(name, interacted, { capture: true, passive: true })
        const rendered = terminal.onRender(() => {
          const desired = view.scrollTarget
          if (disposed || view.disposed || !view.visible || desired === undefined || restoreFrame !== undefined) return
          if (terminal.buffer.active.viewportY === Math.min(desired, terminal.buffer.active.baseY)) return
          restoreFrame = requestAnimationFrame(() => {
            restoreFrame = undefined
            if (!disposed && !view.disposed && view.visible && view.scrollTarget !== undefined) terminal.scrollToLine(Math.min(view.scrollTarget, terminal.buffer.active.baseY))
          })
        })
        const input = terminal.onData(data => view.transport.sendInput(data, reason => { if (!disposed) errorRef.current(errorMessage(reason)) }))
        const stop = view.transport.observe({
          output: value => {
            if (disposed || view.disposed) return
            view.cursor = value.cursor
            if (value.truncated) { view.scrollTarget = undefined; terminal.reset() }
            if (value.data) terminal.write(value.data)
            errorRef.current(undefined)
          },
          error: reason => { if (!disposed) errorRef.current(errorMessage(reason)) },
        }, true, view.cursor)
        view.stop = stop
        const viewport = attachTerminalViewport(host, terminal, view.fit, (cols, rows) => {
          const size = `${cols}x${rows}`
          if (view.size === size) return
          view.size = size
          void resizeActivityTerminal(sessionId, activity.terminalId, cols, rows).catch(reason => {
            if (view.size === size) view.size = undefined
            if (!disposed) errorRef.current(errorMessage(reason))
          })
        }, { preserveScroll: true })
        viewportRef.current = viewport
        view.disposeViewport = () => viewport.dispose()
        if (view.scrollTarget !== undefined) terminal.scrollToLine(view.scrollTarget)
        detach = () => {
          rememberScroll(view); view.visible = false
          stop(); view.stop = undefined; input.dispose(); rendered.dispose(); viewport.dispose(); view.disposeViewport = undefined
          for (const name of events) host.removeEventListener(name, interacted, true)
          if (!view.disposed) terminal.blur()
          view.element.remove(); retained.release()
        }
        if (view.visible) terminal.focus()
      })
    }
    startRef.current = start
    start()
    return () => {
      disposed = true
      if (startFrame !== undefined) cancelAnimationFrame(startFrame)
      if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame)
      detach?.()
      startRef.current = undefined; viewportRef.current = undefined; viewRef.current = undefined
    }
  }, [sessionId, activity.terminalId, viewId])

  useLayoutEffect(() => () => { if (viewRef.current) rememberScroll(viewRef.current) }, [sessionId, activity.terminalId, viewId])
  useLayoutEffect(() => {
    const view = viewRef.current
    if (view) view.visible = visible
    if (!visible) {
      if (view) { rememberScroll(view); view.stop?.setVisible(false) }
      return
    }
    startRef.current?.()
    const frame = requestAnimationFrame(() => {
      viewportRef.current?.fit()
      const current = viewRef.current
      if (current && !current.disposed && current.scrollTarget !== undefined) current.terminal.scrollToLine(current.scrollTarget)
      current?.stop?.setVisible(true)
    })
    return () => cancelAnimationFrame(frame)
  }, [visible])
  useEffect(() => { const view = viewRef.current; if (view && !view.disposed) view.terminal.options.disableStdin = activity.status.kind !== 'running' }, [activity.status.kind])

  return <div className="dsh-ssh-terminal-screen" aria-label={t('activity-panel.interactiveSshTerminal')}><div ref={hostRef} className="dsh-ssh-terminal-viewport" /></div>
}
