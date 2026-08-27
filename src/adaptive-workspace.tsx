import { useEffect, useState, type ReactNode } from 'react'

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

export function AdaptiveWorkspace({ className, toolbar, notice, navigation, navigationLabel, navigationIcon, inspector, inspectorLabel = '详情', inspectorIcon, children }: AdaptiveWorkspaceProps): JSX.Element {
  const [panel, setPanel] = useState<AdaptivePanel>()
  const controls: AdaptiveWorkspaceControls = {
    closePanel: () => setPanel(undefined),
    openPanel: next => setPanel(next),
  }
  useEffect(() => {
    if (panel === undefined) return
    const close = (event: KeyboardEvent): void => { if (event.key === 'Escape') setPanel(undefined) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [panel])
  return <main className={`dsh-ssh-adaptive-workspace${className === undefined ? '' : ` ${className}`}`} data-panel={panel ?? 'none'} data-has-inspector={inspector === undefined ? 'false' : 'true'}>
    {toolbar}
    {notice}
    <nav className="dsh-ssh-mobile-actions" aria-label="工作区面板">
      <button type="button" aria-expanded={panel === 'navigation'} onClick={() => setPanel(current => current === 'navigation' ? undefined : 'navigation')}>{navigationIcon}<span>{navigationLabel}</span></button>
      {inspector !== undefined && <button type="button" aria-expanded={panel === 'inspector'} onClick={() => setPanel(current => current === 'inspector' ? undefined : 'inspector')}>{inspectorIcon}<span>{inspectorLabel}</span></button>}
    </nav>
    <div className="dsh-ssh-adaptive-shell">
      <aside className="dsh-ssh-adaptive-navigation" aria-label={navigationLabel}>{renderSlot(navigation, controls)}</aside>
      <section className="dsh-ssh-adaptive-content">{children}</section>
      {inspector !== undefined && <aside className="dsh-ssh-adaptive-inspector" aria-label={inspectorLabel}>{renderSlot(inspector, controls)}</aside>}
      <button type="button" className="dsh-ssh-adaptive-backdrop" aria-label="关闭面板" tabIndex={panel === undefined ? -1 : 0} onClick={() => setPanel(undefined)} />
    </div>
  </main>
}

function renderSlot(slot: AdaptiveWorkspaceSlot, controls: AdaptiveWorkspaceControls): ReactNode {
  return typeof slot === 'function' ? slot(controls) : slot
}
