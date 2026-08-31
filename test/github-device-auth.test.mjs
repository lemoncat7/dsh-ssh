import assert from 'node:assert/strict'
import test from 'node:test'
import { GitHubDeviceAuthService } from '../lib/github-device-auth.js'

test('completes GitHub Device Flow without returning the access token to the browser', async () => {
  const requests = []
  let authorizedToken
  const request = async (url, init) => {
    requests.push({ url, body: String(init.body) })
    if (url.endsWith('/device/code')) return json({
      device_code: 'device-code-value-with-safe-length',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 1,
    })
    return json({ access_token: 'gho_device_flow_token_value', token_type: 'bearer', scope: 'gist' })
  }
  const service = new GitHubDeviceAuthService(
    () => 'Ov23liDeviceClient1234',
    async token => { authorizedToken = token; return { login: 'device-user' } },
    request,
  )
  const started = await service.start()
  assert.equal(started.userCode, 'ABCD-EFGH')
  assert.equal(started.verificationUri, 'https://github.com/login/device')
  assert.match(requests[0].body, /scope=gist/)

  const completed = await service.poll(started.id)
  assert.deepEqual(completed, { state: 'complete', login: 'device-user' })
  assert.equal(authorizedToken, 'gho_device_flow_token_value')
  assert.equal('accessToken' in completed, false)
  assert.match(requests[1].body, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code/)
})

test('requires an application client id before starting GitHub authorization', async () => {
  const service = new GitHubDeviceAuthService(() => undefined, async () => ({ login: 'unused' }))
  await assert.rejects(service.start(), /OAuth Client ID/)
})

function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }) }
