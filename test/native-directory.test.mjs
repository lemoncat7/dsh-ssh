import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { openSessionDirectory } from '../lib/native-directory.js'

test('native directory opens only resolved session directories through the host', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'ssh-native-directory-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const root = path.join(temp, 'session')
  await mkdir(root)
  await mkdir(path.join(root, '子目录'))
  await writeFile(path.join(root, 'file.txt'), 'file')
  await symlink(temp, path.join(root, 'outside'), 'dir')
  const calls = []
  const controller = { canOpenWorkspacePath: () => true, async openWorkspacePath(value) { calls.push(value); return { opened: true } } }
  await openSessionDirectory(controller, root, '子目录', new AbortController().signal)
  assert.deepEqual(calls, [{ path: await realpath(path.join(root, '子目录')) }])
  for (const target of ['file.txt', '..', 'outside', 'missing']) await assert.rejects(openSessionDirectory(controller, root, target, new AbortController().signal))
  await assert.rejects(openSessionDirectory(undefined, root, '.', new AbortController().signal), /不支持/)
  await assert.rejects(openSessionDirectory({ ...controller, canOpenWorkspacePath: () => false }, root, '.', new AbortController().signal), /不支持/)
  await assert.rejects(openSessionDirectory(controller, root, '.', AbortSignal.abort()))
  assert.equal(calls.length, 1)
  await assert.rejects(openSessionDirectory({ ...controller, async openWorkspacePath() { throw new Error('opener failed') } }, root, '.', new AbortController().signal), /opener failed/)
})
