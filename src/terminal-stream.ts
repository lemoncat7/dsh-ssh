import type { IncomingMessage, ServerResponse } from 'node:http'
import type { TerminalOutputDelta, TerminalOutputListener } from './terminal-io.js'

export interface TerminalOutputSource {
  read(cursor: number): TerminalOutputDelta
  subscribe(listener: TerminalOutputListener): () => void
}

/** Streams terminal output as resumable SSE and disables reverse-proxy buffering. */
export function streamTerminalOutput(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  source: TerminalOutputSource,
): Promise<void> {
  const cursor = parseCursor(req, url)
  res.statusCode = 200
  res.setHeader('Cache-Control', 'no-cache, no-store, no-transform')
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.flushHeaders()

  return new Promise(resolve => {
    let finished = false
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let unsubscribe = (): void => {}
    const cleanup = (): void => {
      if (finished) return
      finished = true
      if (heartbeat !== undefined) clearInterval(heartbeat)
      unsubscribe()
      resolve()
    }
    const send = (output: TerminalOutputDelta): void => {
      if (finished || res.destroyed || res.writableEnded) return cleanup()
      res.write(`id: ${output.cursor}\ndata: ${JSON.stringify(output)}\n\n`)
      if (output.closed) {
        res.end()
        cleanup()
      }
    }

    res.once('close', cleanup)
    res.once('finish', cleanup)
    unsubscribe = source.subscribe(send)
    heartbeat = setInterval(() => {
      if (!finished && !res.destroyed && !res.writableEnded) res.write(': keepalive\n\n')
    }, 15_000)
    send(source.read(cursor))
  })
}

function parseCursor(req: IncomingMessage, url: URL): number {
  const header = Array.isArray(req.headers['last-event-id']) ? req.headers['last-event-id'][0] : req.headers['last-event-id']
  const value = Number(header ?? url.searchParams.get('cursor') ?? 0)
  if (!Number.isSafeInteger(value) || value < 0) throw Object.assign(new Error('terminal cursor is invalid'), { status: 400 })
  return value
}
