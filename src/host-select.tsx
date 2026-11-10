import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { profileAddress, type ProfileView } from './client-api.js'
import { t } from './i18n.js'
import { useSshLocale } from './use-ssh-locale.js'

/** Search selects a saved host by ID; typed text is never a connection target. */
export function HostSelect({ profiles, value, onChange, onEditingChange }: { profiles: ProfileView[]; value: string; onChange(id: string): void; onEditingChange?(editing: boolean): void }): JSX.Element {
  useSshLocale()
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const selected = profiles.find(profile => profile.id === value)
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  const matches = profiles.filter(profile => {
    const text = `${profile.name} ${profileAddress(profile)} ${profile.group ?? ''} ${profile.tags.join(' ')}`.toLocaleLowerCase()
    return words.every(word => text.includes(word))
  })
  const activeIndex = Math.min(active, Math.max(0, matches.length - 1))
  const dismiss = (): void => { setOpen(false); setQuery(''); onEditingChange?.(false) }
  const expand = (): void => { setQuery(''); setActive(Math.max(0, profiles.findIndex(profile => profile.id === value))); setOpen(true) }
  const choose = (profile: ProfileView): void => { onChange(profile.id); dismiss(); input.current?.focus() }
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent): void => { if (event.target instanceof Node && !root.current?.contains(event.target)) dismiss() }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open, onEditingChange])
  useLayoutEffect(() => {
    const element = menu.current
    if (!open || !element) return
    element.setAttribute('popover', 'manual')
    element.showPopover()
    const place = (): void => {
      const rect = input.current!.getBoundingClientRect()
      const below = window.innerHeight - rect.bottom - 10, above = rect.top - 10
      const upward = below < 180 && above > below
      element.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8))}px`
      element.style.width = `${Math.min(rect.width, window.innerWidth - 16)}px`
      element.style.maxHeight = `${Math.min(320, Math.max(80, upward ? above : below))}px`
      element.style.top = upward ? 'auto' : `${rect.bottom + 5}px`
      element.style.bottom = upward ? `${window.innerHeight - rect.top + 5}px` : 'auto'
    }
    place()
    const scroll = (event: Event): void => { if (!(event.target instanceof Node) || !element.contains(event.target)) place() }
    window.addEventListener('resize', place); document.addEventListener('scroll', scroll, true)
    return () => { window.removeEventListener('resize', place); document.removeEventListener('scroll', scroll, true); if (element.matches(':popover-open')) element.hidePopover() }
  }, [open])
  useEffect(() => { if (open) document.getElementById(`${id}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' }) }, [open, activeIndex, query, id])
  return <div className="dsh-ssh-host-select" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) dismiss() }}>
    <input ref={input} role="combobox" aria-label={t('client.host')} aria-autocomplete="list" aria-expanded={open} aria-controls={open ? id : undefined} aria-activedescendant={open && matches.length ? `${id}-${activeIndex}` : undefined} autoComplete="off" spellCheck={false} placeholder={t('host-select.search')} value={open ? query : selected ? `${selected.name} · ${profileAddress(selected)}` : ''} onFocus={expand} onClick={() => { if (!open) expand() }} onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true); onEditingChange?.(true) }} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (!open) expand(); else setActive((activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % Math.max(1, matches.length)) }
      else if (event.key === 'Enter' && open) { event.preventDefault(); if (matches[activeIndex]) choose(matches[activeIndex]!) }
      else if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); dismiss() }
      else if (event.key === 'Tab') dismiss()
    }} />
    <button type="button" className="dsh-ssh-host-select-toggle" tabIndex={-1} aria-label={t('host-select.show')} aria-expanded={open} onPointerDown={event => event.preventDefault()} onClick={() => { if (open) dismiss(); else { input.current?.focus(); expand() } }}><IconChevronDownOutlineRegular size={15} /></button>
    {open && <div ref={menu} id={id} role="listbox" aria-label={t('host-select.matches')} className="dsh-ssh-host-options dsh-ssh-scroll-surface" onMouseDown={event => event.preventDefault()}>
      {matches.length ? matches.map((profile, index) => <button type="button" role="option" tabIndex={-1} id={`${id}-${index}`} key={profile.id} aria-selected={profile.id === value} data-active={index === activeIndex} onPointerMove={() => setActive(index)} onClick={() => choose(profile)}><span><strong>{profile.name}</strong><small>{profileAddress(profile)}</small></span>{profile.group && <em>{profile.group}</em>}</button>) : <p role="status">{profiles.length ? t('host-select.noMatches') : t('host-select.empty')}</p>}
    </div>}
  </div>
}
