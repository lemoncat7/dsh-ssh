import assert from 'node:assert/strict'
import net from 'node:net'
import test from 'node:test'
import { connectFtpProfile } from '../lib/ftp-adapter.js'
import { connectSocket } from '../lib/proxy.js'

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
  assert.deepEqual(directory.entries.map(entry => [entry.name, entry.kind, entry.navigable ?? false, entry.size]), [['docs', 'directory', false, 0], ['hello.txt', 'file', false, 5], ['shortcut', 'symlink', true, 4]])
  assert.deepEqual((await session.list('/docs')).entries.map(entry => [entry.name, entry.kind, entry.size]), [['readme.md', 'file', 7]])
  assert.equal(calls.length, 3)
  assert.equal(calls[0].port, server.port)
  assert.notEqual(calls[1].port, server.port)
  await session.remove('/hello.txt', true)
  assert.deepEqual((await session.list('/')).entries.map(entry => [entry.name, entry.kind]), [['docs', 'directory'], ['shortcut', 'symlink']])
})

async function createFtpServer() {
  const sockets = new Set()
  const passiveServers = new Set()
  let helloExists = true
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
          const root = `${helloExists ? '-rw-r--r-- 1 test test 5 Jan 01 2026 hello.txt\r\n' : ''}drwxr-xr-x 1 test test 0 Jan 01 2026 docs\r\nlrwxrwxrwx 1 test test 4 Jan 01 2026 shortcut -> docs\r\n`
          passiveSocket?.end(requested === '/docs' ? '-rw-r--r-- 1 test test 7 Jan 01 2026 readme.md\r\n' : root)
          setTimeout(() => { socket.write('226 Transfer complete\r\n'); passive?.close(); passiveServers.delete(passive); passiveSocket = undefined }, 20)
        } else if (verb === 'DELE') {
          helloExists = false
          socket.write('250 File deleted\r\n')
        } else if (verb === 'QUIT') socket.end('221 Bye\r\n')
        else socket.write('502 Not implemented\r\n')
      }
    })
  })
  await new Promise((resolve, reject) => { control.once('error', reject); control.listen(0, '127.0.0.1', resolve) })
  const address = control.address()
  return {
    port: address.port,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      for (const server of passiveServers) server.close()
      await new Promise(resolve => control.close(resolve))
    },
  }
}
