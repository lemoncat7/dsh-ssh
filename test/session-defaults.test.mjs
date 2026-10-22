import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { registerSshApi } from '../lib/api.js'
import { SshStore } from '../lib/store.js'
import { newSessionAccess } from '../lib/session-defaults.js'

test('session defaults persist without granting hosts, overriding existing sessions or breaking inheritance', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ssh-defaults-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const settings = { allowPublicBind: false, defaultCommandTimeoutMs: 30000, maxOutputChars: 32000 }
  const path = join(directory, 'state.json')
  const store = await SshStore.open(path, settings)
  const old = newSessionAccess('old', settings)
  await store.update(state => state.injections.push(old))
  let route
  registerSshApi({ register(value) { route = value; return () => {} } }, '/ssh-local/v1', { store })
  const server = createServer((req,res) => { void route.handler(req,res) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const request = (path, body) => fetch(`http://127.0.0.1:${server.address().port}/ssh-local/v1${path}`, body === undefined ? {} : { method: 'PUT', headers: {'Content-Type':'application/json', 'X-DSH-SSH-Request':'1'}, body: JSON.stringify(body) })
  assert.deepEqual(await (await request('/session-defaults')).json(), {permission:'exec',requireCommandApproval:true})
  assert.equal((await request('/session-defaults', {permission:'invalid',requireCommandApproval:false})).status,400)
  assert.equal((await request('/session-defaults', {permission:'terminal',requireCommandApproval:'false'})).status,400)
  assert.equal((await request('/session-defaults', {permission:'terminal',requireCommandApproval:false})).status,200)
  const fresh = await (await request('/injections?sessionId=new&defaults=1')).json()
  assert.equal(fresh.permission,'terminal')
  assert.equal(fresh.requireCommandApproval,false)
  assert.deepEqual(fresh.profileIds,[])
  assert.deepEqual(fresh.fileEndpointIds,[])
  assert.equal(store.injection('new'),undefined)
  assert.deepEqual(await (await request('/injections?sessionId=old&defaults=1')).json(),old)
  assert.equal(await store.inheritInjection('old','child'),true)
  assert.equal(store.injection('child').requireCommandApproval,true)
  assert.equal((await request('/settings',settings)).status,200)
  const reopened = await SshStore.open(path,settings)
  assert.equal(reopened.settings().defaultSessionPermission,'terminal')
  assert.equal(reopened.settings().defaultRequireCommandApproval,false)
})
