import assert from 'node:assert/strict'
import test from 'node:test'
import { sortFileEntries } from '../lib/file-entry-sort.js'

const entries = [
  { name: 'zeta.txt', path: '/zeta.txt', kind: 'file', size: 20, modifiedAt: 300 },
  { name: 'folder-10', path: '/folder-10', kind: 'directory', size: 0, modifiedAt: 100 },
  { name: 'alpha.txt', path: '/alpha.txt', kind: 'file', size: 5, modifiedAt: 200 },
  { name: 'folder-2', path: '/folder-2', kind: 'directory', size: 0, modifiedAt: 400 },
]

test('sorts a copy by name, size, and modified time while keeping directories first', () => {
  assert.deepEqual(sortFileEntries(entries, 'name', 'asc').map(entry => entry.name), ['folder-2', 'folder-10', 'alpha.txt', 'zeta.txt'])
  assert.deepEqual(sortFileEntries(entries, 'size', 'desc').map(entry => entry.name), ['folder-2', 'folder-10', 'zeta.txt', 'alpha.txt'])
  assert.deepEqual(sortFileEntries(entries, 'modifiedAt', 'asc').map(entry => entry.name), ['folder-10', 'folder-2', 'alpha.txt', 'zeta.txt'])
  assert.deepEqual(entries.map(entry => entry.name), ['zeta.txt', 'folder-10', 'alpha.txt', 'folder-2'])
})
