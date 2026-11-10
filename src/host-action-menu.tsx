import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'

/** Keep SSH-owned tokens while escaping clipping and external stacking contexts. */
export function HostActionMenu({ anchor, label, children, onKeyDown }: { anchor: HTMLElement | null; label: string; children: ReactNode; onKeyDown(event: KeyboardEvent<HTMLElement>): void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu || !anchor) return
    menu.setAttribute('popover', 'manual')
    menu.showPopover()
    const place = (): void => {
      const rect = anchor.getBoundingClientRect()
      const width = menu.offsetWidth, height = menu.offsetHeight
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
      const top = rect.bottom + height + 6 <= window.innerHeight - 8 ? rect.bottom + 6 : Math.max(8, rect.top - height - 6)
      menu.style.left = `${left}px`; menu.style.top = `${top}px`
    }
    place()
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
    window.addEventListener('resize', place)
    document.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); document.removeEventListener('scroll', place, true); if (menu.matches(':popover-open')) menu.hidePopover() }
  }, [anchor])
  return <div ref={ref} className="dsh-ssh-tree-menu dsh-ssh-host-popover" role="menu" aria-label={label} onKeyDown={onKeyDown}>{children}</div>
}

export function TerminalActionIcon(): JSX.Element {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 6 6 6-6 6m9 0h7" /></svg>
}
