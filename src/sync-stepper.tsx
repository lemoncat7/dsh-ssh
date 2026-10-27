// Adapted from the React Bits Stepper supplied for this integration (see docs/third-party/react-bits.md).
// Uses the SSH theme, controlled steps and existing dialog focus management.
import { Children, isValidElement, useLayoutEffect, useRef, type ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon, ArrowRight01Icon, Tick02Icon } from '@hugeicons/core-free-icons'

export function Step({ children }: { title: string; children: ReactNode }): JSX.Element {
  return <div className="dsh-ssh-stepper-step">{children}</div>
}

export default function Stepper({ children, step, onStepChange, onNext, busy, backButtonText, nextButtonText, completeButtonText }: {
  children: ReactNode; step: number; onStepChange(step: number): void; onNext(): void
  busy: boolean; backButtonText: string; nextButtonText: string; completeButtonText: string
}): JSX.Element {
  const steps = Children.toArray(children).filter(isValidElement<{ title: string }>)
  const trackRef = useRef<HTMLDivElement>(null)
  const gliderRef = useRef<HTMLSpanElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  const previous = useRef(step)
  useLayoutEffect(() => {
    const track = trackRef.current, glider = gliderRef.current, pane = paneRef.current
    if (!track || !glider || !pane) return
    const place = () => {
      const segment = track.querySelector<HTMLElement>('[aria-current="step"]')
      if (!segment) return
      glider.style.transform = `translateX(${segment.offsetLeft}px)`
      glider.style.width = `${segment.offsetWidth}px`
    }
    place()
    const observer = new ResizeObserver(place); observer.observe(track)
    let animation: Animation | undefined
    if (previous.current !== step) {
      pane.focus({ preventScroll: true })
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        animation = pane.animate([{ opacity: 0, transform: `translateX(${step > previous.current ? 18 : -18}px)` }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(0.22,1,0.36,1)' })
      }
    }
    previous.current = step
    return () => { observer.disconnect(); animation?.cancel() }
  }, [step])
  return <div className="dsh-ssh-stepper">
    <div className="dsh-ssh-stepper-track" ref={trackRef}>
      <span className="dsh-ssh-stepper-glider" ref={gliderRef} aria-hidden="true" />
      {steps.map((entry, index) => <button key={index} type="button" className="dsh-ssh-stepper-segment" aria-current={step === index + 1 ? 'step' : undefined} disabled={busy || index + 1 >= step} onClick={() => onStepChange(index + 1)}>
        <span className="dsh-ssh-stepper-badge" data-complete={index + 1 < step || undefined} aria-hidden="true">{index + 1 < step ? <HugeiconsIcon icon={Tick02Icon} size={16} /> : index + 1}</span><span>{entry.props.title}</span>
      </button>)}
    </div>
    <div ref={paneRef} tabIndex={-1} className="dsh-ssh-stepper-pane">{steps[step - 1]}</div>
    <div className="dsh-ssh-stepper-footer">
      <button type="button" className="dsh-ssh-secondary-button" style={{ visibility: step <= 1 ? 'hidden' : undefined }} disabled={busy || step <= 1} onClick={() => onStepChange(step - 1)}><HugeiconsIcon icon={ArrowLeft01Icon} size={16} />{backButtonText}</button>
      <button type="button" className="dsh-ssh-primary-button" disabled={busy} onClick={onNext}>{step === steps.length ? completeButtonText : nextButtonText}<HugeiconsIcon icon={step === steps.length ? Tick02Icon : ArrowRight01Icon} size={16} /></button>
    </div>
  </div>
}
