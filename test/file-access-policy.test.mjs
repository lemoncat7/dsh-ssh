import assert from 'node:assert/strict'
import test from 'node:test'
import { fileEndpointIds, canTransferFiles, requiresFileApproval } from '../lib/file-access-policy.js'
import { registerFileTransferTools } from '../lib/file-transfer-tools.js'

test('mounted SFTP and standalone FTP keep distinct grants and approval policies', () => {
  const access = { profileIds: ['a'], fileEndpointIds: ['sftp:stale', 'ftp:b', 'ftp:b'], filePermission: 'browse', requireFileApproval: true, requireCommandApproval: false }
  assert.deepEqual(fileEndpointIds(access), ['sftp:a', 'ftp:b'])
  assert.equal(canTransferFiles(access, 'sftp:a'), true)
  assert.equal(canTransferFiles(access, 'sftp:stale'), false)
  assert.equal(canTransferFiles(access, 'ftp:b'), false)
  assert.equal(requiresFileApproval(access, 'sftp:a'), false)
  assert.equal(requiresFileApproval(access, 'ftp:b'), true)
  access.filePermission = 'transfer'
  assert.equal(canTransferFiles(access, 'ftp:b'), true)
  assert.equal(canTransferFiles(access, 'ftp:other'), false)
  access.profileIds = []
  assert.equal(canTransferFiles(access, 'sftp:a'), false)
  assert.deepEqual(fileEndpointIds(access), ['ftp:b'])
})

test('mixed transfers retain FTP approval and cannot transfer through browse-only FTP', async t => {
  const access = { sessionId: 's', profileIds: ['a'], fileEndpointIds: ['sftp:a', 'ftp:b'], filePermission: 'browse', requireFileApproval: true, requireCommandApproval: false }
  const tools = new Map(), hooks = new Map()
  const ctx = { tools: { register(tool) { tools.set(tool.name, tool); return () => {} } }, agents: { list: () => [] }, on(event, hook) { hooks.set(event, hook); return () => {} } }
  const dispose = registerFileTransferTools(ctx, { injection: () => access }, {}, { start: () => { throw new Error('must not start') } })
  t.after(dispose)
  const agent = { session: { id: 's' } }
  const gate = hooks.get('tools/pre-execute')
  assert.equal(await gate({ name: 'file_download_to_local', agent, arguments: { endpointId: 'sftp:a' } }, async () => 'allow'), 'allow')
  const args = { sourceEndpointId: 'sftp:a', destinationEndpointId: 'ftp:b', sourcePaths: ['/a'], destinationDirectory: '/' }
  assert.equal((await gate({ name: 'file_transfer_start', agent, arguments: args }, async () => 'allow')).kind, 'ask')
  await assert.rejects(tools.get('file_transfer_start').execute(args, { agent }), /only permits remote file browsing/)
  access.requireCommandApproval = true
  assert.equal((await gate({ name: 'file_download_to_local', agent, arguments: { endpointId: 'sftp:a' } }, async () => 'allow')).kind, 'ask')
})
