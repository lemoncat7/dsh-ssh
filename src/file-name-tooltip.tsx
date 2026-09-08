import { useEffect, useId, useState, type ReactNode } from 'react'

/** One lightweight disclosure while hovered/focused; escapes scroll clipping. */
export function FileNameTooltip({ name, children }: { name: string; children: ReactNode }): JSX.Element {
  const id = useId()
  const [anchor, setAnchor] = useState<HTMLElement>()
  useEffect(() => {
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const tooltip = document.createElement('span')
    tooltip.id = id
    tooltip.role = 'tooltip'
    tooltip.className = 'dsh-ssh-file-name-tooltip'
    tooltip.textContent = name
    const theme = getComputedStyle(anchor)
    for (const token of ['--ssh-text', '--ssh-modal-surface', '--ssh-glass-border', '--ssh-font-sans']) tooltip.style.setProperty(token, theme.getPropertyValue(token))
    tooltip.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - Math.min(420, window.innerWidth - 16) - 8))}px`
    if (rect.top > window.innerHeight / 2) tooltip.style.bottom = `${window.innerHeight - rect.top + 6}px`
    else tooltip.style.top = `${rect.bottom + 6}px`
    document.body.append(tooltip)
    const close = (): void => setAnchor(undefined)
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', key)
    return () => { tooltip.remove(); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); window.removeEventListener('keydown', key) }
  }, [anchor, id, name])
  return <span className="dsh-ssh-file-name-disclosure" tabIndex={0} aria-describedby={anchor ? id : undefined}
    onPointerEnter={event => { if (event.pointerType !== 'touch') setAnchor(event.currentTarget) }}
    onPointerLeave={() => setAnchor(undefined)} onFocus={event => setAnchor(event.currentTarget)} onBlur={() => setAnchor(undefined)}
    onPointerDown={() => setAnchor(undefined)} onDragStart={() => setAnchor(undefined)}>
    {children}
  </span>
}
