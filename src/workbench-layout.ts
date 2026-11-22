const sidebarSlot = '[data-slot="sidebar"]'
const conversationSlot = '[data-slot="main.conversation"], [data-slot="conversation"]'
const leadingSlot = '[data-shell-leading], [data-slot="shell.leading"]'

/** Close an overlay before selecting the main panel. Selection itself can close a host drawer. */
export function dismissWorkbenchSidebar(trigger: HTMLElement, toggle: () => void): void {
  const drawer = trigger.closest('[data-sidebar-drawer]')
  if (drawer) {
    if (!drawer.hasAttribute('data-sidebar-collapsed')) toggle()
    return
  }
  if (trigger.closest('[data-sidebar-collapsed]')) return
  let element = trigger.closest(sidebarSlot)
  while (element && !element.querySelector(conversationSlot)) {
    if (getComputedStyle(element).position === 'fixed') {
      toggle()
      return
    }
    element = element.parentElement
  }
}

/** Older hosts lack the clearance variable. Measure their visible rail controls while the desk is open. */
export function observeWorkbenchClearance(toolbar: HTMLElement): () => void {
  const workspace = toolbar.closest<HTMLElement>('.dsh-ssh-workspace')
  const back = toolbar.querySelector('.dsh-ssh-brand button')
  if (!workspace || !back) return () => {}
  let frame: HTMLElement | null = workspace.parentElement
  while (frame && !frame.querySelector(sidebarSlot)) frame = frame.parentElement
  if (!frame) return () => {}
  const hostFrame = frame
  const variable = '--ssh-workbench-leading-clearance'
  let animation = 0
  let watched: HTMLElement[] = []
  const measure = (): void => {
    animation = 0
    const style = getComputedStyle(workspace)
    const hostClearance = style.getPropertyValue('--dsh-frame-leading-clearance').trim()
    const hasHostClearance = Boolean(hostClearance) && hostClearance !== '0px' && hostClearance !== '0'
    const nodes = hasHostClearance ? [] : Array.from(hostFrame.querySelectorAll<HTMLElement>(leadingSlot))
    if (!hasHostClearance && hostFrame.hasAttribute('data-sidebar-collapsed')) {
      const sidebar = hostFrame.querySelector<HTMLElement>(sidebarSlot)
      if (sidebar) nodes.push(sidebar)
    }
    if (nodes.length !== watched.length || nodes.some((node, i) => node !== watched[i])) {
      for (const node of watched) sizes.unobserve(node)
      for (const node of nodes) sizes.observe(node)
      watched = nodes
    }
    const desk = workspace.getBoundingClientRect()
    const button = back.getBoundingClientRect()
    const rtl = style.direction === 'rtl'
    const previous = workspace.style.getPropertyValue(variable)
    const originalEnd = (rtl ? desk.right - button.left : button.right - desk.left) - (Number.parseFloat(previous) || 0)
    let clearance = 0
    for (const node of nodes) {
      for (const control of node.querySelectorAll<HTMLElement>('button, [role="button"]')) {
        if (control.closest('[inert]') || getComputedStyle(control).visibility !== 'visible') continue
        const rect = control.getBoundingClientRect()
        if (!rect.width || rect.bottom <= button.top || rect.top >= button.bottom) continue
        const start = rtl ? desk.right - rect.right : rect.left - desk.left
        const end = start + rect.width
        if (start < originalEnd && end > 0) clearance = Math.max(clearance, Math.ceil(end))
      }
    }
    const value = clearance ? `${clearance}px` : ''
    if (previous !== value) workspace.style.setProperty(variable, value)
  }
  const schedule = (): void => {
    if (!animation) animation = requestAnimationFrame(measure)
  }
  const sizes = new ResizeObserver(schedule)
  sizes.observe(workspace)
  const hostState = new MutationObserver(schedule)
  hostState.observe(hostFrame, { childList: true, attributes: true, attributeFilter: ['data-sidebar-collapsed', 'data-sidebar-drawer'] })
  window.addEventListener('resize', schedule)
  measure()
  return () => {
    cancelAnimationFrame(animation)
    sizes.disconnect()
    hostState.disconnect()
    window.removeEventListener('resize', schedule)
    workspace.style.removeProperty(variable)
  }
}
