import type { Client, ClientChannel } from 'ssh2'

/** Read-only, bounded shell detection. Failure must never prevent opening a terminal. */
export function detectPromptShell(client: Client): Promise<'bash' | 'zsh' | 'sh' | undefined> {
  return new Promise(resolve => {
    let settled = false; let channel: ClientChannel | undefined; let text = ''
    const finish = (shell?: 'bash' | 'zsh' | 'sh'): void => {
      if (settled) return
      settled = true; clearTimeout(timer); channel?.destroy(); resolve(shell)
    }
    const timer = setTimeout(() => finish(), 5000)
    try {
      client.exec('printf "%s\\n" "${SHELL:-$0}"', (error, stream) => {
        if (error) { finish(); return }
        stream.on('error', () => finish())
        if (settled) { stream.destroy(); return }
        channel = stream
        stream.on('data', (data: Buffer) => { text += data.toString(); if (text.length > 4096) finish() })
        stream.stderr.on('data', () => {})
        stream.on('close', () => {
          const name = text.trim().split('\n').at(-1)?.trim().split('/').at(-1)?.replace(/^-/, '')
          finish(name === 'bash' ? 'bash' : name === 'zsh' ? 'zsh' : ['sh', 'dash', 'ash'].includes(name ?? '') ? 'sh' : undefined)
        })
      })
    } catch { finish() }
  })
}

/** Session-only hooks; never writes shell configuration or runs in an already busy terminal. */
export function directoryPromptHook(): string {
  const report = "__dsh_report_cwd() { local __dsh_status=$?; printf '\\033]1337;CurrentDir=%s\\007' \"$PWD\"; return \"$__dsh_status\"; }; "
  const bash = report + 'if [[ $(declare -p PROMPT_COMMAND 2>/dev/null) == "declare -a"* ]]; then PROMPT_COMMAND+=(__dsh_report_cwd); else PROMPT_COMMAND="${PROMPT_COMMAND-}"$\'\\n\'\'__dsh_report_cwd\'; fi; __dsh_report_cwd'
  const zsh = report + 'typeset -ga precmd_functions; (( ${precmd_functions[(Ie)__dsh_report_cwd]} )) || precmd_functions+=(__dsh_report_cwd); __dsh_report_cwd'
  const sh = 'PS1=\'$(printf "\\033]1337;CurrentDir=%s\\007" "$PWD")\'"${PS1-\\$ }"'
  const quote = (value: string): string => "'" + value.replaceAll("'", "'\\''") + "'"
  // $SHELL describes the account preference, not necessarily the active interactive shell.
  // Keep non-POSIX syntax inside eval so dash/ash can parse the bootstrap safely.
  return `if [ -n "\${BASH_VERSION-}" ]; then eval ${quote(bash)}; elif [ -n "\${ZSH_VERSION-}" ]; then eval ${quote(zsh)}; else eval ${quote(sh)}; fi\n`
}
