import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { IconCloseOutline16, IconDataOutline16, IconPlusOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

interface DialogProps {
  title: string
  subtitle?: string | undefined
  onClose(): void
  children: ReactNode
}

export function Dialog({ title, subtitle, onClose, children }: DialogProps): JSX.Element {
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const panel = panelRef.current
    const initial = panel?.querySelector<HTMLElement>('[autofocus], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')
    initial?.focus()
    return () => {
      const target = returnFocusRef.current
      if (target?.isConnected) target.focus()
    }
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')).filter(control => control.getClientRects().length > 0)
    const first = controls[0]
    const last = controls.at(-1)
    if (first === undefined || last === undefined) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return <div className="dsh-ssh-dialog-layer" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={panelRef} className="dsh-ssh-dialog dsh-ssh-scroll-surface" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={subtitle === undefined ? undefined : descriptionId} onKeyDown={onKeyDown}>
      <header><span><h2 id={titleId}>{title}</h2>{subtitle && <p id={descriptionId}>{subtitle}</p>}</span><button type="button" className="dsh-ssh-icon-button" onClick={onClose} aria-label="关闭"><IconCloseOutline16 size={16} /></button></header>
      {children}
    </section>
  </div>
}

export function Field({ label, hint, children }: { label: string; hint?: string | undefined; children: ReactNode }): JSX.Element {
  return <label className="dsh-ssh-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

export function Segment({ active, onClick, children }: { active: boolean; onClick(): void; children: ReactNode }): JSX.Element {
  return <button type="button" role="tab" className={active ? 'is-active' : ''} aria-selected={active} onClick={onClick}>{children}</button>
}

export function EmptyState({ onNew }: { onNew(): void }): JSX.Element {
  return <div className="dsh-ssh-empty-state"><span><ServerGlyph /></span><h1>连接你的第一台远端主机</h1><p>保存 SSH 配置后，可以在这里打开终端、建立端口转发，并按会话授权给 AI。</p><button type="button" className="dsh-ssh-primary-button" onClick={onNew}><IconPlusOutline16 size={16} />新建连接</button></div>
}

export function ServerGlyph(): JSX.Element {
  return <span className="dsh-ssh-server-glyph"><IconDataOutline16 size={17} /></span>
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function shortId(id: string): string {
  return id.length <= 16 ? id : `${id.slice(0, 8)}…${id.slice(-5)}`
}
