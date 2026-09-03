import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface AdaptiveWorkspaceControls {
  closePanel(): void
  openPanel(panel: AdaptivePanel): void
}

type AdaptivePanel = 'navigation' | 'inspector'
type AdaptiveWorkspaceSlot = ReactNode | ((controls: AdaptiveWorkspaceControls) => ReactNode)

interface AdaptiveWorkspaceProps {
  className?: string
  toolbar?: ReactNode
  notice?: ReactNode
  navigation: AdaptiveWorkspaceSlot
  navigationLabel: string
  navigationIcon?: ReactNode
  inspector?: AdaptiveWorkspaceSlot
  inspectorLabel?: string
  inspectorIcon?: ReactNode
  children: ReactNode
}

export function AdaptiveWorkspace({ className, toolbar, notice, navigation, navigationLabel, navigationIcon, inspector, inspectorLabel = "Details", inspectorIcon, children }: AdaptiveWorkspaceProps): JSX.Element {
  const [panel, setPanel] = useState<AdaptivePanel>()
  const navigationRef = useRef<HTMLElement>(null)
  const inspectorRef = useRef<HTMLElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const closePanel = (): void => {
    setPanel(undefined)
    window.requestAnimationFrame(() => {
      const target = returnFocusRef.current
      if (target?.isConnected) target.focus()
    })
  }
  const controls: AdaptiveWorkspaceControls = {
    closePanel,
    openPanel: next => setPanel(next),
  }
  useEffect(() => {
    if (panel === undefined) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const target = panel === 'navigation' ? navigationRef.current : inspectorRef.current
    const initial = target?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')
    window.requestAnimationFrame(() => initial?.focus())
    const close = (event: KeyboardEvent): void => { if (event.key === 'Escape') closePanel() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [panel])
  return <main className={`dsh-ssh-adaptive-workspace${className === undefined ? '' : ` ${className}`}`} data-panel={panel ?? 'none'} data-has-inspector={inspector === undefined ? 'false' : 'true'}>
    {toolbar}
    {notice}
    <nav className="dsh-ssh-mobile-actions" aria-label="Workspace panel">
      <button type="button" data-ssh-interactive="choice" aria-pressed={panel === 'navigation'} aria-controls="dsh-ssh-adaptive-navigation" aria-expanded={panel === 'navigation'} onClick={() => panel === 'navigation' ? closePanel() : setPanel('navigation')}>{navigationIcon}<span>{navigationLabel}</span></button>
      {inspector !== undefined && <button type="button" data-ssh-interactive="choice" aria-pressed={panel === 'inspector'} aria-controls="dsh-ssh-adaptive-inspector" aria-expanded={panel === 'inspector'} onClick={() => panel === 'inspector' ? closePanel() : setPanel('inspector')}>{inspectorIcon}<span>{inspectorLabel}</span></button>}
    </nav>
    <div className="dsh-ssh-adaptive-shell">
      <aside ref={navigationRef} id="dsh-ssh-adaptive-navigation" className="dsh-ssh-adaptive-navigation" aria-label={navigationLabel}>{renderSlot(navigation, controls)}</aside>
      <section className="dsh-ssh-adaptive-content">{children}</section>
      {inspector !== undefined && <aside ref={inspectorRef} id="dsh-ssh-adaptive-inspector" className="dsh-ssh-adaptive-inspector" aria-label={inspectorLabel}>{renderSlot(inspector, controls)}</aside>}
      <button type="button" className="dsh-ssh-adaptive-backdrop" aria-label="Close panel" tabIndex={panel === undefined ? -1 : 0} onClick={closePanel} />
    </div>
  </main>
}

function renderSlot(slot: AdaptiveWorkspaceSlot, controls: AdaptiveWorkspaceControls): ReactNode {
  return typeof slot === 'function' ? slot(controls) : slot
}
