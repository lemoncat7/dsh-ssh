import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink } from 'node:fs/promises'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { SessionFileDownloads } from '../lib/session-file-download.js'

const signal = () => new AbortController().signal
const allowed = () => {}
async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ssh-download-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace'); await mkdir(workspace)
  const bytes = Buffer.from('hello 文件\n')
  let connections = 0, closes = 0
  const files = { async connect(_endpoint, _signal) {
    connections++
    return { close() { closes++ },
      async stat() { return { name: '报告.txt', path: '/remote/报告.txt', kind: 'file', size: bytes.length, ...options.entry } },
      async download(path, target, signal) {
        if (options.download) return options.download({ path, target, signal, workspace, bytes })
        await pipeline(Readable.from([bytes]), target, { signal })
      },
    }
  } }
  const service = new SessionFileDownloads(files)
  t.after(() => service.close())
  const request = { endpointId: 'sftp:host', remotePath: '/remote/报告.txt', sessionDirectory: workspace }
  return { service, request, root, workspace, bytes, connections: () => connections, closes: () => closes }
}

test('downloads into the current session directory by default with complete bytes and no staging leftovers', async t => {
  const f = await fixture(t)
  const result = await f.service.download(f.request, signal(), allowed)
  assert.equal(result.state, 'completed'); assert.equal(result.localPath, join(f.workspace, '报告.txt'))
  assert.equal(result.bytes, f.bytes.length)
  assert.deepEqual(await readFile(result.localPath), f.bytes)
  assert.deepEqual(await readdir(f.workspace), ['报告.txt'])
  assert.equal(f.closes(), 1)
})

test('allows a relative filename in an existing session subdirectory', async t => {
  const f = await fixture(t); await mkdir(join(f.workspace, 'downloads'))
  const result = await f.service.download({ ...f.request, localPath: 'downloads/copy.txt' }, signal(), allowed)
  assert.equal(result.localPath, join(f.workspace, 'downloads/copy.txt'))
  assert.deepEqual(await readFile(result.localPath), f.bytes)
})

test('rejects traversal, absolute destinations and a missing session cwd before connecting', async t => {
  const f = await fixture(t)
  for (const localPath of ['../escape', '/etc/file', 'C:\\file', 'a/../../escape', 'a\0b', 'a/', './a']) {
    await assert.rejects(f.service.download({ ...f.request, localPath }, signal(), allowed), /localPath/)
  }
  await assert.rejects(f.service.download({ ...f.request, sessionDirectory: '' }, signal(), allowed), /会话/)
  assert.equal(f.connections(), 0)
})

test('does not follow destination symlinks outside the session or overwrite existing files', async t => {
  const f = await fixture(t)
  await mkdir(join(f.root, 'outside')); await symlink(join(f.root, 'outside'), join(f.workspace, 'escape'))
  await assert.rejects(f.service.download({ ...f.request, localPath: 'escape/a.txt' }, signal(), allowed), /当前会话目录/)
  await writeFile(join(f.workspace, '报告.txt'), 'keep')
  await assert.rejects(f.service.download(f.request, signal(), allowed), /未覆盖/)
  assert.equal(await readFile(join(f.workspace, '报告.txt'), 'utf8'), 'keep')
  assert.deepEqual(await readdir(join(f.root, 'outside')), [])
})

test('exclusive final commit protects a file created while remote data is downloading', async t => {
  const f = await fixture(t, { async download({ target, signal, workspace, bytes }) {
    await writeFile(join(workspace, '报告.txt'), 'created concurrently')
    await pipeline(Readable.from([bytes]), target, { signal })
  } })
  await assert.rejects(f.service.download(f.request, signal(), allowed), /未覆盖/)
  assert.equal(await readFile(join(f.workspace, '报告.txt'), 'utf8'), 'created concurrently')
  assert.deepEqual(await readdir(f.workspace), ['报告.txt'])
})

test('failed streams and changed remote sizes leave no partial final file', async t => {
  const f = await fixture(t, { async download({ target, signal }) {
    await pipeline(Readable.from((async function* () { yield Buffer.from('partial'); throw new Error('network lost') })()), target, { signal })
  } })
  await assert.rejects(f.service.download(f.request, signal(), allowed), /network lost/)
  assert.deepEqual(await readdir(f.workspace), []); assert.equal(f.closes(), 1)
  const changed = await fixture(t, { entry: { size: 1 } })
  await assert.rejects(changed.service.download(changed.request, signal(), allowed), /大小/)
  assert.deepEqual(await readdir(changed.workspace), [])
})

test('directories and oversized files are rejected without creating staging files', async t => {
  for (const entry of [{ kind: 'directory' }, { kind: 'other' }, { size: 513 * 1024 * 1024 }]) {
    const f = await fixture(t, { entry })
    await assert.rejects(f.service.download(f.request, signal(), allowed), /普通文件|512 MiB/)
    assert.deepEqual(await readdir(f.workspace), [])
  }
})

test('permission revocation during streaming stops publication and cleans partial data', async t => {
  let authorized = true
  const f = await fixture(t, { async download({ target, signal, bytes }) {
    authorized = false
    await pipeline(Readable.from([bytes]), target, { signal })
  } })
  await assert.rejects(f.service.download(f.request, signal(), () => { if (!authorized) throw new Error('revoked') }), /revoked/)
  assert.deepEqual(await readdir(f.workspace), [])
})

test('caller cancellation and service shutdown stop downloads and clean staging files', async t => {
  for (const shutdown of [false, true]) {
    let ready
    const started = new Promise(resolve => { ready = resolve })
    const f = await fixture(t, { async download({ target, signal }) {
      const source = new Readable({ read() {} })
      ready()
      await pipeline(source, target, { signal })
    } })
    const controller = new AbortController()
    const pending = f.service.download(f.request, controller.signal, allowed)
    const rejected = assert.rejects(pending, /cancelled|停止/)
    await started
    if (shutdown) f.service.close(); else controller.abort(new Error('cancelled'))
    await rejected
    assert.deepEqual(await readdir(f.workspace), []); assert.equal(f.closes(), 1)
  }
})

test('bounds global download concurrency and releases both slots on shutdown', async t => {
  let count = 0, ready
  const started = new Promise(resolve => { ready = resolve })
  const f = await fixture(t, { async download({ target, signal }) {
    if (++count === 2) ready()
    await pipeline(new Readable({ read() {} }), target, { signal })
  } })
  const pending = Promise.allSettled([
    f.service.download(f.request, signal(), allowed),
    f.service.download({ ...f.request, localPath: 'other.txt' }, signal(), allowed),
  ])
  await started
  await assert.rejects(f.service.download({ ...f.request, localPath: 'third.txt' }, signal(), allowed), /两个/)
  f.service.close()
  assert.ok((await pending).every(result => result.status === 'rejected'))
  assert.deepEqual(await readdir(f.workspace), [])
  assert.equal(f.closes(), 2)
})
