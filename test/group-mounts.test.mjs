import assert from 'node:assert/strict'
import test from 'node:test'
import { withMountedProfiles } from '../lib/project-mounts.js'

test('batch host changes retain other hosts, directories and independent permissions without mutating the source', () => {
  const access = {
    sessionId: 'session', profileIds: ['a', 'other'],
    mountedProjectIds: { a: ['app', 'logs'], other: ['docs'] },
    workingProjectIds: { a: 'app', other: 'docs' },
    workingDirectories: { a: '/srv/app', other: '/docs' },
    fileEndpointIds: ['sftp:a'], filePermission: 'browse', permission: 'terminal', requireCommandApproval: true,
  }
  const original = structuredClone(access)
  const added = withMountedProfiles(access, [...access.profileIds, 'a', 'b'])
  assert.deepEqual(added.profileIds, ['a', 'other', 'b'])
  assert.deepEqual(added.mountedProjectIds, { a: ['app', 'logs'], other: ['docs'], b: [] })
  assert.deepEqual(added.workingDirectories, access.workingDirectories)

  const removed = withMountedProfiles(added, ['other'])
  assert.deepEqual(removed.mountedProjectIds, { other: ['docs'] })
  assert.deepEqual(removed.workingProjectIds, { other: 'docs' })
  assert.deepEqual(removed.workingDirectories, { other: '/docs' })
  assert.deepEqual(removed.fileEndpointIds, ['sftp:a'])
  assert.equal(removed.permission, 'terminal')
  assert.equal(removed.requireCommandApproval, true)
  const remounted = withMountedProfiles(removed, ['other', 'a'])
  assert.deepEqual(remounted.mountedProjectIds.a, [])
  assert.equal(remounted.workingDirectories.a, undefined)
  assert.deepEqual(access, original)
})

test('project draft updates preserve revision and cancellation can keep the original draft', () => {
  const draft = {
    workspaceId: 'workspace', revision: 'revision-1', profileIds: ['a', 'other'],
    mountedProjectIds: { a: ['app'], other: ['docs'] }, workingProjectIds: { a: 'app', other: 'docs' },
  }
  const next = withMountedProfiles(draft, ['other'])
  assert.equal(next.workspaceId, 'workspace')
  assert.equal(next.revision, 'revision-1')
  assert.deepEqual(next.workingProjectIds, { other: 'docs' })
  assert.ok(!Object.hasOwn(next, 'workingDirectories'))
  assert.deepEqual(draft.profileIds, ['a', 'other'])
  assert.deepEqual(draft.mountedProjectIds.a, ['app'])
})

test('batch changes preserve the mounted directory of legacy single-project sessions', () => {
  const next = withMountedProfiles({ profileIds: ['a'], workingProjectIds: { a: 'legacy' }, workingDirectories: { a: '/legacy' } }, ['a', 'b'])
  assert.deepEqual(next.mountedProjectIds, { a: ['legacy'], b: [] })
  assert.equal(next.workingProjectIds.a, 'legacy')
  assert.equal(next.workingDirectories.a, '/legacy')
})
