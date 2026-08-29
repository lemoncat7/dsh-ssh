import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const stylesheetUrl = new URL('../src/client.css', import.meta.url)
const interactiveStylesheetUrl = new URL('../src/interactive-surfaces.css', import.meta.url)
const clientSourceUrl = new URL('../src/client.tsx', import.meta.url)
const transferSourceUrl = new URL('../src/file-transfer-workspace.tsx', import.meta.url)

test('button reset stays below component styles in the cascade', async () => {
  const css = await readFile(stylesheetUrl, 'utf8')

  assert.match(css, /:where\(\s*\.dsh-ssh-workspace button,[\s\S]*?\.dsh-ssh-session-create-modal button\s*\)\s*\{[\s\S]*?padding:\s*0;/)
  assert.doesNotMatch(css, /\.dsh-ssh-workspace button,\s*\n\.dsh-ssh-activity-panel button,/)
  assert.match(css, /\.dsh-ssh-primary-button,[\s\S]*?min-height:\s*var\(--ssh-control-height\);[\s\S]*?padding:\s*0 var\(--ssh-control-padding\);/)
})

test('shared interactive surface contract owns themed hover and selection states', async () => {
  const [css, clientSource, transferSource] = await Promise.all([
    readFile(interactiveStylesheetUrl, 'utf8'),
    readFile(clientSourceUrl, 'utf8'),
    readFile(transferSourceUrl, 'utf8'),
  ])

  assert.match(css, /\[data-ssh-interactive="choice"\]:hover/)
  assert.match(css, /\[data-ssh-interactive="row"\]:is\([\s\S]*?\.is-selected/)
  assert.match(css, /prefers-reduced-motion:\s*reduce/)
  assert.match(clientSource, /\$\{fileTransferCss\}\\n\$\{interactiveSurfacesCss\}/)
  assert.match(transferSource, /<span data-ssh-interactive="choice" className=\{`dsh-ssh-transfer-tab/)
})
