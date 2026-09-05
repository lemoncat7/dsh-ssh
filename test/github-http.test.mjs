import assert from 'node:assert/strict'
import test from 'node:test'
import { createGitHubHttpTransport, normalizeGitHubProxy } from '../lib/github-http.js'

test('normalizes safe local GitHub proxies and rejects unsafe setting values', () => {
  assert.equal(normalizeGitHubProxy(' http://host.docker.internal:7893 '), 'http://host.docker.internal:7893/')
  assert.equal(normalizeGitHubProxy('https://proxy.example:8443'), 'https://proxy.example:8443/')
  assert.throws(() => normalizeGitHubProxy('socks5://127.0.0.1:1080'), /supports HTTP or HTTPS/)
  assert.throws(() => normalizeGitHubProxy('http://user:secret@proxy.example:8080'), /does not save proxy credentials/)
  assert.throws(() => normalizeGitHubProxy('http://proxy.example:8080/path'), /Invalid GitHub proxy/)
})

test('resolves the local setting before environment proxy fallbacks', async () => {
  let configured = 'http://local-proxy:7893'
  const transport = createGitHubHttpTransport(() => configured, {
    DSH_SSH_GITHUB_PROXY: 'http://environment-proxy:8080',
    HTTPS_PROXY: 'http://generic-proxy:8080',
  })
  assert.equal(transport.route(), 'proxy')
  configured = undefined
  assert.equal(transport.route(), 'proxy')
  await transport.close()
})

test('uses direct mode when neither a local nor environment proxy exists', async () => {
  const transport = createGitHubHttpTransport(() => undefined, {})
  assert.equal(transport.route(), 'direct')
  await transport.close()
})
