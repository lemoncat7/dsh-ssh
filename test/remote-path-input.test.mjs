import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const inputSourceUrl = new URL('../src/remote-path-input.tsx', import.meta.url)
const treeSourceUrl = new URL('../src/remote-workspace-tree.tsx', import.meta.url)
const treeStylesUrl = new URL('../src/remote-workspace-tree.css', import.meta.url)

test('fixed remote projects keep free-form paths with debounced remote suggestions', async () => {
  const [inputSource, treeSource, css] = await Promise.all([
    readFile(inputSourceUrl, 'utf8'),
    readFile(treeSourceUrl, 'utf8'),
    readFile(treeStylesUrl, 'utf8'),
  ])

  assert.match(inputSource, /const LOOKUP_DELAY_MS = 600/)
  assert.match(inputSource, /loadFileEndpointDirectory\(DIRECTORY_LOOKUP_PANE_ID, endpointId, target\)/)
  assert.match(inputSource, /value=\{value\}/)
  assert.match(inputSource, /onChange=\{event => onChange\(event\.target\.value\)\}/)
  assert.match(inputSource, /directory\.entries\.filter\(isNavigableRemoteEntry\)/)
  assert.match(inputSource, /aria-invalid=\{lookup\.kind === 'error'/)
  assert.match(inputSource, /You can still save with the current input/)
  assert.match(treeSource, /<RemotePathInput profileId=\{profile\.id\} value=\{path\}/)
  assert.match(treeSource, /const \[path, setPath\] = useState\(project\?\.path \?\? ''\)/)
  assert.match(treeSource, /className="dsh-ssh-primary-button" disabled=\{saving\}/)
  assert.doesNotMatch(treeSource, /path === undefined/)
  assert.match(css, /\.dsh-ssh-project-dialog-modal\s*\{\s*width:\s*min\(480px/)
  assert.match(css, /\.dsh-ssh-remote-path-options\s*\{[\s\S]*?max-height:\s*184px;[\s\S]*?overflow:\s*auto;/)
})
