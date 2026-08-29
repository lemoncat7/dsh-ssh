import { useRef, type RefObject } from 'react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(useGSAP)

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function allowsMotion(): boolean {
  return !window.matchMedia(REDUCED_MOTION_QUERY).matches
}

export function useDialogMotion(
  surfaceRef: RefObject<HTMLElement>,
  onClose: () => void,
): () => void {
  const closeRef = useRef(onClose)
  const closingRef = useRef(false)
  closeRef.current = onClose

  const { contextSafe } = useGSAP(() => {
    const surface = surfaceRef.current
    if (surface === null || !allowsMotion()) return

    const content = Array.from(surface.children)
    const timeline = gsap.timeline({ defaults: { ease: 'power2.out' } })
    timeline
      .fromTo(surface, {
        autoAlpha: 0,
        y: 10,
        scale: 0.985,
        transformOrigin: '50% 36%',
      }, {
        autoAlpha: 1,
        y: 0,
        scale: 1,
        duration: 0.22,
        clearProps: 'transform,opacity,visibility',
      })
      .fromTo(content, {
        autoAlpha: 0.58,
        y: 4,
      }, {
        autoAlpha: 1,
        y: 0,
        duration: 0.18,
        stagger: 0.025,
        clearProps: 'transform,opacity,visibility',
      }, '<0.035')

    return () => { timeline.kill() }
  }, { scope: surfaceRef })

  return contextSafe(() => {
    if (closingRef.current) return
    const surface = surfaceRef.current
    if (surface === null || !allowsMotion()) {
      closeRef.current()
      return
    }

    closingRef.current = true
    const content = Array.from(surface.children)
    gsap.killTweensOf([surface, ...content])
    gsap.timeline({
      defaults: { ease: 'power1.in' },
      onComplete: () => { closeRef.current() },
    })
      .to(content, {
        autoAlpha: 0,
        y: -2,
        duration: 0.08,
        stagger: { each: 0.012, from: 'end' },
      })
      .to(surface, {
        autoAlpha: 0,
        y: 6,
        scale: 0.99,
        transformOrigin: '50% 36%',
        duration: 0.12,
      }, '<0.025')
  })
}

export function useActiveControlMotion(
  controlRef: RefObject<HTMLElement>,
  active: boolean,
): void {
  useGSAP(() => {
    const control = controlRef.current
    if (!active || control === null || !allowsMotion()) return
    gsap.fromTo(control, {
      y: 1,
      scale: 0.975,
    }, {
      y: 0,
      scale: 1,
      duration: 0.2,
      ease: 'power2.out',
      overwrite: 'auto',
      clearProps: 'transform',
    })
  }, {
    scope: controlRef,
    dependencies: [active],
    revertOnUpdate: true,
  })
}

export function useStaggeredEntrance(
  surfaceRef: RefObject<HTMLElement>,
  selector = ':scope > *',
): void {
  useGSAP(() => {
    const surface = surfaceRef.current
    if (surface === null || !allowsMotion()) return
    const items = surface.querySelectorAll<HTMLElement>(selector)
    gsap.fromTo(items, {
      autoAlpha: 0,
      y: 5,
    }, {
      autoAlpha: 1,
      y: 0,
      duration: 0.24,
      stagger: 0.035,
      ease: 'power2.out',
      clearProps: 'transform,opacity,visibility',
    })
  }, { scope: surfaceRef })
}
