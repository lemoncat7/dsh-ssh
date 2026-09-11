import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('dark terminal owns scrollbar material independently of light host theme', async () => {
  const css = await readFile(new URL('../src/client.css', import.meta.url), 'utf8')
  assert.match(css, /\.dsh-ssh-terminal-viewport\s*\{[^}]*color-scheme: dark;/)
  assert.match(css, /\.dsh-ssh-terminal-viewport \.xterm-viewport\s*\{[^}]*scrollbar-gutter: auto;/)
  assert.match(css, /#root \.dsh-ssh-terminal-viewport \.xterm-viewport::-webkit-scrollbar-track/)
  assert.doesNotMatch(css, /\.xterm-viewport\s*\{[^}]*scrollbar-width: none/)
})
