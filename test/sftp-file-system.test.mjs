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
