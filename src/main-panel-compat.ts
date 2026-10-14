import { useEffect } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Keep host-version differences at the navigation boundary, not in pages. */
export function registerMainPanel(
  ctx: Context,
  id: string,
  priority: number,
  render: (props: PropsRuntime<'conversation'>) => JSX.Element,
  onHidden: () => void = () => {},
): () => void {
  const layout = ctx.layout as unknown as { selectPanel?: (id: string | null) => void }
  if (typeof layout.selectPanel !== 'function') {
    return ctx.slots.register({ name: 'conversation', priority }, render)
  }
  // SSH manages the current session's mounts. Use its conversation seat,
  // not a global main panel (which deliberately clears sidebar selection).
  const slots = ctx.slots as unknown as {
    inject(name: string, effect: () => () => void): () => void
    register(options: { name: 'main.conversation'; priority: number }, component: typeof render): () => void
  }
  let disposed = false
  let generation = 0
  const Body = (props: PropsRuntime<'conversation'>): JSX.Element => {
    useEffect(() => {
      const current = ++generation
      return () => {
        // Ignore StrictMode's effect replay and our own explicit removal.
        queueMicrotask(() => { if (!disposed && generation === current) onHidden() })
      }
    }, [])
    return render(props)
  }
  const remove = slots.inject('main.conversation', () => slots.register({ name: 'main.conversation', priority }, Body))
  const dispose = (): void => { if (disposed) return; disposed = true; remove() }
  try { layout.selectPanel(null) } catch (error) { dispose(); throw error }
  // Removing our override restores the conversation. Never navigate during
  // disposal, which could close another plugin's newer panel.
  return dispose
}
