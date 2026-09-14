import { useLayoutEffect, useRef, useState } from 'react'

/** Static, offline HTML only. The iframe additionally disables script execution. */
export function staticHtmlDocument(source: string): string {
  const doc = new DOMParser().parseFromString(source, 'text/html')
  doc.querySelectorAll('script, noscript, template, meta, base, link, iframe, frame, frameset, object, embed, portal, animate, animateMotion, animateTransform, set').forEach(node => node.remove())
  for (const node of doc.querySelectorAll('*')) {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith('on') || ['autofocus', 'target', 'formaction', 'action', 'srcdoc', 'nonce', 'is'].includes(name)
        || (['href', 'xlink:href'].includes(name) && !attribute.value.trim().startsWith('#'))) node.removeAttribute(attribute.name)
    }
  }
  const policy = doc.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
  doc.head.prepend(policy)
  return '<!doctype html>\n' + doc.documentElement.outerHTML
}

export function HtmlFilePreview({ text, name, truncated }: { text: string; name: string; truncated: boolean }): JSX.Element {
  const [source, setSource] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)
  const code = useRef<HTMLPreElement>(null)
  const position = useRef({ x: 0, y: 0 })
  const codePosition = useRef({ x: 0, y: 0 })
  const lastDocument = useRef<string>()

  useLayoutEffect(() => {
    const iframe = frame.current
    if (!iframe || lastDocument.current === text) return
    const view = iframe.contentWindow
    if (!source && lastDocument.current !== undefined && view) position.current = { x: view.scrollX, y: view.scrollY }
    lastDocument.current = text
    iframe.srcdoc = staticHtmlDocument(text)
  }, [text, source])

  useLayoutEffect(() => {
    if (code.current) { code.current.scrollTop = codePosition.current.y; code.current.scrollLeft = codePosition.current.x }
    if (!source) frame.current?.contentWindow?.scrollTo(position.current.x, position.current.y)
  }, [source, text])

  function toggle(): void {
    if (source && code.current) codePosition.current = { x: code.current.scrollLeft, y: code.current.scrollTop }
    if (!source && frame.current?.contentWindow) position.current = { x: frame.current.contentWindow.scrollX, y: frame.current.contentWindow.scrollY }
    setSource(value => !value)
  }

  return <section className="dsh-ssh-html-preview">
    <div className="dsh-ssh-html-preview-toolbar"><small title="静态隔离预览：不执行脚本，不加载外部或相对路径资源">HTML · {truncated ? '内容已截断' : '静态预览'}</small><button type="button" onClick={toggle} aria-pressed={source} aria-label="查看 HTML 源码">{source ? '页面' : '源码'}</button></div>
    <iframe ref={frame} hidden={source} title={`HTML 预览：${name}`} sandbox="allow-same-origin" referrerPolicy="no-referrer" onLoad={() => frame.current?.contentWindow?.scrollTo(position.current.x, position.current.y)} />
    {source && <pre ref={code} onScroll={event => { codePosition.current = { x: event.currentTarget.scrollLeft, y: event.currentTarget.scrollTop } }}>{text}</pre>}
  </section>
}
