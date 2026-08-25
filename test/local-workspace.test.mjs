import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { listLocalWorkspace, readLocalWorkspacePreview } from '../lib/local-workspace.js'

test('opens the current session workspace and previews Markdown', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'dsh-ssh-local-'))
  const workspace = join(parent, 'workspace')
  try {
    await mkdir(join(workspace, 'docs'), { recursive: true })
    await writeFile(join(workspace, 'README.md'), '# Session workspace\n\n- local file\n')
    const directory = await listLocalWorkspace(workspace)
    assert.equal(directory.path, workspace)
    assert.equal(directory.parent, null)
    assert.deepEqual(directory.entries.map(entry => entry.name), ['docs', 'README.md'])
    const preview = await readLocalWorkspacePreview(workspace, join(workspace, 'README.md'))
    assert.equal(preview.mimeType, 'text/markdown')
    assert.equal(preview.kind, 'text')
    assert.match(preview.text, /Session workspace/)
  } finally { await rm(parent, { recursive: true, force: true }) }
})

test('rejects traversal and symlink escapes outside the session workspace', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'dsh-ssh-boundary-'))
  const workspace = join(parent, 'workspace')
  try {
    await mkdir(workspace)
    await writeFile(join(parent, 'secret.md'), '# secret')
    await symlink(join(parent, 'secret.md'), join(workspace, 'escape.md'))
    await assert.rejects(() => readLocalWorkspacePreview(workspace, join(workspace, '..', 'secret.md')), error => error.status === 403)
    await assert.rejects(() => readLocalWorkspacePreview(workspace, join(workspace, 'escape.md')), error => error.status === 403)
  } finally { await rm(parent, { recursive: true, force: true }) }
})
