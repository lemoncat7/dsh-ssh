/** OSC 7 / iTerm CurrentDir are display metadata, never commands. */
export function terminalDirectory(value: string, osc: 7 | 1337, host: string): string | undefined {
  if (value.length > 16384) return
  let path: string
  try {
    if (osc === 7) {
      const uri = new URL(value)
      if (uri.protocol !== 'file:' || uri.username || uri.password || uri.port || uri.search || uri.hash) return
      if (uri.hostname && uri.hostname.toLowerCase() !== host.toLowerCase()) return
      path = decodeURIComponent(uri.pathname)
    } else {
      if (!value.startsWith('CurrentDir=')) return
      path = value.slice('CurrentDir='.length)
    }
  } catch { return }
  if (!path.startsWith('/') || path.length > 4096 || /[\x00-\x1f\x7f]/.test(path)) return
  return path
}
