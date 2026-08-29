import { useCallback, useEffect, useRef, type PointerEvent, type ReactNode, type RefObject } from 'react'

interface BorderGlowProps {
  children: ReactNode
  className?: string | undefined
}

interface PointerPosition {
  clientX: number
  clientY: number
}

const EDGE_RANGE = 28

interface BorderGlowSurface<T extends HTMLElement> {
  ref: RefObject<T>
  onPointerMove(event: PointerEvent<T>): void
  onPointerLeave(): void
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

export function useBorderGlowSurface<T extends HTMLElement>(): BorderGlowSurface<T> {
  const surfaceRef = useRef<T>(null)
  const frameRef = useRef<number | undefined>(undefined)
  const pointerRef = useRef<PointerPosition | undefined>(undefined)

  const updateGlow = useCallback(() => {
    frameRef.current = undefined
    const surface = surfaceRef.current
    const pointer = pointerRef.current
    if (surface === null || pointer === undefined) return

    const rect = surface.getBoundingClientRect()
    const x = clamp(pointer.clientX - rect.left, 0, rect.width)
    const y = clamp(pointer.clientY - rect.top, 0, rect.height)
    const distanceToEdge = Math.min(x, rect.width - x, y, rect.height - y)
    const proximity = clamp(1 - distanceToEdge / EDGE_RANGE, 0, 1)
    const angle = Math.atan2(y - rect.height / 2, x - rect.width / 2) * (180 / Math.PI) + 90

    surface.style.setProperty('--ssh-border-glow-proximity', proximity.toFixed(3))
    surface.style.setProperty('--ssh-border-glow-angle', `${angle.toFixed(2)}deg`)
  }, [])

  const handlePointerMove = useCallback((event: PointerEvent<T>): void => {
    pointerRef.current = { clientX: event.clientX, clientY: event.clientY }
    if (frameRef.current === undefined) frameRef.current = requestAnimationFrame(updateGlow)
  }, [updateGlow])

  const hideGlow = useCallback((): void => {
    pointerRef.current = undefined
    const surface = surfaceRef.current
    if (surface !== null) surface.style.setProperty('--ssh-border-glow-proximity', '0')
  }, [])

  useEffect(() => () => {
    if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current)
  }, [])

  return { ref: surfaceRef, onPointerMove: handlePointerMove, onPointerLeave: hideGlow }
}

export function BorderGlow({ children, className }: BorderGlowProps): JSX.Element {
  const glow = useBorderGlowSurface<HTMLDivElement>()

  return <div
    ref={glow.ref}
    className={`dsh-ssh-border-glow${className === undefined ? '' : ` ${className}`}`}
    onPointerMove={glow.onPointerMove}
    onPointerLeave={glow.onPointerLeave}
  >
    <span className="dsh-ssh-border-glow-edge" aria-hidden="true" />
    <div className="dsh-ssh-border-glow-inner">{children}</div>
  </div>
}
