/** Pane positions are stable; focus and tab selection never swap visible shells. */
export interface TerminalLayout { panes: number[]; focused: number }
export function selectTerminal(layout: TerminalLayout, id: number): TerminalLayout {
  if (layout.panes.includes(id)) return { ...layout, focused: id }
  const index = Math.max(0, layout.panes.indexOf(layout.focused))
  const panes = [...layout.panes]
  panes[index] = id
  return { panes, focused: id }
}
export function splitTerminal(layout: TerminalLayout, id: number): TerminalLayout {
  if (layout.panes.length >= 4 || layout.panes.includes(id)) return layout
  return { panes: [...layout.panes, id], focused: id }
}
export function closeTerminal(layout: TerminalLayout, id: number, remaining: number[]): TerminalLayout {
  const replacement = remaining.find(tab => !layout.panes.includes(tab))
  const panes = layout.panes.flatMap(tab => tab !== id ? [tab] : replacement === undefined ? [] : [replacement])
  return { panes, focused: panes.includes(layout.focused) ? layout.focused : replacement ?? panes[0] ?? 0 }
}
