import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { registerSshApi } from '../lib/api.js'

test('browser uploads require mutation authorization and acknowledge only a saved remote file', async t => {
  let route, connections = 0, closed = 0
  const entries = new Map()
  registerSshApi({ register(value) { route = value; return () => {} } }, '/ssh-local/v1', {
    files: { async connect(id) {
      assert.equal(id, 'ftp:test'); connections++
      return {
        async stat(path) { return path === '/dest' ? { kind: 'directory', path } : { kind: 'file', path, size: entries.get(path)?.length ?? -1 } },
        async upload(path, source) { const chunks = []; for await (const chunk of source) chunks.push(chunk); entries.set(path, Buffer.concat(chunks)) },
        async move(from, to) { if (entries.has(to)) throw Object.assign(new Error('already exists'), { status: 409 }); entries.set(to, entries.get(from)); entries.delete(from) },
        async remove(path) { entries.delete(path) },
        close() { closed++ },
      }
    } },
  })
  const server = createServer((req, res) => { void route.handler(req, res) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}/ssh-local/v1/file-transfer/upload?endpointId=ftp:test&directory=/dest&name=report.md`
  const denied = await fetch(url, { method: 'PUT', body: 'hello' })
  assert.equal(denied.status, 403); await denied.text(); assert.equal(connections, 0)
  const response = await fetch(url, { method: 'PUT', headers: { 'X-DSH-SSH-Request': '1' }, body: 'hello' })
  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), { path: '/dest/report.md', name: 'report.md', size: 5 })
  assert.equal(entries.get('/dest/report.md').toString(), 'hello')
  const conflict = await fetch(url, { method: 'PUT', headers: { 'X-DSH-SSH-Request': '1' }, body: 'overwrite' })
  assert.equal(conflict.status, 409); await conflict.text()
  assert.equal(entries.size, 1); assert.equal(closed, 2)
})
