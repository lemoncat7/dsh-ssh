export function SplitIcon({ direction }: { direction?: 'horizontal' | 'vertical' | 'grid' | undefined }): JSX.Element {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5" />{(direction === 'horizontal' || direction === 'grid') && <path d="M8 3v10" />}{(direction === 'vertical' || direction === 'grid') && <path d="M2.5 8h11" />}</svg>
}
