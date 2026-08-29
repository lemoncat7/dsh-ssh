import assert from 'node:assert/strict'
import test from 'node:test'
import { openSftpFileSystemSession } from '../lib/sftp.js'

test('normalizes a missing SFTP leaf path as a standard not-found result', async t => {
  let channelClosed = false
  let connectionClosed = false
  const missing = Object.assign(new Error('No such file'), { code: 2 })
  const channel = {
    realpath(value, callback) {
      if (value === '.') callback(undefined, '/home/dev')
      else callback(missing)
    },
    end() { channelClosed = true },
  }
  const connector = {
    async connect() {
      return {
        client: { sftp(callback) { callback(undefined, channel) } },
        close() { connectionClosed = true },
      }
    },
  }
  const endpoint = { id: 'sftp:test', kind: 'sftp', protocol: 'sftp', name: 'test', address: 'test', initialPath: '~' }
  const session = await openSftpFileSystemSession(connector, 'test', endpoint)
  t.after(() => session.close())

  await assert.rejects(() => session.stat('/home/dev/new-file.txt'), error => {
    assert.equal(error.status, 404)
    assert.equal(error.code, 'ENOENT')
    assert.match(error.message, /new-file\.txt/)
    return true
  })
  session.close()
  assert.equal(channelClosed, true)
  assert.equal(connectionClosed, true)
})

test('recursively removes SFTP directories without following symbolic links', async t => {
  const removed = []
  const entries = new Map([
    ['/home/dev/folder', 'directory'],
    ['/home/dev/folder/a.txt', 'file'],
    ['/home/dev/folder/nested', 'directory'],
    ['/home/dev/folder/nested/b.txt', 'file'],
    ['/home/dev/folder/link', 'symlink'],
  ])
  const channel = {
    realpath(value, callback) { callback(undefined, value === '.' ? '/home/dev' : value) },
    lstat(value, callback) {
      const kind = entries.get(value)
      if (kind === undefined) callback(Object.assign(new Error('No such file'), { code: 2 }))
      else callback(undefined, { mode: kind === 'directory' ? 0o040755 : kind === 'symlink' ? 0o120777 : 0o100644 })
    },
    readdir(value, callback) {
      const prefix = `${value}/`
      const children = [...entries.keys()].filter(candidate => candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes('/')).map(candidate => ({ filename: candidate.slice(prefix.length) }))
      callback(undefined, children)
    },
    unlink(value, callback) { removed.push(`unlink:${value}`); entries.delete(value); callback() },
    rmdir(value, callback) { removed.push(`rmdir:${value}`); entries.delete(value); callback() },
    end() {},
  }
  const connector = { async connect() { return { client: { sftp(callback) { callback(undefined, channel) } }, close() {} } } }
  const endpoint = { id: 'sftp:test', kind: 'sftp', protocol: 'sftp', name: 'test', address: 'test', initialPath: '~' }
  const session = await openSftpFileSystemSession(connector, 'test', endpoint)
  t.after(() => session.close())

  await session.remove('/home/dev/folder', true)
  assert.deepEqual(removed, [
    'unlink:/home/dev/folder/a.txt',
    'unlink:/home/dev/folder/nested/b.txt',
    'rmdir:/home/dev/folder/nested',
    'unlink:/home/dev/folder/link',
    'rmdir:/home/dev/folder',
  ])
  assert.equal(entries.size, 0)
})
