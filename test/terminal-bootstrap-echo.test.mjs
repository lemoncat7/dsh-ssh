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

test('readline right-margin blanks are hidden even when markers wrap and transport chunks split controls', () => {
  for (const width of [20, 57, 120]) {
    const echoed = command.match(new RegExp(`.{1,${width}}`, 'g')).join(' \r')
    const input = 'banner\r\n$ ' + echoed + '\r\n' + completed + 'real error\r\n\x1b]1337;CurrentDir=/tmp\x07$ '
    for (const size of [1, 2, 7, 128, input.length]) {
      const filter = new TerminalBootstrapEcho(command, start, end, completed)
      let output = ''
      for (let i = 0; i < input.length; i += size) output += filter.push(input.slice(i, i + size))
      output += filter.flush()
      assert.equal(output, 'banner\r\n$ \r\nreal error\r\n\x1b]1337;CurrentDir=/tmp\x07$ ', `${width}/${size}`)
    }
  }
})

test('decorated markers and failed wrapped matches preserve all unrelated raw output', () => {
  const decorated = command.split('').map((c, i) => i % 13 === 0 ? '\x1b[32m' + c : c).join('')
  const filter = new TerminalBootstrapEcho(command, start, end, completed)
  let output = ''
  for (const char of decorated + completed) output += filter.push(char)
  assert.equal(output + filter.flush(), '\x1b[32m', 'styling before the bootstrap marker remains untouched')
  const mismatch = start + 'user output \rwith an error' + end
  const failing = new TerminalBootstrapEcho(command, start, end, completed)
  assert.equal(failing.push(mismatch) + failing.flush(), mismatch)
  for (const raw of ['plain \r\ntext\r\n', 'partial\x1b[3', 'trailing \r']) {
    const passthrough = new TerminalBootstrapEcho(command, start, end, completed)
    let result = ''; for (const c of raw) result += passthrough.push(c)
    assert.equal(result + passthrough.flush(), raw)
  }
})
