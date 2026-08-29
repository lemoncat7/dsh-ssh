import assert from 'node:assert/strict'
import test from 'node:test'
import { deleteRemoteEntries, moveRemoteEntries } from '../lib/remote-entry-operations.js'

function sessionWith(directories) {
  const moved = []
  const removed = []
  return {
    moved,
    removed,
    async list(path) {
      const entries = directories[path]
      if (entries === undefined) throw Object.assign(new Error('not found'), { status: 404 })
      return { path, parent: null, entries }
    },
    async move(source, destination) { moved.push([source, destination]) },
    async remove(path, recursive) { removed.push([path, recursive]) },
  }
}

test('moves only direct children into a validated destination', async () => {
  const session = sessionWith({
    '/source': [{ name: 'alpha.txt', path: '/source/alpha.txt', kind: 'file' }, { name: 'docs', path: '/source/docs', kind: 'directory' }],
    '/target': [],
  })
  await moveRemoteEntries(session, { directory: '/source', destinationDirectory: '/target', paths: ['/source/alpha.txt', '/source/docs'] })
  assert.deepEqual(session.moved, [['/source/alpha.txt', '/target/alpha.txt'], ['/source/docs', '/target/docs']])
})

test('rejects move conflicts, non-child sources, and descendant targets before mutation', async () => {
  const source = [{ name: 'docs', path: '/source/docs', kind: 'directory' }]
  const conflict = sessionWith({ '/source': source, '/target': [{ name: 'docs', path: '/target/docs', kind: 'directory' }] })
  await assert.rejects(() => moveRemoteEntries(conflict, { directory: '/source', destinationDirectory: '/target', paths: ['/source/docs'] }), error => error.status === 409)
  assert.deepEqual(conflict.moved, [])

  const descendant = sessionWith({ '/source': source, '/source/docs/archive': [] })
  await assert.rejects(() => moveRemoteEntries(descendant, { directory: '/source', destinationDirectory: '/source/docs/archive', paths: ['/source/docs'] }), error => error.status === 400)
  assert.deepEqual(descendant.moved, [])

  const missing = sessionWith({ '/source': source, '/target': [] })
  await assert.rejects(() => moveRemoteEntries(missing, { directory: '/source', destinationDirectory: '/target', paths: ['/source/missing.txt'] }), error => error.status === 404)
  assert.deepEqual(missing.moved, [])
})

test('deletes only direct children and keeps recursive directory behavior explicit', async () => {
  const session = sessionWith({ '/source': [{ name: 'docs', path: '/source/docs', kind: 'directory' }] })
  await deleteRemoteEntries(session, { directory: '/source', paths: ['/source/docs'] })
  assert.deepEqual(session.removed, [['/source/docs', true]])
})
