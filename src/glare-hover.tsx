import type { CSSProperties, ReactNode } from 'react'

interface GlareHoverProps {
  children: ReactNode
  className?: string | undefined
  glareColor?: string | undefined
  glareOpacity?: number | undefined
  glareAngle?: number | undefined
  glareSize?: number | undefined
  transitionDuration?: number | undefined
}

type GlareStyle = CSSProperties & {
  '--dsh-ssh-glare-angle': string
  '--dsh-ssh-glare-color': string
  '--dsh-ssh-glare-duration': string
  '--dsh-ssh-glare-size': string
}

function withOpacity(color: string, opacity: number): string {
  const value = color.trim().replace(/^#/, '')
  if (/^[\da-f]{3}$/i.test(value)) {
    const [red = '0', green = '0', blue = '0'] = value
    return `rgba(${parseInt(red + red, 16)}, ${parseInt(green + green, 16)}, ${parseInt(blue + blue, 16)}, ${opacity})`
  }
  if (/^[\da-f]{6}$/i.test(value)) {
    return `rgba(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)}, ${opacity})`
  }
  return `color-mix(in srgb, ${color} ${Math.round(opacity * 100)}%, transparent)`
}

export function GlareHover({
  children,
  className,
  glareColor = '#ffffff',
  glareOpacity = 0.28,
  glareAngle = -30,
  glareSize = 300,
  transitionDuration = 800,
}: GlareHoverProps): JSX.Element {
  const style: GlareStyle = {
    '--dsh-ssh-glare-angle': `${glareAngle}deg`,
    '--dsh-ssh-glare-color': withOpacity(glareColor, glareOpacity),
    '--dsh-ssh-glare-duration': `${transitionDuration}ms`,
    '--dsh-ssh-glare-size': `${glareSize}px`,
  }

  return <div className={`dsh-ssh-glare-hover${className === undefined ? '' : ` ${className}`}`} style={style}>
    <div className="dsh-ssh-glare-hover-inner">{children}</div>
  </div>
}
