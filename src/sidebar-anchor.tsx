import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Keep the official slot's React node in place. Only our private portal host moves. */
export function WorkspaceTopAnchor({ children, id, order }: { children: ReactNode; id: string; order: number }): JSX.Element {
  const placeholder = useRef<HTMLSpanElement>(null)
  const [target, setTarget] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const marker = placeholder.current
    if (marker === null) return
    const anchor = document.createElement('div')
    anchor.dataset.dshWorkspaceAnchor = id
    anchor.dataset.dshWorkspaceOrder = String(order)
    anchor.style.display = 'contents'
    const place = (): void => {
      // A temporarily detached sidebar must not attach an entry elsewhere.
      if (!marker.isConnected) return
      // rc2 wraps navigation + workspaces in another growing scroll region.
      // Anchor to the semantic workspace slot, never to layout heuristics:
      // entries belong below navigation (including More), above workspaces.
      const sidebar = marker.closest('[data-slot="sidebar"]')
      const parent = sidebar?.querySelector<HTMLElement>('[data-slot="sidebar.workspaces"]') ?? marker
      // Preserve both plugin order and the native Workspace subtree. A new
      // instance never adopts/removes an old instance's private portal host.
      const siblings = Array.from(parent.children)
      const before = parent === marker ? null : siblings.find(child =>
        child !== anchor && (!(child instanceof HTMLElement) || child.dataset.dshWorkspaceAnchor === undefined || Number(child.dataset.dshWorkspaceOrder) > order),
      ) ?? null
      if (anchor.parentElement === parent) {
        if (anchor.nextSibling === before) return
        const current = siblings.indexOf(anchor)
        const next = before === null ? siblings.length : siblings.indexOf(before)
        // Overlapping old/new instances with equal order retain their DOM
        // order instead of repeatedly moving past each other.
        if (current >= 0 && current < next && siblings.slice(current + 1, next).every(child =>
          child instanceof HTMLElement && child.dataset.dshWorkspaceAnchor !== undefined && Number(child.dataset.dshWorkspaceOrder) === order,
        )) return
      }
      parent.insertBefore(anchor, before)
    }
    place()
    setTarget(anchor)
    const observer = new MutationObserver(place)
    observer.observe(marker.closest('[data-slot="sidebar"]') ?? document.body, { childList: true, subtree: true })
    return () => { observer.disconnect(); anchor.remove() }
  }, [id, order])
  return <span ref={placeholder} style={{ display: 'contents' }}>{target === null ? null : createPortal(children, target)}</span>
}
