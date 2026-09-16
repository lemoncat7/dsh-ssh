import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { SessionFileUploads } from '../lib/session-file-upload.js'
import { uploadEndpointFile } from '../lib/endpoint-upload.js'

function remote() {
  const entries = new Map(); let closed = 0
  return { entries, closed: () => closed, async connect() { return {
    close() { closed++ },
    async stat(path) { return path === '/dest' ? { kind: 'directory', path } : { kind: 'file', path, size: entries.get(path)?.length ?? -1 } },
    async upload(path, source) { const chunks = []; for await (const chunk of source) chunks.push(Buffer.from(chunk)); entries.set(path, Buffer.concat(chunks)) },
    async move(from, to) { if (entries.has(to)) throw Object.assign(new Error('already exists'), { status: 409 }); entries.set(to, entries.get(from)); entries.delete(from) },
    async remove(path) { entries.delete(path) },
  } } }
}

test('endpoint upload stages, verifies and never replaces an existing file', async () => {
  const files = remote(), signal = new AbortController().signal
  const result = await uploadEndpointFile(files, 'ftp:a', '/dest', '报告.md', Readable.from(['hello']), signal, 5)
  assert.equal(result.size, 5); assert.equal(files.entries.get('/dest/报告.md').toString(), 'hello')
  await assert.rejects(uploadEndpointFile(files, 'ftp:a', '/dest', '报告.md', Readable.from(['new']), signal, 3), /already exists/)
  assert.equal(files.entries.size, 1); assert.equal(files.entries.get('/dest/报告.md').toString(), 'hello')
  await assert.rejects(uploadEndpointFile(files, 'ftp:a', '/dest', 'short', Readable.from(['x']), signal, 2), /大小不一致/)
  assert.equal(files.entries.size, 1); assert.equal(files.closed(), 3)
})

test('session upload permits only session files, rechecks authorization and stops after disposal', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ssh-upload-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const cwd = join(root, 'session'); await mkdir(cwd)
  await writeFile(join(cwd, 'note.md'), 'hello')
  await writeFile(join(root, 'private'), 'secret'); await symlink(join(root, 'private'), join(cwd, 'escape'))
  const files = remote(), service = new SessionFileUploads(files), signal = new AbortController().signal
  const request = { endpointId: 'ftp:a', localPath: 'note.md', sessionDirectory: cwd, remoteDirectory: '/dest' }
  for (const localPath of ['../private', '/etc/passwd', 'C:\\private', 'escape']) await assert.rejects(service.upload({ ...request, localPath }, signal, () => {}), /会话目录/)
  let checks = 0
  const result = await service.upload(request, signal, () => { checks++ })
  assert.equal(result.remotePath, '/dest/note.md'); assert.ok(checks >= 3)
  await assert.rejects(service.upload(request, signal, () => { throw new Error('revoked') }), /revoked/)
  service.close(); await assert.rejects(service.upload(request, signal, () => {}), /不可用/)
})

test('failed source does not commit a partial file', async () => {
  const files = remote()
  const source = Readable.from((async function* () { yield Buffer.from('partial'); throw new Error('network failed') })())
  await assert.rejects(uploadEndpointFile(files, 'ftp:a', '/dest', 'bad', source, new AbortController().signal), /network failed/)
  assert.equal(files.entries.size, 0); assert.equal(files.closed(), 1)
})
