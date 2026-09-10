import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { registerSshApi } from '../lib/api.js'

test('FTP API supports anonymous create and safe authentication transitions', async t => {
  const state = { ftpProfiles: [] }
  const passwords = new Map()
  let route
  registerSshApi({ register(value) { route = value; return () => {} } }, '/ssh-local/v1', {
    store: {
      ftpProfiles: () => state.ftpProfiles,
      ftpProfile: id => state.ftpProfiles.find(p => p.id === id),
      update: async mutate => mutate(state),
    },
    credentials: {
      readFtp: async id => passwords.get(id) ?? {},
      replaceFtp: async (id, value) => passwords.set(id, value),
      writeFtp: async (id, value) => passwords.set(id, value),
      deleteFtp: async id => passwords.delete(id),
      describeFtp: async id => ({ fields: passwords.get(id)?.password ? ['password'] : [] }),
    },
  })
  const server = createServer((req, res) => { void route.handler(req, res) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const request = (method, path, profile, secrets = {}) => fetch(`http://127.0.0.1:${server.address().port}/ssh-local/v1/ftp-profiles${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-DSH-SSH-Request': '1' }, body: JSON.stringify({ profile, secrets }),
  })
  const anonymous = { name: 'Public', host: 'localhost', protocol: 'ftp', authMode: 'anonymous' }
  const created = await request('POST', '', anonymous)
  assert.equal(created.status, 201)
  const profile = await created.json()
  assert.equal(profile.username, 'anonymous')
  assert.equal(passwords.size, 0)
  const path = `/${profile.id}`
  const privateProfile = { ...anonymous, authMode: 'password', username: 'tester' }
  assert.equal((await request('PUT', path, privateProfile)).status, 400)
  assert.equal((await request('PUT', path, privateProfile, { password: 'secret' })).status, 200)
  assert.equal(passwords.get(profile.id).password, 'secret')
  assert.equal((await request('PUT', path, anonymous, { password: 'must-not-store' })).status, 200)
  assert.equal(passwords.size, 0)
  assert.equal((await request('PUT', path, privateProfile)).status, 400)
  assert.equal((await request('POST', '', privateProfile)).status, 400)
})
