import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { terminalDirectory } from '../lib/terminal-directory.js'
import { directoryPromptHook, detectPromptShell } from '../lib/terminal-shell-integration.js'

test('terminal directory metadata validates host, encoding, lengths and controls', () => {
  assert.equal(terminalDirectory('file://server/home/a%20b/%E4%B8%AD', 7, 'server'), '/home/a b/中')
  assert.equal(terminalDirectory('CurrentDir=/home/a%20b', 1337, 'server'), '/home/a%20b')
  for (const value of ['file://other/tmp', 'https://server/tmp', 'file://server/tmp%00', 'file://server/%ZZ', 'file://server/tmp?q=a']) assert.equal(terminalDirectory(value, 7, 'server'), undefined)
  for (const value of ['CurrentDir=relative', 'CurrentDir=/tmp\n', 'Other=/tmp', 'CurrentDir=/'+'a'.repeat(5000)]) assert.equal(terminalDirectory(value, 1337, 'server'), undefined)
})

test('Bash prompt integration preserves scalar and array hooks, reports actual cwd without changing startup files', () => {
  for (const setup of ["PROMPT_COMMAND='printf existing;';", "PROMPT_COMMAND=('printf existing');"]) {
    const script = setup + '\n' + directoryPromptHook() + '\ncd /tmp\nfor cmd in "${PROMPT_COMMAND[@]}"; do eval "$cmd"; done'
    const output = execFileSync('bash', ['--noprofile', '--norc', '-c', script], { encoding: 'utf8' })
    assert.ok(output.includes('existing'))
    assert.ok(output.includes('\x1b]1337;CurrentDir=/tmp\x07'))
  }
})

test('shell detection degrades safely for unsupported servers and failed exec', async () => {
  assert.equal(await detectPromptShell({ exec(_command, cb) { cb(new Error('unsupported')) } }), undefined)
  assert.equal(await detectPromptShell({}), undefined)
  for (const name of ['bash', 'zsh', 'sh', 'dash', 'ash', 'fish']) {
    let destroyed = false
    const shell = await detectPromptShell({ exec(command, cb) {
      assert.equal(command, 'printf "%s\\n" "${SHELL:-$0}"')
      const stream = new EventEmitter(); stream.stderr = new EventEmitter(); stream.destroy = () => { destroyed = true }
      cb(null, stream); stream.emit('data', Buffer.from(`/bin/${name}\n`)); stream.emit('close')
    } })
    assert.equal(shell, name === 'fish' ? undefined : ['sh', 'dash', 'ash'].includes(name) ? 'sh' : name); assert.equal(destroyed, true)
  }
})

test('actual interactive PTYs report cd even when account shell differs from running shell', { skip: process.platform !== 'linux' || spawnSync('script', ['--version']).status !== 0 }, () => {
  for (const shell of ['bash --noprofile --norc -i', 'dash -i']) {
    const result = spawnSync('script', ['-qfec', shell, '/dev/null'], {
      input: directoryPromptHook() + 'cd /tmp\ncd /\nexit\n', encoding: 'utf8', timeout: 5000,
    })
    assert.equal(result.status, 0, result.stderr)
    assert.ok(result.stdout.includes('\x1b]1337;CurrentDir=/tmp\x07'), shell)
    assert.ok(result.stdout.includes('\x1b]1337;CurrentDir=/\x07'), shell)
    assert.ok(!result.stdout.includes('Syntax error'), shell)
  }
})
