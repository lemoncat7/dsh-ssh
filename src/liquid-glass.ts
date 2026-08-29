const LIQUID_GLASS_SELECTOR = [
  '.dsh-ssh-toolbar',
  '.dsh-ssh-remote-tree',
  '.dsh-ssh-workbench-heading',
  '.dsh-ssh-transfer-header',
  '.dsh-ssh-transfer-tabbar',
  '.dsh-ssh-activity-header',
  '.dsh-ssh-dialog',
  '.dsh-ssh-preview-modal',
].join(',')

interface PointerSample {
  surface: HTMLElement
  clientX: number
  clientY: number
}

export function installLiquidGlassInteraction(): () => void {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let activeSurface: HTMLElement | undefined
  let pendingSample: PointerSample | undefined
  let animationFrame: number | undefined

  const clearActiveSurface = (): void => {
    if (activeSurface === undefined) return
    activeSurface.removeAttribute('data-ssh-glass-active')
    activeSurface.style.removeProperty('--ssh-glass-pointer-x')
    activeSurface.style.removeProperty('--ssh-glass-pointer-y')
    activeSurface = undefined
  }

  const render = (): void => {
    animationFrame = undefined
    const sample = pendingSample
    pendingSample = undefined
    if (sample === undefined || !sample.surface.isConnected) return
    if (activeSurface !== sample.surface) {
      clearActiveSurface()
      activeSurface = sample.surface
      activeSurface.setAttribute('data-ssh-glass-active', '')
    }
    const rect = sample.surface.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const x = Math.max(0, Math.min(100, ((sample.clientX - rect.left) / rect.width) * 100))
    const y = Math.max(0, Math.min(100, ((sample.clientY - rect.top) / rect.height) * 100))
    sample.surface.style.setProperty('--ssh-glass-pointer-x', `${x.toFixed(2)}%`)
    sample.surface.style.setProperty('--ssh-glass-pointer-y', `${y.toFixed(2)}%`)
  }

  const handlePointerMove = (event: PointerEvent): void => {
    if (reduceMotion.matches || !(event.target instanceof Element)) {
      clearActiveSurface()
      return
    }
    const surface = event.target.closest<HTMLElement>(LIQUID_GLASS_SELECTOR)
    if (surface === null) {
      clearActiveSurface()
      return
    }
    pendingSample = { surface, clientX: event.clientX, clientY: event.clientY }
    if (animationFrame === undefined) animationFrame = window.requestAnimationFrame(render)
  }

  const handleWindowBlur = (): void => {
    pendingSample = undefined
    if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame)
    animationFrame = undefined
    clearActiveSurface()
  }

  document.addEventListener('pointermove', handlePointerMove, { passive: true })
  window.addEventListener('blur', handleWindowBlur)
  return () => {
    document.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('blur', handleWindowBlur)
    handleWindowBlur()
  }
}
