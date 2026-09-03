import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'

const DEFAULT_SECONDARY_WIDTH = 38
const MIN_SECONDARY_WIDTH = 28
const MAX_SECONDARY_WIDTH = 66
const MIN_PRIMARY_PIXELS = 320
const MIN_SECONDARY_PIXELS = 280
const SEPARATOR_PIXELS = 7

interface ResizableSplitProps {
  primary: ReactNode
  secondary: ReactNode
  storageKey: string
  label: string
}

interface SplitBounds {
  min: number
  max: number
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function readStoredWidth(storageKey: string): number {
  if (typeof window === 'undefined') return DEFAULT_SECONDARY_WIDTH
  try {
    const stored = Number.parseFloat(window.localStorage.getItem(storageKey) ?? '')
    return Number.isFinite(stored)
      ? clamp(stored, MIN_SECONDARY_WIDTH, MAX_SECONDARY_WIDTH)
      : DEFAULT_SECONDARY_WIDTH
  } catch {
    return DEFAULT_SECONDARY_WIDTH
  }
}

function saveWidth(storageKey: string, width: number): void {
  try {
    window.localStorage.setItem(storageKey, width.toFixed(2))
  } catch {
    // Storage can be unavailable in privacy-restricted webviews. Resizing still works for this session.
  }
}

function boundsFor(containerWidth: number): SplitBounds {
  if (containerWidth <= 0) return { min: MIN_SECONDARY_WIDTH, max: MAX_SECONDARY_WIDTH }
  const pixelMinimum = (MIN_SECONDARY_PIXELS / containerWidth) * 100
  const pixelMaximum = ((containerWidth - MIN_PRIMARY_PIXELS - SEPARATOR_PIXELS) / containerWidth) * 100
  const min = Math.max(MIN_SECONDARY_WIDTH, pixelMinimum)
  const max = Math.max(min, Math.min(MAX_SECONDARY_WIDTH, pixelMaximum))
  return { min, max }
}

export function ResizableSplit({ primary, secondary, storageKey, label }: ResizableSplitProps): JSX.Element {
  const [secondaryWidth, setSecondaryWidth] = useState(() => readStoredWidth(storageKey))
  const rootRef = useRef<HTMLDivElement>(null)
  const separatorRef = useRef<HTMLDivElement>(null)
  const dragWidthRef = useRef(secondaryWidth)
  const pointerRef = useRef<number>()

  const applyWidth = (requestedWidth: number): number => {
    const root = rootRef.current
    if (root === null) return requestedWidth
    const bounds = boundsFor(root.getBoundingClientRect().width)
    const next = clamp(requestedWidth, bounds.min, bounds.max)
    root.style.setProperty('--ssh-sftp-width', `${next}%`)
    separatorRef.current?.setAttribute('aria-valuenow', String(Math.round(next)))
    dragWidthRef.current = next
    return next
  }

  const finishResize = (pointerId?: number): void => {
    if (pointerRef.current === undefined) return
    const separator = separatorRef.current
    pointerRef.current = undefined
    if (pointerId !== undefined && separator?.hasPointerCapture(pointerId)) separator.releasePointerCapture(pointerId)
    rootRef.current?.classList.remove('is-resizing')
    const next = dragWidthRef.current
    setSecondaryWidth(next)
    saveWidth(storageKey, next)
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    pointerRef.current = event.pointerId
    dragWidthRef.current = secondaryWidth
    event.currentTarget.setPointerCapture(event.pointerId)
    rootRef.current?.classList.add('is-resizing')
    event.preventDefault()
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (pointerRef.current !== event.pointerId) return
    const rect = rootRef.current?.getBoundingClientRect()
    if (rect === undefined || rect.width === 0) return
    applyWidth(((rect.right - event.clientX) / rect.width) * 100)
    event.preventDefault()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 5 : 2
    let requested: number | undefined
    if (event.key === 'ArrowLeft') requested = secondaryWidth + step
    if (event.key === 'ArrowRight') requested = secondaryWidth - step
    if (event.key === 'Home') requested = MIN_SECONDARY_WIDTH
    if (event.key === 'End') requested = MAX_SECONDARY_WIDTH
    if (requested === undefined) return
    const next = applyWidth(requested)
    setSecondaryWidth(next)
    saveWidth(storageKey, next)
    event.preventDefault()
  }

  const resetWidth = (): void => {
    const next = applyWidth(DEFAULT_SECONDARY_WIDTH)
    setSecondaryWidth(next)
    saveWidth(storageKey, next)
  }

  const style = { '--ssh-sftp-width': `${secondaryWidth}%` } as CSSProperties
  return <div ref={rootRef} className="dsh-ssh-workbench-split" style={style}>
    {primary}
    <div
      ref={separatorRef}
      className="dsh-ssh-workbench-resizer"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={MIN_SECONDARY_WIDTH}
      aria-valuemax={MAX_SECONDARY_WIDTH}
      aria-valuenow={Math.round(secondaryWidth)}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      onDoubleClick={resetWidth}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={event => finishResize(event.pointerId)}
      onPointerCancel={event => finishResize(event.pointerId)}
      onLostPointerCapture={() => finishResize()}
    />
    {secondary}
  </div>
}
