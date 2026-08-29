import { useId, useRef, type MouseEvent, type ReactNode } from 'react'
import { IconCloseOutline16, IconDataOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { BorderGlow } from './border-glow.js'
import { GlareHover } from './glare-hover.js'
import { useActiveControlMotion, useDialogMotion, useStaggeredEntrance } from './motion.js'

interface DialogProps {
  title: string
  subtitle?: string | undefined
  className?: string | undefined
  onClose(): void
  children: ReactNode
}

export function Dialog({ title, subtitle, className, onClose, children }: DialogProps): JSX.Element {
  const titleId = useId()
  const descriptionId = useId()
  const surfaceRef = useRef<HTMLElement>(null)
  const closeWithMotion = useDialogMotion(surfaceRef, onClose)
  const captureClose = (event: MouseEvent<HTMLElement>): void => {
    if (!(event.target instanceof Element) || event.target.closest('[data-ssh-dialog-close]') === null) return
    event.preventDefault()
    event.stopPropagation()
    closeWithMotion()
  }

  return <Modal open onClose={closeWithMotion} title={title} closeLabel="关闭" headless className={`dsh-ssh-dialog-modal${className === undefined ? '' : ` ${className}-modal`}`}>
    <BorderGlow>
      <GlareHover>
        <section ref={surfaceRef} className={`dsh-ssh-dialog dsh-ssh-scroll-surface${className === undefined ? '' : ` ${className}`}`} aria-labelledby={titleId} aria-describedby={subtitle === undefined ? undefined : descriptionId} onClickCapture={captureClose}>
          <header><span><h2 id={titleId}>{title}</h2>{subtitle && <p id={descriptionId}>{subtitle}</p>}</span><button type="button" className="dsh-ssh-icon-button" onClick={closeWithMotion} aria-label="关闭"><IconCloseOutline16 size={16} /></button></header>
          {children}
        </section>
      </GlareHover>
    </BorderGlow>
  </Modal>
}

export function Field({ label, hint, children }: { label: string; hint?: string | undefined; children: ReactNode }): JSX.Element {
  return <label className="dsh-ssh-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

export function Segment({ active, onClick, children }: { active: boolean; onClick(): void; children: ReactNode }): JSX.Element {
  const controlRef = useRef<HTMLButtonElement>(null)
  useActiveControlMotion(controlRef, active)
  return <button ref={controlRef} type="button" role="tab" data-ssh-interactive="choice" className={active ? 'is-active' : ''} aria-selected={active} onClick={onClick}>{children}</button>
}

export function EmptyState(): JSX.Element {
  const surfaceRef = useRef<HTMLDivElement>(null)
  useStaggeredEntrance(surfaceRef)
  return <div ref={surfaceRef} className="dsh-ssh-empty-state"><span><ServerGlyph /></span><h1>连接你的第一台远端主机</h1><p>使用“主机与项目”旁的添加按钮保存 SSH 配置，随后即可打开终端、建立端口转发，并按会话授权给 AI。</p></div>
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
