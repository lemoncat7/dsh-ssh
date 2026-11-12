import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkspaceTopAnchor } from '../src/sidebar-anchor.js'

class Boundary extends React.Component<React.PropsWithChildren, { error: string }> {
  state = { error: '' }
  static getDerivedStateFromError(error: Error) { return { error: error.message } }
  render() { return this.state.error ? <div data-crash>{this.state.error}</div> : this.props.children }
}
function Entry({ id, generation, wide }: { id: string; generation: number; wide: boolean }) {
  const [count, setCount] = useState(0)
  return <section data-entry={id} data-generation={generation}><button onClick={() => setCount(value => value + 1)}>{id}:{count}:{wide ? 'wide' : 'rail'}</button></section>
}
function NativeWorkspace() {
  const [count, setCount] = useState(0)
  return <button data-native onClick={() => setCount(value => value + 1)}>native:{count}</button>
}
function App() {
  const [state, setState] = useState({ entries: [{ id: 'partner', generation: 0 }, { id: 'ssh', generation: 0 }], visible: true, workspace: true, workspaceGeneration: 0, wide: true, wrapped: true })
  ;(window as any).configure = (next: Partial<typeof state>) => setState(previous => ({ ...previous, ...next }))
  return <Boundary>{state.visible && <aside data-slot="sidebar">
    <header>Native sidebar</header>
    {state.workspace && <div key={state.workspaceGeneration} data-workspaces style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}><NativeWorkspace /></div>}
    <footer><div data-slot="sidebar.footer.action">{state.entries.map(entry => {
      const body = <WorkspaceTopAnchor id={entry.id} order={entry.id === 'partner' ? -120 : -100}><Entry {...entry} wide={state.wide} /></WorkspaceTopAnchor>
      return state.wrapped ? <div key={entry.id + entry.generation}>{body}</div> : <React.Fragment key={entry.id + entry.generation}>{body}</React.Fragment>
    })}<button data-other-plugin>Other plugin</button></div></footer>
  </aside>}</Boundary>
}
const app = <App />
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('strict') ? <React.StrictMode>{app}</React.StrictMode> : app)
