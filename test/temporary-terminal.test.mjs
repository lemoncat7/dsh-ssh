import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { parseTemporarySshCommand } from '../lib/temporary-terminal.js'
import { TerminalDeskState } from '../lib/terminal-desk-state.js'
import { readTerminalStorage } from '../lib/terminal-workspace-state.js'
import { registerSshApi } from '../lib/api.js'

test('temporary SSH accepts standard destinations and port placement, rejecting shell commands and other flags', () => {
  assert.deepEqual(parseTemporarySshCommand('ssh ops@example.test'), { username: 'ops', host: 'example.test', port: 22 })
  assert.deepEqual(parseTemporarySshCommand('ssh -p 2222 root@[2001:db8::2]'), { username: 'root', host: '2001:db8::2', port: 2222 })
  assert.deepEqual(parseTemporarySshCommand('ssh dev@192.0.2.1 -p2201'), { username: 'dev', host: '192.0.2.1', port: 2201 })
  for (const input of ['ssh root@host whoami','ssh -oProxyCommand=foo root@host','ssh root@host;cat','ssh -p 0 a@host','ssh -p 22 a@host -p 23','ssh host','ssh a@[host]','ssh a@host\nls']) {
    assert.throws(() => parseTemporarySshCommand(input), {status:400})
  }
})

test('temporary terminal state does not persist a login target or allow additional panes', async () => {
  const scope = 'test-temporary-terminal'
  const desk = new TerminalDeskState(scope)
  const saved = desk.open({ profileId:'saved', path:'~' })
  const tab = desk.open({profileId:'temp', path:'~', temporary:{host:'example.test',username:'dev',port:22}}, true, true, 'browser-terminal')
  assert.equal(tab.panes[0].handle.id,'browser-terminal')
  assert.deepEqual(readTerminalStorage('dsh-ssh:terminal-desk:v2:'+scope).tabs.map(item=>item.id),[saved.id])
  await assert.rejects(desk.applyLayout(tab.id,'grid',async()=>{}), /single pane/)
  const removed=[]
  assert.deepEqual(await desk.close([tab.id],async id=>{removed.push(id)}),[])
  assert.deepEqual(removed,['browser-terminal'])
})

test('temporary browser API uses a one-time draft, validates input, and leaves the saved-host store untouched', async t => {
  let route
  let created = 0
  registerSshApi({register(value){route=value;return ()=>{}}},'/ssh-local/v1',{
    terminals:{async createTemporary(profile,secrets,cols,rows){
      created++
      assert.equal(profile.host,'example.test')
      assert.equal(profile.username,'dev')
      assert.equal(profile.port,2200)
      assert.equal(profile.authType,'password')
      assert.equal(profile.hostFingerprint,'SHA256:'+'a'.repeat(64))
      assert.deepEqual(secrets,{password:'fixture-password'})
      assert.deepEqual([cols,rows],[120,32])
      return {id:'terminal',profileId:profile.id}
    }},
  })
  const server=createServer((req,res)=>void route.handler(req,res))
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(()=>new Promise(resolve=>server.close(resolve)))
  const send=(body,authorized=true)=>fetch(`http://127.0.0.1:${server.address().port}/ssh-local/v1/terminals/temporary`,{
    method:'POST',headers:{'Content-Type':'application/json',...(authorized?{'X-DSH-SSH-Request':'1'}:{})},body:JSON.stringify(body),
  })
  assert.equal((await send({},false)).status,403)
  assert.equal((await send({command:'ssh dev@example.test -p 2200',fingerprint:'unexpected'})).status,400)
  assert.equal(created,0)
  const accepted=await send({command:'ssh dev@example.test -p 2200',password:'fixture-password',fingerprint:'SHA256:'+'a'.repeat(64)})
  assert.equal(accepted.status,201)
  const result=await accepted.json()
  assert.deepEqual(result,{id:'terminal',profileId:result.profileId,host:'example.test',username:'dev',port:2200})
  assert.equal(created,1)
})

test('temporary terminal verifies the host key, opens a real SSH shell and closes it', async t => {
  const { generateKeyPairSync } = await import('node:crypto')
  const { once } = await import('node:events')
  const { default: ssh2 } = await import('ssh2')
  const { SshConnector, HostKeyRequiredError } = await import('../lib/connector.js')
  const { BrowserTerminalManager } = await import('../lib/terminal.js')
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const peers = new Set()
  let authentications = 0
  const server = new ssh2.Server({ hostKeys: [privateKey.export({ type: 'pkcs1', format: 'pem' })] }, client => {
    peers.add(client)
    client.on('error', () => {}).once('close', () => peers.delete(client))
    client.on('authentication', context => {
      if (context.method === 'password' && context.username === 'fixture' && context.password === 'fixture') {
        authentications++
        context.accept()
      } else context.reject(['password'])
    })
    client.on('ready', () => client.on('session', accept => {
      const session = accept()
      session.on('pty', acceptPty => acceptPty())
      session.on('shell', acceptShell => {
        const shell = acceptShell()
        shell.write('Temporary shell fixture\n')
        shell.once('data', bytes => shell.write(bytes))
        shell.once('eof', () => shell.end())
      })
    }))
  })
  const connector = new SshConnector({ settings: () => ({}), groupProxies: () => [] }, {})
  const manager = new BrowserTerminalManager(connector)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => { await manager.closeAll(); connector.close(); for (const peer of peers) peer.end(); await new Promise(resolve => server.close(resolve)) })
  const profile = {
    id: 'temporary', name: 'Temporary', host: '127.0.0.1', username: 'fixture', port: server.address().port,
    authType: 'password', proxy: { type: 'none' }, terminalType: 'xterm-256color',
    connectTimeoutMs: 3000, keepAliveIntervalMs: 0, tags: [], createdAt: 0, updatedAt: 0,
  }
  let fingerprint
  await assert.rejects(manager.createTemporary(profile, { password: 'fixture' }, 100, 30), error => {
    if (!(error instanceof HostKeyRequiredError)) return false
    fingerprint = error.fingerprint
    return true
  })
  assert.equal(authentications, 0)
  const result = await manager.createTemporary({ ...profile, hostFingerprint: fingerprint }, { password: 'fixture' }, 100, 30)
  assert.equal(authentications, 1)
  const terminal = manager.get(result.id)
  assert.ok(terminal.attach(profile.id).inputEpoch)
  terminal.write('fixture input\n')
  for (let attempt = 0; attempt < 40 && !terminal.read(0).data.includes('fixture input'); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  const output = terminal.read(0).data
  assert.match(output, /Temporary shell fixture/)
  assert.match(output, /fixture input/)
  await terminal.close()
  assert.throws(() => manager.get(result.id), {status:404})
})
