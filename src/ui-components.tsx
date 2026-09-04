import {
  useEffect, useId, useMemo, useRef, useState,
  type InputHTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactNode,
} from 'react'
import { IconCheckOutline14, IconChevronDownOutline14, IconCloseOutline16, IconDataOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
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

  return <Modal open onClose={closeWithMotion} title={title} headless className={`dsh-ssh-dialog-modal${className === undefined ? '' : ` ${className}-modal`}`}>
    <section ref={surfaceRef} className={`dsh-ssh-dialog dsh-ssh-scroll-surface${className === undefined ? '' : ` ${className}`}`} aria-labelledby={titleId} aria-describedby={subtitle === undefined ? undefined : descriptionId} onClickCapture={captureClose}>
      <header><span><h2 id={titleId}>{title}</h2>{subtitle && <p id={descriptionId}>{subtitle}</p>}</span><button type="button" className="dsh-ssh-icon-button" onClick={closeWithMotion} aria-label="关闭"><IconCloseOutline16 size={16} /></button></header>
      {children}
    </section>
  </Modal>
}

export function Field({ label, hint, children }: { label: string; hint?: string | undefined; children: ReactNode }): JSX.Element {
  return <label className="dsh-ssh-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

interface SuggestionInputProps {
  value: string
  options: string[]
  placeholder?: string | undefined
  maxLength?: number | undefined
  multiple?: boolean | undefined
  ariaLabel: string
  onChange(value: string): void
}

/** A fully styled combobox that keeps free-form values while reusing existing metadata. */
export function SuggestionInput({ value, options, placeholder, maxLength, multiple = false, ariaLabel, onChange }: SuggestionInputProps): JSX.Element {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const suppressFocusOpenRef = useRef(false)
  const normalizedOptions = useMemo(() => dedupeLabels(options).sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })), [options])
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const selected = useMemo(() => multiple ? splitLabels(value) : value.trim() ? [value.trim()] : [], [multiple, value])
  const filtered = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase()
    return normalizedOptions.filter(option => (!multiple || !selected.some(item => sameLabel(item, option)))
      && (query.length === 0 || option.toLocaleLowerCase().includes(query)))
  }, [filter, multiple, normalizedOptions, selected])

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  useEffect(() => { setActiveIndex(current => Math.min(current, Math.max(0, filtered.length - 1))) }, [filtered.length])

  const choose = (option: string): void => {
    if (!multiple) onChange(option)
    else {
      const parts = splitLabels(value)
      const replaceDraft = filter.trim().length > 0 && parts.length > 0
      onChange(dedupeLabels([...(replaceDraft ? parts.slice(0, -1) : parts), option]).join(', '))
    }
    setFilter('')
    setOpen(false)
    if (document.activeElement !== inputRef.current) {
      suppressFocusOpenRef.current = true
      inputRef.current?.focus()
    }
  }
  const keyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) { setOpen(true); setActiveIndex(0); return }
      const offset = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex(current => (current + offset + filtered.length) % Math.max(1, filtered.length))
    } else if (event.key === 'Enter' && open && filtered[activeIndex] !== undefined) {
      event.preventDefault(); choose(filtered[activeIndex]!)
    } else if (event.key === 'Escape' && open) {
      event.preventDefault(); setOpen(false)
    }
  }
  const changed = (next: string): void => {
    onChange(next)
    setFilter(multiple ? next.split(/[,，]/u).at(-1)?.trim() ?? '' : next)
    setActiveIndex(0)
    setOpen(true)
  }

  return <div ref={rootRef} className={`dsh-ssh-suggestion-input${open ? ' is-open' : ''}`}>
    <input
      ref={inputRef}
      role="combobox"
      aria-label={ariaLabel}
      aria-autocomplete="list"
      aria-expanded={open}
      aria-controls={listId}
      aria-activedescendant={open && filtered[activeIndex] !== undefined ? `${listId}-${activeIndex}` : undefined}
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={event => changed(event.target.value)}
      onFocus={() => {
        if (suppressFocusOpenRef.current) { suppressFocusOpenRef.current = false; return }
        setFilter(multiple ? '' : value)
        if (normalizedOptions.length > 0) setOpen(true)
      }}
      onKeyDown={keyDown}
    />
    <button
      type="button"
      className="dsh-ssh-suggestion-toggle"
      aria-label={`${open ? '收起' : '展开'}${ariaLabel}已有选项`}
      aria-expanded={open}
      onClick={() => {
        if (open) { setOpen(false); return }
        setFilter(''); setActiveIndex(0); setOpen(true); inputRef.current?.focus()
      }}
    ><IconChevronDownOutline14 size={14} /></button>
    {open && <div id={listId} className="dsh-ssh-suggestion-menu dsh-ssh-scroll-surface" role="listbox" aria-label={`${ariaLabel}已有选项`}>
      {filtered.length === 0 ? <p>{normalizedOptions.length === 0 ? '暂无已有选项，可直接输入' : '没有匹配项，可直接输入新内容'}</p>
        : filtered.map((option, index) => <button
          id={`${listId}-${index}`}
          type="button"
          role="option"
          aria-selected={!multiple && sameLabel(value, option)}
          className={index === activeIndex ? 'is-active' : ''}
          key={option}
          onPointerMove={() => setActiveIndex(index)}
          onClick={() => choose(option)}
        ><span>{option}</span>{!multiple && sameLabel(value, option) && <IconCheckOutline14 size={14} />}</button>)}
    </div>}
  </div>
}

export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>): JSX.Element {
  const [visible, setVisible] = useState(false)
  return <div className="dsh-ssh-password-input">
    <input {...props} type={visible ? 'text' : 'password'} />
    <button type="button" aria-label={visible ? '隐藏密码' : '显示密码'} aria-pressed={visible} onClick={() => setVisible(current => !current)}>{visible ? '隐藏' : '显示'}</button>
  </div>
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

function splitLabels(value: string): string[] { return dedupeLabels(value.split(/[,，]/u)) }
function sameLabel(left: string, right: string): boolean { return left.trim().localeCompare(right.trim(), undefined, { sensitivity: 'accent' }) === 0 }
function dedupeLabels(values: string[]): string[] {
  const result = new Map<string, string>()
  for (const raw of values) {
    const value = raw.trim()
    if (value.length > 0 && !result.has(value.toLocaleLowerCase())) result.set(value.toLocaleLowerCase(), value)
  }
  return [...result.values()]
}
