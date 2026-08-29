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
  assert.deepEqual(directory.entries.map(entry => [entry.name, entry.kind, entry.size]), [['hello.txt', 'file', 5]])
  assert.equal(calls.length, 2)
  assert.equal(calls[0].port, server.port)
  assert.notEqual(calls[1].port, server.port)
  await session.remove('/hello.txt', true)
  assert.deepEqual((await session.list('/')).entries, [])
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
        else if (verb === 'PWD') socket.write('257 "/" is current directory\r\n')
        else if (verb === 'CWD') socket.write('250 Directory changed\r\n')
        else if (verb === 'EPSV') {
          passive = net.createServer(data => {
            data.end(helloExists ? '-rw-r--r-- 1 test test 5 Jan 01 2026 hello.txt\r\n' : '')
          })
          passiveServers.add(passive)
          passive.listen(0, '127.0.0.1', () => {
            const address = passive.address()
            socket.write(`229 Entering Extended Passive Mode (|||${address.port}|)\r\n`)
          })
        } else if (verb === 'LIST') {
          socket.write('150 Opening data connection\r\n')
          setTimeout(() => { socket.write('226 Transfer complete\r\n'); passive?.close(); passiveServers.delete(passive) }, 20)
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
