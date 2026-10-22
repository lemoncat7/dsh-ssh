import { useEffect, useRef, useState } from 'react'

/** Follow available panel space, not the browser width. Manual choice survives
 * host switches and ordinary resizing until the compact/wide boundary changes. */
export function useResponsiveSftp(active: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const narrowRef = useRef<boolean>()
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element || !active) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width <= 0) return
      const next = entry.contentRect.width < 900
      if (next !== narrowRef.current) { narrowRef.current = next; setHidden(next) }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [active])
  return { ref, hidden, setHidden }
}
