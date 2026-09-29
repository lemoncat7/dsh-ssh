import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const workspaceUrl = new URL('../src/file-transfer-workspace.tsx', import.meta.url)
const clientUrl = new URL('../src/client.tsx', import.meta.url)

test('drag transfers open conflicts directly and handled failures leave the queue', async () => {
  const source = await readFile(workspaceUrl, 'utf8')
  assert.match(source, /autoConflictJobIdsRef\.current\.add\(result\.job\.id\)/)
  assert.match(source, /setConflictJob\(job\)/)
  assert.match(source, /dismissFileTransferJob\(previous\.id\)/)
  assert.match(source, /filter\(job => job\.id !== previous\.id/)
  assert.doesNotMatch(source, /sendToNextPane/)
  assert.doesNotMatch(source, /dsh-ssh-transfer-to-button/)
})

test('file transfer stays mounted while switching SSH workbench tabs', async () => {
  const source = await readFile(clientUrl, 'utf8')
  assert.match(source, /setTransferMounted\(true\); setView\('transfer'\)/)
  assert.match(source, /transferMounted && <div className="dsh-ssh-persistent-page" hidden=\{view !== 'transfer'\}>/)
})
