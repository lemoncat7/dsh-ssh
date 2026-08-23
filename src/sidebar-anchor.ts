import { useEffect, type RefObject } from 'react'

/**
 * Place the plugin's official footer-slot contribution above Workspace without
 * replacing the single `sidebar.workspaces` slot. If the current sidebar shell
 * cannot be identified, the entry remains in the supported footer slot.
 */
export function useWorkspaceTopAnchor(ref: RefObject<HTMLElement>): void {
  useEffect(() => {
    const element = ref.current
    const originalParent = element?.parentElement
    if (element === null || element === undefined || originalParent === null || originalParent === undefined) return
    const parent = originalParent
    let moved = false
    let observer: MutationObserver | undefined
    const place = (): boolean => {
      // List-slot entries may be wrapped by the slot renderer. Walk out from
      // the entry until the preceding sibling is the flexible Workspace
      // region, instead of assuming the entry is a direct footer child.
      let ancestor: HTMLElement | null = element.parentElement
      while (ancestor !== null && ancestor !== document.body) {
        const candidate = ancestor.previousElementSibling
        if (candidate instanceof HTMLElement) {
          const style = getComputedStyle(candidate)
          const flexGrow = Number.parseFloat(style.flexGrow)
          if (style.display === 'flex' && style.flexDirection === 'column' && flexGrow > 0) {
            candidate.insertBefore(element, candidate.firstChild)
            element.dataset.dshSshAnchored = 'true'
            moved = true
            return true
          }
        }
        ancestor = ancestor.parentElement
      }
      return false
    }
    if (!place()) {
      observer = new MutationObserver(() => { if (place()) observer?.disconnect() })
      observer.observe(document.body, { childList: true, subtree: true })
    }
    return () => {
      observer?.disconnect()
      delete element.dataset.dshSshAnchored
      if (moved && parent.isConnected) parent.append(element)
    }
  }, [ref])
}
