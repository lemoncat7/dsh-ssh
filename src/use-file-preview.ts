import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { SftpEntryView, SftpFilePreviewView } from './client-api.js'

/** One request at a time; only the active preview owns its polling lifecycle. */
export function useFilePreview(path: string, load: (path: string, signal?: AbortSignal) => Promise<SftpFilePreviewView>, stat: (path: string, signal?: AbortSignal) => Promise<SftpEntryView>, bodies: RefObject<HTMLDivElement>[]) {
  const [preview, setPreview] = useState<SftpFilePreviewView>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [locked, setLocked] = useState(false)
  const [revision, setRevision] = useState(0)
  const generation = useRef(0)
  const running = useRef(false)
  const request = useRef<AbortController>()
  const current = useRef<SftpFilePreviewView>()
  const signature = useRef<string>()
  const containers = useRef(bodies)
  containers.current = bodies
  const scroll = useRef<Array<{ node: HTMLElement; top: number; left: number }>>([])

  const refresh = useCallback(async (automatic = false) => {
    if (running.current) return
    const epoch = generation.current
    running.current = true
    setBusy(true)
    const controller = new AbortController()
    request.current = controller
    const timeout = setTimeout(() => controller.abort(), 30000)
    try {
      const meta = await stat(path, controller.signal)
      if (epoch !== generation.current) return
      if (meta.kind === 'directory') throw new Error('文件已变为目录，请返回目录重新打开')
      const stamp = `${meta.size}:${meta.modifiedAt}`
      if (automatic && current.current && stamp === signature.current) { setError(undefined); return }
      const next = await load(path, controller.signal)
      if (epoch !== generation.current) return
      const previous = current.current
      const changed = !previous || next.kind !== previous.kind || next.text !== previous.text || next.size !== previous.size || next.mimeType !== previous.mimeType || next.truncated !== previous.truncated
      // Capture at response time so scrolling during the request is respected.
      if (changed || next.kind !== 'text') {
        scroll.current = containers.current.flatMap(ref => ref.current ? [ref.current, ...ref.current.querySelectorAll<HTMLElement>('pre')].map(node => ({ node, top: node.scrollTop, left: node.scrollLeft })) : [])
        current.current = next
        setPreview(next)
        setRevision(value => value + 1)
      }
      signature.current = stamp
      setError(undefined)
    } catch (reason) {
      if (epoch === generation.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      clearTimeout(timeout)
      if (epoch === generation.current) { running.current = false; setBusy(false) }
    }
  }, [path, load, stat])

  useEffect(() => {
    generation.current++
    running.current = false; current.current = undefined; signature.current = undefined
    setPreview(undefined); setError(undefined); setLocked(false); setRevision(0)
    void refresh()
    return () => { generation.current++; request.current?.abort() }
  }, [refresh])

  useLayoutEffect(() => {
    for (const { node, top, left } of scroll.current) { node.scrollTop = top; node.scrollLeft = left }
    scroll.current = []
  }, [revision])

  useEffect(() => {
    if (!locked || preview?.kind === 'pdf') return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      const visible = !document.hidden && containers.current.some(ref => ref.current && ref.current.getClientRects().length > 0)
      if (visible) await refresh(true)
      if (!stopped) timer = setTimeout(tick, 5000)
    }
    timer = setTimeout(tick, 5000)
    return () => { stopped = true; clearTimeout(timer) }
  }, [locked, refresh, preview?.kind])

  return { preview, error, busy, locked, setLocked, refresh, revision }
}
