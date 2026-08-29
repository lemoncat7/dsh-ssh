import assert from 'node:assert/strict'
import test from 'node:test'
import { canTransferIntoRemoteDirectory, isNavigableRemoteEntry, isSameRemoteTransferLocation, remoteDropOperation } from '../lib/file-transfer-intent.js'

test('uses the same directory semantics for native and FTP-discovered directories', () => {
  assert.equal(isNavigableRemoteEntry({ kind: 'directory' }), true)
  assert.equal(isNavigableRemoteEntry({ kind: 'symlink', navigable: true }), true)
  assert.equal(isNavigableRemoteEntry({ kind: 'file' }), false)
})

test('treats the same endpoint and normalized directory as a no-op transfer target', () => {
  assert.equal(isSameRemoteTransferLocation(
    { endpointId: 'server-a', directory: '/srv/project/' },
    { endpointId: 'server-a', directory: '/srv//project' },
  ), true)
  assert.equal(isSameRemoteTransferLocation(
    { endpointId: 'server-a', directory: '\\srv\\project' },
    { endpointId: 'server-a', directory: '/srv/project/' },
  ), true)
})

test('allows transfers across endpoints or directories', () => {
  assert.equal(isSameRemoteTransferLocation(
    { endpointId: 'server-a', directory: '/srv/project' },
    { endpointId: 'server-b', directory: '/srv/project' },
  ), false)
  assert.equal(isSameRemoteTransferLocation(
    { endpointId: 'server-a', directory: '/srv/project' },
    { endpointId: 'server-a', directory: '/srv/archive' },
  ), false)
})

test('allows dropping files into a child directory', () => {
  assert.equal(canTransferIntoRemoteDirectory(
    { endpointId: 'server-a', directory: '/srv/project' },
    ['/srv/project/readme.md'],
    { endpointId: 'server-a', directory: '/srv/project/docs' },
  ), true)
})

test('rejects dropping a directory into itself or one of its descendants', () => {
  const source = { endpointId: 'server-a', directory: '/srv' }
  assert.equal(canTransferIntoRemoteDirectory(source, ['/srv/project'], { endpointId: 'server-a', directory: '/srv/project' }), false)
  assert.equal(canTransferIntoRemoteDirectory(source, ['/srv/project'], { endpointId: 'server-a', directory: '/srv/project/cache' }), false)
  assert.equal(canTransferIntoRemoteDirectory(source, ['/srv/project'], { endpointId: 'server-b', directory: '/srv/project/cache' }), true)
})

test('uses move within one endpoint and copy across endpoints', () => {
  const source = { paneId: 'left', endpointId: 'server-a', directory: '/srv/project', paths: ['/srv/project/readme.md'] }
  assert.equal(remoteDropOperation(source, { endpointId: 'server-a', directory: '/srv/archive' }), 'move')
  assert.equal(remoteDropOperation(source, { endpointId: 'server-b', directory: '/srv/archive' }), 'copy')
  assert.equal(remoteDropOperation(source, { endpointId: 'server-a', directory: '/srv/project/' }), 'none')
})

test('marks moving a directory into its descendants as invalid', () => {
  const source = { paneId: 'left', endpointId: 'server-a', directory: '/srv', paths: ['/srv/project'] }
  assert.equal(remoteDropOperation(source, { endpointId: 'server-a', directory: '/srv/project/cache' }), 'invalid')
})
