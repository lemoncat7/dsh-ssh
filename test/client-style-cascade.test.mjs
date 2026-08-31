import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const stylesheetUrl = new URL('../src/client.css', import.meta.url)
const interactiveStylesheetUrl = new URL('../src/interactive-surfaces.css', import.meta.url)
const clientSourceUrl = new URL('../src/client.tsx', import.meta.url)
const transferSourceUrl = new URL('../src/file-transfer-workspace.tsx', import.meta.url)
const sftpSourceUrl = new URL('../src/sftp-client.tsx', import.meta.url)
const remoteTreeSourceUrl = new URL('../src/remote-workspace-tree.tsx', import.meta.url)
const adaptiveStylesheetUrl = new URL('../src/adaptive-workspace.css', import.meta.url)
const transferStylesheetUrl = new URL('../src/file-transfer-workspace.css', import.meta.url)
const workbenchStylesheetUrl = new URL('../src/host-workbench.css', import.meta.url)
const remoteTreeStylesheetUrl = new URL('../src/remote-workspace-tree.css', import.meta.url)

test('button reset stays below component styles in the cascade', async () => {
  const css = await readFile(stylesheetUrl, 'utf8')

  assert.match(css, /:where\(\s*\.dsh-ssh-workspace button,[\s\S]*?\.dsh-ssh-session-create-modal button\s*\)\s*\{[\s\S]*?padding:\s*0;/)
  assert.doesNotMatch(css, /\.dsh-ssh-workspace button,\s*\n\.dsh-ssh-activity-panel button,/)
  assert.match(css, /\.dsh-ssh-primary-button,[\s\S]*?min-height:\s*var\(--ssh-control-height\);[\s\S]*?padding:\s*0 var\(--ssh-control-padding\);/)
})

test('shared interactive surface contract owns themed hover and selection states', async () => {
  const [css, clientSource, transferSource, sftpSource, remoteTreeSource] = await Promise.all([
    readFile(interactiveStylesheetUrl, 'utf8'),
    readFile(clientSourceUrl, 'utf8'),
    readFile(transferSourceUrl, 'utf8'),
    readFile(sftpSourceUrl, 'utf8'),
    readFile(remoteTreeSourceUrl, 'utf8'),
  ])

  assert.match(css, /\[data-ssh-interactive="choice"\]:hover/)
  assert.match(css, /\[data-ssh-interactive="row"\]:is\([\s\S]*?\.is-selected/)
  assert.match(css, /prefers-reduced-motion:\s*reduce/)
  assert.match(clientSource, /\$\{fileTransferCss\}\\n\$\{interactiveSurfacesCss\}/)
  assert.match(transferSource, /<span data-ssh-interactive="choice" className=\{`dsh-ssh-transfer-tab/)
  assert.match(css, /\.dsh-ssh-workspace \.dsh-ssh-transfer-tab:hover:not\(:disabled\)\s*\{[\s\S]*?background:\s*transparent;/)
  assert.match(css, /\.dsh-ssh-workspace \.dsh-ssh-transfer-tab:is\(\.is-active, \.is-active:hover\)\s*\{[\s\S]*?background:\s*var\(--ssh-tab-selected\);[\s\S]*?box-shadow:/)
  assert.match(css, /\.dsh-ssh-workspace \.dsh-ssh-transfer-tab\.is-active > button:not\(\.is-close\)\s*\{[\s\S]*?font-weight:\s*600;/)
  assert.match(css, /\.dsh-ssh-workspace \.dsh-ssh-transfer-tab > button:hover:not\(:disabled\)\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?background-image:\s*none;/)
  assert.match(css, /\[data-ssh-context-row\]:is\(:hover, :focus-within\) \.dsh-ssh-context-action/)
  assert.match(css, /transform:\s*translate3d\(8px, 0, 0\) scale\(\.78\)/)
  assert.match(transferSource, /dsh-ssh-file-row-actions dsh-ssh-context-action/)
  assert.match(transferSource, /dsh-ssh-file-row-download[^>]*href=\{fileEndpointDownloadUrl/)
  assert.match(transferSource, /onOpen=\{\(\) => \{ void load\(entry\.path\) \}\}/)
  assert.doesNotMatch(transferSource, /onOpen=\{\(\) => \{ if \(entry\.kind === 'directory'\)/)
  assert.match(sftpSource, /dsh-ssh-sftp-row-delete dsh-ssh-context-action/)
  assert.match(sftpSource, /deletion=\{\{ locationName: '本地会话', locationKind: 'local', remove \}\}/)
  assert.match(remoteTreeSource, /dsh-ssh-tree-mount dsh-ssh-context-action/)
})

test('all SSH workspaces share one neutral material and typography contract', async () => {
  const [css, adaptiveCss, transferCss, workbenchCss, remoteTreeCss, interactiveCss] = await Promise.all([
    readFile(stylesheetUrl, 'utf8'),
    readFile(adaptiveStylesheetUrl, 'utf8'),
    readFile(transferStylesheetUrl, 'utf8'),
    readFile(workbenchStylesheetUrl, 'utf8'),
    readFile(remoteTreeStylesheetUrl, 'utf8'),
    readFile(interactiveStylesheetUrl, 'utf8'),
  ])
  const featureCss = [adaptiveCss, transferCss, workbenchCss, remoteTreeCss, interactiveCss].join('\n')
  const readableCss = [css, featureCss].join('\n')

  assert.match(css, /--ssh-canvas:\s*transparent;/)
  assert.match(css, /--ssh-chrome-surface:\s*var\(--ssh-panel\);/)
  assert.match(css, /--ssh-card-surface:/)
  assert.match(css, /--ssh-activity-surface:/)
  assert.match(css, /--ssh-modal-surface:/)
  assert.match(css, /--ssh-content-filter:[^;]*blur\(18px\);/)
  assert.match(css, /prefers-reduced-transparency:[\s\S]*?--ssh-canvas:\s*#e9e9ed;[\s\S]*?--ssh-canvas:\s*#1c1c1e;/)
  assert.match(css, /\.dsh-ssh-workspace\s*\{[\s\S]*?background:\s*var\(--ssh-canvas\);/)
  assert.match(adaptiveCss, /\.dsh-ssh-adaptive-content\s*\{[\s\S]*?background:\s*var\(--ssh-surface\);[\s\S]*?backdrop-filter:\s*var\(--ssh-content-filter\);/)
  assert.match(adaptiveCss, /prefers-reduced-transparency:\s*reduce[\s\S]*?\.dsh-ssh-adaptive-content,[\s\S]*?backdrop-filter:\s*none;/)
  assert.match(transferCss, /\.dsh-ssh-transfer-workspace\s*\{[\s\S]*?background:\s*var\(--ssh-canvas\);/)
  assert.doesNotMatch(transferCss, /\.dsh-ssh-transfer-workspace\s*\{[\s\S]*?--ssh-canvas:\s*var\(--ssh-file-canvas\);/)
  assert.match(transferCss, /\.dsh-ssh-transfer-panes,[\s\S]*?--ssh-card-surface:\s*var\(--ssh-file-card\);/)
  assert.match(transferCss, /\.dsh-ssh-file-table-head button\s*\{[\s\S]*?appearance:\s*none;/)
  assert.match(transferCss, /\.dsh-ssh-file-row-download\s*\{[\s\S]*?appearance:\s*none;/)
  assert.doesNotMatch(featureCss, /#[\da-f]{3,8}\b|rgba?\(/i)
  assert.doesNotMatch(readableCss, /font-size:\s*(?:10|11)px|font:[^;\n]*(?:10|11)px\//)
})
