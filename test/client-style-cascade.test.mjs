import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const stylesheetUrl = new URL('../src/client.css', import.meta.url)
const interactiveStylesheetUrl = new URL('../src/interactive-surfaces.css', import.meta.url)
const clientSourceUrl = new URL('../src/client.tsx', import.meta.url)
const transferSourceUrl = new URL('../src/file-transfer-workspace.tsx', import.meta.url)
const sftpSourceUrl = new URL('../src/sftp-client.tsx', import.meta.url)
const remoteTreeSourceUrl = new URL('../src/remote-workspace-tree.tsx', import.meta.url)
const profileEditorSourceUrl = new URL('../src/profile-editor.tsx', import.meta.url)
const ftpEditorSourceUrl = new URL('../src/ftp-profile-editor.tsx', import.meta.url)
const uiComponentsSourceUrl = new URL('../src/ui-components.tsx', import.meta.url)
const adaptiveStylesheetUrl = new URL('../src/adaptive-workspace.css', import.meta.url)
const transferStylesheetUrl = new URL('../src/file-transfer-workspace.css', import.meta.url)
const workbenchStylesheetUrl = new URL('../src/host-workbench.css', import.meta.url)
const remoteTreeStylesheetUrl = new URL('../src/remote-workspace-tree.css', import.meta.url)
const terminalSourceUrl = new URL('../src/terminal-view.ts', import.meta.url)

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

test('all SSH workspaces share one cool-charcoal material and typography contract', async () => {
  const [css, adaptiveCss, transferCss, workbenchCss, remoteTreeCss, interactiveCss, terminalSource] = await Promise.all([
    readFile(stylesheetUrl, 'utf8'),
    readFile(adaptiveStylesheetUrl, 'utf8'),
    readFile(transferStylesheetUrl, 'utf8'),
    readFile(workbenchStylesheetUrl, 'utf8'),
    readFile(remoteTreeStylesheetUrl, 'utf8'),
    readFile(interactiveStylesheetUrl, 'utf8'),
    readFile(terminalSourceUrl, 'utf8'),
  ])
  const featureCss = [adaptiveCss, transferCss, workbenchCss, remoteTreeCss, interactiveCss].join('\n')
  const readableCss = [css, featureCss].join('\n')

  assert.match(css, /--ssh-canvas:\s*transparent;/)
  assert.match(css, /--ssh-chrome-surface:\s*var\(--ssh-panel\);/)
  assert.match(css, /--ssh-card-surface:/)
  assert.match(css, /--ssh-activity-surface:/)
  assert.match(css, /--ssh-modal-surface:/)
  assert.match(css, /body\[data-ds-dark-theme\][\s\S]*--ssh-panel:\s*rgb\(25 33 35 \/ 90%\);/)
  assert.match(css, /body\[data-ds-dark-theme\][\s\S]*--ssh-surface:\s*rgb\(16 23 25 \/ 92%\);/)
  assert.match(css, /body\[data-ds-dark-theme\][\s\S]*--ssh-accent:\s*#69b6ba;/)
  assert.match(css, /body\[data-ds-dark-theme\][\s\S]*--ssh-file-surface:\s*#182022;/)
  assert.doesNotMatch(css, /#182427|#223235|#26373a|#2c3e41/)
  assert.match(terminalSource, /background: '#101719'/)
  assert.match(terminalSource, /selectionBackground: '#69b6ba40'/)
  assert.match(css, /--ssh-content-filter:[^;]*blur\(18px\);/)
  assert.match(css, /prefers-reduced-transparency:[\s\S]*?--ssh-canvas:\s*#e9e9ed;[\s\S]*?--ssh-canvas:\s*#101719;/)
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

test('profile metadata pickers, password visibility, and host groups use owned accessible controls', async () => {
  const [css, profileSource, ftpSource, uiSource, remoteTreeSource] = await Promise.all([
    readFile(stylesheetUrl, 'utf8'),
    readFile(profileEditorSourceUrl, 'utf8'),
    readFile(ftpEditorSourceUrl, 'utf8'),
    readFile(uiComponentsSourceUrl, 'utf8'),
    readFile(remoteTreeSourceUrl, 'utf8'),
  ])

  assert.match(profileSource, /<SuggestionInput ariaLabel="主机分组"/)
  assert.match(profileSource, /<SuggestionInput ariaLabel="主机标签" multiple/)
  assert.match(ftpSource, /<SuggestionInput ariaLabel="FTP 分组"/)
  assert.match(ftpSource, /<SuggestionInput ariaLabel="FTP 标签" multiple/)
  assert.match(uiSource, /role="combobox"/)
  assert.match(uiSource, /role="listbox"/)
  assert.match(uiSource, /aria-label=\{visible \? '隐藏密码' : '显示密码'\}/)
  assert.match(remoteTreeSource, /aria-expanded=\{!collapsed\}/)
  assert.match(css, /\.dsh-ssh-suggestion-menu\s*\{[\s\S]*?background:\s*var\(--ssh-modal-surface-raised\);/)
  assert.match(css, /\.dsh-ssh-password-input > button\s*\{[\s\S]*?min-width:\s*44px;/)
})

test('profile validation and connection chooser use quiet owned surfaces', async () => {
  const [css, adaptiveCss, transferCss, remoteTreeCss, profileSource, uiSource] = await Promise.all([
    readFile(stylesheetUrl, 'utf8'),
    readFile(adaptiveStylesheetUrl, 'utf8'),
    readFile(transferStylesheetUrl, 'utf8'),
    readFile(remoteTreeStylesheetUrl, 'utf8'),
    readFile(profileEditorSourceUrl, 'utf8'),
    readFile(uiComponentsSourceUrl, 'utf8'),
  ])

  assert.match(profileSource, /DUPLICATE_PROFILE_ENDPOINT/)
  assert.match(profileSource, /aria-invalid=\{endpointValidationMessage/)
  assert.match(css, /\.dsh-ssh-field small\.dsh-ssh-field-error\s*\{[\s\S]*?color:\s*var\(--ssh-danger\);/)
  assert.match(css, /\.dsh-ssh-form-section\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/)
  assert.match(adaptiveCss, /\.dsh-ssh-workspace\.is-transfer \.dsh-ssh-adaptive-content\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?backdrop-filter:\s*none;/)
  assert.match(css, /--ssh-list-surface:\s*#f4f4f4;/)
  assert.match(remoteTreeCss, /\.dsh-ssh-remote-tree\s*\{[\s\S]*?background:\s*var\(--ssh-chrome-surface\);[\s\S]*?backdrop-filter:\s*var\(--ssh-glass-filter\);/)
  assert.match(transferCss, /\.dsh-ssh-file-pane\.is-connections\s*\{[\s\S]*?background:\s*var\(--ssh-list-surface\);[\s\S]*?backdrop-filter:\s*none;/)
  const rimSelector = css.match(/:is\(([\s\S]*?)\)::after\s*\{[\s\S]*?box-shadow:\s*[\s\S]*?var\(--ssh-glass-rim-shadow\);/)
  assert.ok(rimSelector, 'shared surface rim selector should remain available')
  assert.doesNotMatch(rimSelector[1], /\.dsh-ssh-dialog(?:\s|,|$)/)
  assert.doesNotMatch(uiSource, /GlareHover/)
  assert.doesNotMatch(uiSource, /BorderGlow/)
})

test('client style installation replaces stale styles during plugin reloads', async () => {
  const clientSource = await readFile(new URL('../src/client.tsx', import.meta.url), 'utf8')
  assert.match(clientSource, /document\.getElementById\(STYLE_ID\)\?\.remove\(\)/)
  assert.match(clientSource, /document\.getElementById\(STYLE_ID\) === style/)
  assert.doesNotMatch(clientSource, /if \(previous !== null\) return/)
})
