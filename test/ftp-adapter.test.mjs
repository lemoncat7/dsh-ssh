import assert from 'node:assert/strict'
import net from 'node:net'
import test from 'node:test'
import { connectFtpProfile, FtpFileSystemAdapter } from '../lib/ftp-adapter.js'
import { normalizeFtpProfileDraft } from '../lib/domain.js'
import { connectSocket } from '../lib/proxy.js'
import { scanRemoteTree } from '../lib/remote-tree-scan.js'

test('FTP uses the routed dialer for both control and passive data connections', async t => {
  const server = await createFtpServer()
  t.after(server.close)
  const calls = []
  const dialer = {
    async connect(host, port, route, timeout, signal) {
      calls.push({ host, port, route })
      return connectSocket(host, port, timeout, signal)
    },
  }
  const now = Date.now()
  const profile = {
    id: 'ftp-test', name: 'FTP Test', protocol: 'ftp', host: '127.0.0.1', port: server.port,
    username: 'tester', proxy: { type: 'none' }, initialPath: '/', connectTimeoutMs: 3000,
    createdAt: now, updatedAt: now,
  }
  const session = await connectFtpProfile(profile, 'secret', dialer)
  t.after(() => session.close())
  const directory = await session.list('/')
  assert.equal(directory.path, '/')
  assert.deepEqual(directory.entries.map(entry => [entry.name, entry.kind, entry.navigable ?? false, entry.size]), [['docs', 'directory', false, 0], ['hello.txt', 'file', false, 5], ['shortcut', 'symlink', false, 4]])
  assert.deepEqual((await session.list('/docs')).entries.map(entry => [entry.name, entry.kind, entry.size]), [['readme.md', 'file', 7]])
  assert.equal(calls.length, 3)
  assert.equal(calls[0].port, server.port)
  assert.notEqual(calls[1].port, server.port)
  assert.equal((await session.stat('/shortcut')).navigable, true)
  assert.equal((await session.list('/shortcut')).path, '/docs')
  await session.move('/hello.txt', '/docs/hello.txt')
  assert.deepEqual((await session.list('/')).entries.map(entry => [entry.name, entry.kind]), [['docs', 'directory'], ['shortcut', 'symlink']])
  assert.deepEqual((await session.list('/docs')).entries.map(entry => [entry.name, entry.kind]), [['hello.txt', 'file'], ['readme.md', 'file']])
  await session.remove('/docs/hello.txt', true)
})

test('large FTP listings have constant command count and resolve only the requested link', async t => {
  const rootListing = Array.from({ length: 3000 }, (_, i) => `-rw-r--r-- 1 test test 5 Jan 01 2026 file-${i}.txt\r\n`).join('')
    + Array.from({ length: 1000 }, (_, i) => `lrwxrwxrwx 1 test test 4 Jan 01 2026 shortcut-${i} -> docs\r\n`).join('')
    + 'lrwxrwxrwx 1 test test 4 Jan 01 2026 shortcut -> docs\r\n'
  const server = await createFtpServer({ rootListing })
  t.after(server.close)
  const session = await connectFtpProfile({
    id: 'large', name: 'Large', protocol: 'ftp', host: '127.0.0.1', port: server.port,
    username: 'tester', proxy: { type: 'none' }, initialPath: '/', connectTimeoutMs: 3000,
    createdAt: 0, updatedAt: 0,
  }, 'secret', { connect: (host, port, _route, timeout, signal) => connectSocket(host, port, timeout, signal) })
  t.after(() => session.close())
  server.commands.length = 0
  const directory = await session.list('/')
  assert.equal(directory.entries.length, 4001)
  assert.equal(directory.entries.find(entry => entry.name === 'shortcut').navigable, undefined)
  assert.equal(server.commands.filter(command => command.startsWith('LIST')).length, 1)
  assert.equal(server.commands.filter(command => command.startsWith('CWD')).length, 2)
  assert.ok(server.commands.length <= 8, server.commands.join('\n'))

  server.commands.length = 0
  assert.equal((await session.stat('/shortcut')).navigable, true)
  assert.deepEqual(server.commands.filter(command => command.startsWith('CWD /shortcut')), ['CWD /shortcut'])
  server.commands.length = 0
  assert.equal((await session.stat('/file-42.txt')).kind, 'file')
  assert.equal(server.commands.filter(command => command.startsWith('CWD /shortcut')).length, 0)
  assert.equal((await session.list('/shortcut')).path, '/docs')
  await assert.rejects(session.list('/file-42.txt'), /Not a directory/)
  assert.equal((await session.list('/docs')).path, '/docs', 'failed navigation restores control connection cwd')
  const tasks = await scanRemoteTree(session, ['/'], new AbortController().signal)
  assert.equal(tasks.length, 3001, 'recursive scans never follow links')
  const aborted = new AbortController()
  aborted.abort()
  server.commands.length = 0
  await assert.rejects(session.list('/', aborted.signal), /abort/i)
  assert.deepEqual(server.commands, [], 'already cancelled work must not issue FTP commands')
  assert.equal((await session.list('/docs')).path, '/docs')
})

test('anonymous FTP ignores private credentials and can browse directories', async t => {
  const server = await createFtpServer()
  t.after(server.close)
  const draft = normalizeFtpProfileDraft({ name: 'Public', protocol: 'ftp', host: '127.0.0.1', authMode: 'anonymous', credentialId: 'private' })
  assert.equal(draft.username, 'anonymous')
  assert.equal(draft.credentialId, undefined)
  const profile = { ...draft, id: 'public', port: server.port, createdAt: 0, updatedAt: 0 }
  const adapter = new FtpFileSystemAdapter({ ftpProfile: () => profile }, {
    readFtp() { throw new Error('must not read private password') },
  }, { connect: (host, port, _route, timeout, signal) => connectSocket(host, port, timeout, signal) })
  const session = await adapter.connect('public')
  t.after(() => session.close())
  assert.equal((await session.list('/docs')).entries[0].name, 'readme.md')
  assert.deepEqual(server.commands.filter(c => /^(USER|PASS) /.test(c)), ['USER anonymous', 'PASS anonymous@'])
})

test('FTP legacy authentication remains password-based and validates username', () => {
  const base = { name: 'Private', protocol: 'ftp', host: 'localhost' }
  assert.throws(() => normalizeFtpProfileDraft(base), /username/)
  assert.equal(normalizeFtpProfileDraft({ ...base, username: 'tester' }).authMode, 'password')
  assert.throws(() => normalizeFtpProfileDraft({ ...base, authMode: 'invalid' }), /authMode/)
})

async function createFtpServer({ rootListing } = {}) {
  const sockets = new Set()
  const commands = []
  const passiveServers = new Set()
  let helloLocation = 'root'
  const control = net.createServer(socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.setEncoding('utf8')
    socket.write('220 Test FTP ready\r\n')
    let input = ''
    let passive
    let passiveSocket
    let cwd = '/'
    socket.on('data', chunk => {
      input += chunk
      while (input.includes('\r\n')) {
        const end = input.indexOf('\r\n')
        const command = input.slice(0, end)
        commands.push(command)
        input = input.slice(end + 2)
        const [verb] = command.split(' ', 1)
        if (verb === 'USER') socket.write('331 Password required\r\n')
        else if (verb === 'PASS') socket.write('230 Logged in\r\n')
        else if (verb === 'FEAT') socket.write('211 No features\r\n')
        else if (verb === 'TYPE' || verb === 'STRU' || verb === 'OPTS') socket.write('200 OK\r\n')
        else if (verb === 'PWD') socket.write(`257 "${cwd}" is current directory\r\n`)
        else if (verb === 'CWD') {
          const target = command.slice(4).trim()
          if (target === '/' || target === '/docs' || target === '/shortcut') { cwd = target === '/shortcut' ? '/docs' : target; socket.write('250 Directory changed\r\n') }
          else socket.write('550 Not a directory\r\n')
        }
        else if (verb === 'EPSV') {
          passive = net.createServer(data => { passiveSocket = data })
          passiveServers.add(passive)
          passive.listen(0, '127.0.0.1', () => {
            const address = passive.address()
            socket.write(`229 Entering Extended Passive Mode (|||${address.port}|)\r\n`)
          })
        } else if (verb === 'LIST') {
          socket.write('150 Opening data connection\r\n')
          const requested = command.slice(4).trim().split(/\s+/).filter(token => !token.startsWith('-')).at(-1) || cwd
          const root = `${helloLocation === 'root' ? '-rw-r--r-- 1 test test 5 Jan 01 2026 hello.txt\r\n' : ''}drwxr-xr-x 1 test test 0 Jan 01 2026 docs\r\nlrwxrwxrwx 1 test test 4 Jan 01 2026 shortcut -> docs\r\n`
          const docs = `${helloLocation === 'docs' ? '-rw-r--r-- 1 test test 5 Jan 01 2026 hello.txt\r\n' : ''}-rw-r--r-- 1 test test 7 Jan 01 2026 readme.md\r\n`
          passiveSocket?.end(requested === '/docs' ? docs : rootListing ?? root)
          setTimeout(() => { socket.write('226 Transfer complete\r\n'); passive?.close(); passiveServers.delete(passive); passiveSocket = undefined }, 20)
        } else if (verb === 'RNFR') {
          socket.write(command.slice(5).trim() === '/hello.txt' && helloLocation === 'root' ? '350 Ready for destination\r\n' : '550 Not found\r\n')
        } else if (verb === 'RNTO') {
          if (command.slice(5).trim() === '/docs/hello.txt' && helloLocation === 'root') { helloLocation = 'docs'; socket.write('250 Renamed\r\n') } else socket.write('550 Rename failed\r\n')
        } else if (verb === 'DELE') {
          helloLocation = 'deleted'
          socket.write('250 File deleted\r\n')
        } else if (verb === 'QUIT') socket.end('221 Bye\r\n')
        else socket.write('502 Not implemented\r\n')
      }
    })
  })
  await new Promise((resolve, reject) => { control.once('error', reject); control.listen(0, '127.0.0.1', resolve) })
  const address = control.address()
  return {
    commands,
    port: address.port,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      for (const server of passiveServers) server.close()
      await new Promise(resolve => control.close(resolve))
    },
  }
}
