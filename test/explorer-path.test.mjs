import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { explorerInputPath } from '../lib/explorer-path.js'
import { statLocalWorkspacePath } from '../lib/local-workspace.js'
import { registerSshApi } from '../lib/api.js'

test('path input preserves spaces and symlink semantics while resolving relative paths', () => {
  assert.equal(explorerInputPath(' 报告 1.md ', '/project/docs'), '/project/docs/报告 1.md')
  assert.equal(explorerInputPath('../README', '/project/docs'), '/project/docs/../README')
  assert.equal(explorerInputPath('a', '/'), '/a')
  for (const path of ['/etc/config', '~/readme', '~', 'C:/docs/a.txt', '\\\\server\\docs']) assert.equal(explorerInputPath(path, '/project'), path)
  for (const path of ['', '  ', 'a\nb', 'a\0b', 'a'.repeat(4097)]) assert.throws(() => explorerInputPath(path, '/project'), /路径/)
})

test('local path inspection resolves files, directories and symlinks within the workspace only', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ssh-inspect-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  await writeFile(join(workspace, '说明.md'), '# hello')
  await writeFile(join(root, 'private.txt'), 'outside')
  await symlink(join(root, 'private.txt'), join(workspace, 'escape'))
  await symlink(join(workspace, '说明.md'), join(workspace, 'link'))
  assert.equal((await statLocalWorkspacePath(workspace, '.')).kind, 'directory')
  const entry = await statLocalWorkspacePath(workspace, 'link')
  assert.equal(entry.kind, 'file'); assert.equal(entry.name, '说明.md'); assert.equal(entry.size, 7)
  await assert.rejects(statLocalWorkspacePath(workspace, 'missing'), e => e.status === 404)
  await assert.rejects(statLocalWorkspacePath(workspace, 'escape'), e => e.status === 403)
  await assert.rejects(statLocalWorkspacePath(workspace, '../private.txt'), e => e.status === 403)
})

test('path inspection API preserves session permissions, resolves tilde and closes SFTP channels', async t => {
  let route, connections = 0, closed = 0, channelClosed = 0
  const requested = []
  registerSshApi({ register(value) { route = value; return () => {} } }, '/ssh-local/v1', {
    sessionCwd: () => undefined,
    store: {
      profile: id => id === 'host' ? { id } : undefined,
      injection: id => id === 'owner' ? { profileIds: ['host'] } : undefined,
    },
    connector: { async connect() {
      connections++
      return { close() { closed++ }, client: { sftp(callback) { callback(null, {
        end() { channelClosed++ },
        realpath(value, cb) { cb(null, value === '.' ? '/home/dev' : value) },
        stat(value, cb) {
          requested.push(value)
          if (value.endsWith('/missing')) return cb(Object.assign(new Error('No such file'), { code: 2 }))
          cb(null, { mode: value.endsWith('.md') ? 0o100644 : 0o040755, size: 12, mtime: 2 })
        },
      }) } } }
    } },
  })
  const server = createServer((req, res) => { void route.handler(req, res) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}/ssh-local/v1`
  for (const path of ['/activity/stat?sessionId=other&profileId=host&path=~/a.md', '/activity/stat?sessionId=owner&profileId=other&path=~/a.md']) {
    assert.equal((await fetch(base + path)).status, 403)
  }
  assert.equal(connections, 0)
  const entry = await (await fetch(base + '/activity/stat?sessionId=owner&profileId=host&path=~/a.md')).json()
  assert.equal(entry.path, '/home/dev/a.md'); assert.equal(entry.kind, 'file')
  const dir = await (await fetch(base + '/profiles/host/sftp/stat?path=~/docs')).json()
  assert.equal(dir.kind, 'directory')
  assert.equal((await fetch(base + '/activity/stat?sessionId=owner&profileId=host&path=~/missing')).status, 404)
  assert.equal((await fetch(base + '/activity/local-stat?sessionId=unknown&path=/etc/passwd')).status, 404)
  assert.deepEqual(requested, ['/home/dev/a.md', '/home/dev/docs', '/home/dev/missing'])
  assert.equal(connections, 3); assert.equal(closed, 3); assert.equal(channelClosed, 3)
})
