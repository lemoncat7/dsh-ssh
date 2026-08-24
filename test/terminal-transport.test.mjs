import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { OrderedTerminalInput, TerminalOutputBuffer } from '../lib/terminal-io.js'
import { streamTerminalOutput } from '../lib/terminal-stream.js'

test('terminal output buffer provides cursor deltas and live notifications', () => {
  const output = new TerminalOutputBuffer(8, 6)
  const events = []
  const unsubscribe = output.subscribe(event => events.push(event))

  output.append('first')
  const cursor = output.read(0).cursor
  output.append(' next')

  assert.deepEqual(output.read(cursor), { data: ' next', cursor: 10, truncated: false, closed: false })
  assert.deepEqual(output.read(0), { data: 't next', cursor: 10, truncated: true, closed: false })
  output.close()
  assert.equal(events.at(-1).closed, true)
  assert.equal(events.at(-1).cursor, 10)

  unsubscribe()
})

test('concurrent browser input is written in sequence order', () => {
  const writes = []
  const input = new OrderedTerminalInput(text => writes.push(text))

  input.push(1, 'b')
  input.push(0, 'a')
  input.push(3, 'd')
  input.push(2, 'c')
  input.push(2, 'duplicate')

  assert.deepEqual(writes, ['a', 'b', 'c', 'd'])
})

test('terminal SSE sends the cursor snapshot immediately without proxy buffering', async t => {
  const output = new TerminalOutputBuffer(1024, 1024)
  output.append('ready')
  const server = createServer((request, response) => {
    void streamTerminalOutput(request, response, new URL(request.url, 'http://localhost'), output)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const address = server.address()
  assert.equal(typeof address, 'object')

  const response = await fetch(`http://127.0.0.1:${address.port}/stream?cursor=0`)
  assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8')
  assert.equal(response.headers.get('x-accel-buffering'), 'no')
  const reader = response.body.getReader()
  const firstEvent = await readEvent(reader)
  assert.match(firstEvent, /data: \{"data":"ready","cursor":5,"truncated":false,"closed":false\}/)

  output.append(' now')
  const nextEvent = await readEvent(reader)
  assert.match(nextEvent, /data: \{"data":" now","cursor":9,"truncated":false,"closed":false\}/)
  await reader.cancel()
})

async function readEvent(reader) {
  const decoder = new TextDecoder()
  let value = ''
  while (!value.includes('\n\n')) {
    const chunk = await reader.read()
    if (chunk.done) break
    value += decoder.decode(chunk.value, { stream: true })
  }
  return value
}
