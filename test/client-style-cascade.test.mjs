import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const stylesheetUrl = new URL('../src/client.css', import.meta.url)

test('button reset stays below component styles in the cascade', async () => {
  const css = await readFile(stylesheetUrl, 'utf8')

  assert.match(css, /:where\(\s*\.dsh-ssh-workspace button,[\s\S]*?\.dsh-ssh-session-create-modal button\s*\)\s*\{[\s\S]*?padding:\s*0;/)
  assert.doesNotMatch(css, /\.dsh-ssh-workspace button,\s*\n\.dsh-ssh-activity-panel button,/)
  assert.match(css, /\.dsh-ssh-primary-button,[\s\S]*?min-height:\s*var\(--ssh-control-height\);[\s\S]*?padding:\s*0 var\(--ssh-control-padding\);/)
})
