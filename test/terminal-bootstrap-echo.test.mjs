import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { TerminalBootstrapEcho } from '../lib/terminal-bootstrap-echo.js'
import { directoryPromptHook } from '../lib/terminal-shell-integration.js'

const start = ": 'dsh-init-test'; "
const end = "; : 'dsh-init-end-test'"
const completed = '\x1b]1337;DshInitDone=test\x07'
const command = start + directoryPromptHook().trimEnd() + "; printf '\\033]1337;DshInitDone=test\\007'" + end

test('bootstrap echo is removed across arbitrary chunk boundaries, preserving banners and errors', () => {
  const input = 'welcome\r\n$ ' + command + completed + '\r\nerror: test\r\n\x1b]1337;CurrentDir=/tmp\x07$ '
  for (const size of [1, 7, 128, input.length]) {
    const filter = new TerminalBootstrapEcho(command, start, end, completed)
    let output = ''
    for (let i = 0; i < input.length; i += size) output += filter.push(input.slice(i, i + size))
    output += filter.flush()
    assert.equal(output, 'welcome\r\n$ \r\nerror: test\r\n\x1b]1337;CurrentDir=/tmp\x07$ ')
    assert.equal(filter.push(command), command, 'later user output is never filtered')
  }
})

test('mismatched, incomplete and oversized echoes fail open without losing output', () => {
  for (const input of [start + 'unexpected error' + end, start + 'partial', start + 'x'.repeat(70_000)]) {
    const filter = new TerminalBootstrapEcho(command, start, end, completed)
    assert.equal(filter.push(input) + filter.flush(), input)
  }
})

test('real interactive Bash and dash retain cwd reports and user output without bootstrap text', { skip: process.platform !== 'linux' || spawnSync('script', ['--version']).status !== 0 }, () => {
  for (const shell of ['bash --noprofile --norc -i', 'dash -i']) {
    const result = spawnSync('script', ['-qfec', shell, '/dev/null'], {
      input: ' ' + command + '\ncd /tmp\nprintf "USER-OUTPUT\\n"\nexit\n', encoding: 'utf8', timeout: 5000,
      env: { ...process.env, TERM: 'xterm-256color' },
    })
    assert.equal(result.status, 0)
    const filter = new TerminalBootstrapEcho(command, start, end, completed)
    const output = filter.push(result.stdout) + filter.flush()
    assert.ok(!output.includes('dsh-init-test'), shell)
    assert.ok(output.includes('\x1b]1337;CurrentDir=/tmp\x07'), shell)
    assert.ok(output.includes('USER-OUTPUT'), shell)
  }
})
