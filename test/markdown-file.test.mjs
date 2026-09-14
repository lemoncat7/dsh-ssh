import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { Writable } from 'node:stream'
import { markdownHash, parseMarkdownSave, saveMarkdownWithAdapter } from '../lib/markdown-file.js'
import { saveLocalMarkdown } from '../lib/local-markdown-file.js'
import { saveSftpMarkdown } from '../lib/sftp-markdown-file.js'
import { readLocalWorkspacePreview } from '../lib/local-workspace.js'
import { registerSshApi } from '../lib/api.js'

test('Markdown writes are versioned, idempotent, bounded and workspace scoped', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ssh-markdown-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace'); await mkdir(workspace)
  const file = join(workspace, 'file.md'); await writeFile(file, '# Original\n', { mode: 0o640 })
  const preview = await readLocalWorkspacePreview(workspace, file)
  assert.equal(preview.contentHash, markdownHash('# Original\n'))
  const request = { path: file, expectedHash: preview.contentHash, text: '# Updated\n' }
  const saved = await saveLocalMarkdown(workspace, request)
  assert.equal(saved.contentHash, markdownHash(request.text))
  assert.equal(await readFile(file, 'utf8'), request.text)
  assert.equal((await stat(file)).mode & 0o777, 0o640)
  assert.deepEqual(await saveLocalMarkdown(workspace, request), saved, 'retry after lost response is idempotent')
  await assert.rejects(saveLocalMarkdown(workspace, { ...request, text: '# Stale' }), e => e.status === 409)
  assert.deepEqual(await readdir(workspace), ['file.md'])
  await writeFile(join(root, 'outside.md'), '# Private')
  await symlink(join(root, 'outside.md'), join(workspace, 'escape.md'))
  await assert.rejects(saveLocalMarkdown(workspace, { ...request, path: join(workspace, 'escape.md') }), e => e.status === 403)
  assert.throws(() => parseMarkdownSave({ ...request, path: 'index.html' }), e => e.status === 400)
  assert.throws(() => parseMarkdownSave({ ...request, text: 'a'.repeat(262145) }), e => e.status === 413)
})

test('changes during staging and concurrent saves do not overwrite original content', async () => {
  let body = Buffer.from('before'), commits = 0, cleaned = 0
  const input = { path: 'test.md', text: 'mine', expectedHash: markdownHash(body) }
  await assert.rejects(saveMarkdownWithAdapter('race', input, {
    read: async () => body, stage: async () => { body = Buffer.from('external') }, commit: async () => { commits++ }, cleanup: async () => { cleaned++ },
  }), e => e.status === 409)
  assert.equal(commits, 0); assert.equal(cleaned, 1); assert.equal(body.toString(), 'external')
  let release, started
  const ready = new Promise(resolve => { started = resolve })
  body = Buffer.from('before')
  const adapter = { read: async () => body, stage: async () => { started(); await new Promise(resolve => { release = resolve }) }, commit: async () => {}, cleanup: async () => {} }
  const first = saveMarkdownWithAdapter('parallel', input, adapter); await ready
  await assert.rejects(saveMarkdownWithAdapter('parallel', input, adapter), e => e.status === 409)
  release(); await first
})

function remoteFixture(renameSupported = true) {
  const files = new Map([['/file.md', Buffer.from('# Remote')]])
  let ended = 0
  const sftp = {
    realpath: (path, cb) => cb(null, path),
    open: (path, _flags, cb) => files.has(path) ? cb(null, Buffer.from(path)) : cb(Error('missing')),
    close: (_handle, cb) => cb(),
    fstat: (handle, cb) => cb(null, { mode: 0o100640, uid: 1000, gid: 1000, size: files.get(handle.toString()).length }),
    read: (handle, buffer, offset, length, position, cb) => { const value = files.get(handle.toString()); const count = value.copy(buffer, offset, position, position + length); cb(null, count) },
    createWriteStream: path => {
      const chunks = []; const stream = new Writable({ write(chunk, _encoding, cb) { chunks.push(Buffer.from(chunk)); cb() }, final(cb) { files.set(path, Buffer.concat(chunks)); cb() } })
      queueMicrotask(() => stream.emit('open')); return stream
    },
    setstat: (_path, attrs, cb) => { assert.equal(attrs.mode, 0o640); cb() },
    ext_openssh_rename: (source, target, cb) => { if (!renameSupported) return cb(Error('not supported')); files.set(target, files.get(source)); files.delete(source); cb() },
    unlink: (path, cb) => { files.delete(path); cb() }, end: () => { ended++ },
  }
  return { files, ended: () => ended, connector: { connect: async () => ({ client: { sftp: cb => cb(null, sftp) }, close() {} }) } }
}
test('SFTP uses atomic replacement and leaves original intact on unsupported servers', async () => {
  for (const supported of [true, false]) {
    const remote = remoteFixture(supported)
    const input = { path: '/file.md', text: '# Updated', expectedHash: markdownHash('# Remote') }
    if (supported) await saveSftpMarkdown(remote.connector, 'host', input)
    else await assert.rejects(saveSftpMarkdown(remote.connector, 'host', input), e => e.status === 409)
    assert.equal(remote.files.get('/file.md').toString(), supported ? '# Updated' : '# Remote')
    assert.equal(remote.files.size, 1); assert.equal(remote.ended(), 1)
  }
})

test('save routes reject missing mutation headers, cross-origin writes and unauthorized sessions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ssh-markdown-api-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'file.md'), '# Original')
  let route
  registerSshApi({ register(value) { route = value; return () => {} } }, '/ssh-local/v1', {
    sessionCwd: id => id === 'owner' ? root : undefined,
    store: { injection: () => undefined, profile: () => undefined },
  })
  const server = createServer((req, res) => void route.handler(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const origin = `http://127.0.0.1:${server.address().port}`
  const url = origin + '/ssh-local/v1/activity/local-markdown?sessionId=owner'
  const body = JSON.stringify({ path: 'file.md', text: '# Saved', expectedHash: markdownHash('# Original') })
  assert.equal((await fetch(url, { method: 'PUT', body })).status, 403)
  const headers = { 'X-DSH-SSH-Request': '1', 'Content-Type': 'application/json' }
  assert.equal((await fetch(url, { method: 'PUT', body, headers: { ...headers, Origin: 'https://untrusted.invalid' } })).status, 403)
  assert.equal((await fetch(url.replace('owner', 'unknown'), { method: 'PUT', body, headers })).status, 404)
  assert.equal((await fetch(origin + '/ssh-local/v1/activity/markdown?sessionId=owner&profileId=other', { method: 'PUT', body, headers })).status, 403)
  assert.equal((await fetch(url, { method: 'PUT', body, headers })).status, 200)
  assert.equal(await readFile(join(root, 'file.md'), 'utf8'), '# Saved')
})
