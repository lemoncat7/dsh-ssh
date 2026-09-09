import { useState, type ReactNode } from 'react'
import { IconCloseOutline16, IconPlusOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ProfileView } from './client-api.js'
import { TerminalSession } from './terminal-session.js'
import { closeTerminal, selectTerminal, splitTerminal, type TerminalLayout } from './terminal-layout.js'
import { Dialog } from './ui-components.js'

interface TerminalTab { id: number; path: string }
export function TerminalWorkspace({ profile, path, onConnected }: { profile: ProfileView; path: string; onConnected(): void }): JSX.Element {
  const [tabs, setTabs] = useState<TerminalTab[]>([{ id: 1, path }])
  const [serial, setSerial] = useState(1)
  const [view, setView] = useState<TerminalLayout>({ panes: [1], focused: 1 })
  const [direction, setDirection] = useState<'horizontal' | 'vertical'>('horizontal')
  const [closing, setClosing] = useState<number>()
  const [controls, setControls] = useState<ReactNode>(null)
  const choose = (id: number): void => setView(current => selectTerminal(current, id))
  const add = (split = false): void => {
    if (tabs.length >= 8 || (split && view.panes.length >= 4)) return
    const id = serial + 1
    setSerial(id)
    setTabs(current => [...current, { id, path }])
    setView(current => split ? splitTerminal(current, id) : selectTerminal(current, id))
  }
  const addSplit = (): void => {
    if (view.panes.length >= 4) return
    const other = tabs.find(tab => !view.panes.includes(tab.id))
    if (other) setView(current => splitTerminal(current, other.id))
    else add(true)
  }
  const orient = (next: 'horizontal' | 'vertical'): void => {
    setDirection(next)
    if (view.panes.length < 2) addSplit()
  }
  const count = view.panes.length
  return <div className="dsh-ssh-terminal-workspace">
    <div className="dsh-ssh-terminal-tabbar">
      <div className="dsh-ssh-terminal-tabs" role="tablist" aria-label={`${profile.name} 终端标签`}>
        {tabs.map(tab => <span key={tab.id} className={`dsh-ssh-terminal-tab${view.focused === tab.id ? ' is-active' : ''}`} data-ssh-interactive="choice">
          <button type="button" role="tab" aria-selected={view.focused === tab.id} aria-controls={`ssh-terminal-${profile.id}-${tab.id}`} title={`终端 ${tab.id}${view.panes.includes(tab.id) ? ` · 窗格 ${view.panes.indexOf(tab.id) + 1}` : ' · 在当前窗格打开'}`} onClick={() => choose(tab.id)} onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const index = tabs.findIndex(item => item.id === tab.id)
            const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
            const next = tabs[nextIndex]
            if (next) { choose(next.id); event.currentTarget.parentElement?.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus() }
          }}>终端 {tab.id}</button>
          <button type="button" aria-label={`关闭终端 ${tab.id}`} title="关闭终端" onClick={() => setClosing(tab.id)}><IconCloseOutline16 size={13} /></button>
        </span>)}
      </div>
      <button type="button" className="dsh-ssh-icon-button" disabled={tabs.length >= 8} title={tabs.length >= 8 ? '每台主机最多 8 个标签' : '新建终端标签'} aria-label="新建终端标签" onClick={() => add()}><IconPlusOutline16 size={16} /></button>
      <div className="dsh-ssh-terminal-layout-actions" role="group" aria-label="终端布局">
        {count < 3 && <>
          <button type="button" className="dsh-ssh-icon-button" aria-label="左右分屏" title="左右分屏" aria-pressed={count === 2 && direction === 'horizontal'} disabled={!count} onClick={() => orient('horizontal')}><SplitIcon direction="horizontal" /></button>
          <button type="button" className="dsh-ssh-icon-button" aria-label="上下分屏" title="上下分屏" aria-pressed={count === 2 && direction === 'vertical'} disabled={!count} onClick={() => orient('vertical')}><SplitIcon direction="vertical" /></button>
        </>}
        {count >= 2 && <button type="button" className="dsh-ssh-icon-button" aria-label="增加分屏" title={count >= 4 ? '最多 4 个分屏' : '增加分屏，最多 4 个'} disabled={count >= 4} onClick={addSplit}><SplitIcon direction="grid" /></button>}
        {count > 1 && <button type="button" className="dsh-ssh-icon-button" aria-label="单屏" title="仅显示当前终端，其他连接保留" onClick={() => setView(current => ({ panes: [current.focused], focused: current.focused }))}><SplitIcon /></button>}
      </div>
      <div className="dsh-ssh-terminal-session-actions" role="group" aria-label={`终端 ${view.focused} 操作`}>{controls}</div>
    </div>
    <div className={`dsh-ssh-terminal-panes${count > 2 ? ' is-grid' : count === 2 ? ` is-split is-${direction}` : ''}`}>
      {tabs.map(tab => <section key={tab.id} id={`ssh-terminal-${profile.id}-${tab.id}`} aria-label={`终端 ${tab.id}`} className="dsh-ssh-terminal-slot" hidden={!view.panes.includes(tab.id)} style={{ order: view.panes.indexOf(tab.id) }} data-focused={view.focused === tab.id} onPointerDown={() => setView(current => ({ ...current, focused: tab.id }))} onFocusCapture={() => setView(current => ({ ...current, focused: tab.id }))}>
        <TerminalSession profile={profile} path={tab.path} label={`终端 ${tab.id}`} onControls={view.focused === tab.id ? setControls : undefined} onConnected={onConnected} />
      </section>)}
      {tabs.length === 0 && <div className="dsh-ssh-command-empty"><p>所有终端均已关闭。</p><button type="button" className="dsh-ssh-primary-button" onClick={() => add()}>新建终端</button></div>}
    </div>
    {closing !== undefined && <Dialog title={`关闭终端 ${closing}？`} subtitle="关闭将断开此标签的 SSH 连接，可能中断正在运行的命令。" onClose={() => setClosing(undefined)}><div className="dsh-ssh-dialog-actions"><button type="button" className="dsh-ssh-secondary-button" onClick={() => setClosing(undefined)}>取消</button><button type="button" className="dsh-ssh-danger-button" onClick={() => {
      const rest = tabs.filter(tab => tab.id !== closing)
      setTabs(rest)
      setView(current => closeTerminal(current, closing, rest.map(tab => tab.id)))
      setClosing(undefined)
    }}>关闭连接</button></div></Dialog>}
  </div>
}

function SplitIcon({ direction }: { direction?: 'horizontal' | 'vertical' | 'grid' }): JSX.Element {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5" />{(direction === 'horizontal' || direction === 'grid') && <path d="M8 3v10" />}{(direction === 'vertical' || direction === 'grid') && <path d="M2.5 8h11" />}</svg>
}
