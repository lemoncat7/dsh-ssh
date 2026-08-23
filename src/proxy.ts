import { Buffer } from 'node:buffer'
import net, { type Socket } from 'node:net'

export interface ProxyCredentials { username?: string; password?: string }

export async function connectHttpProxy(
  proxyHost: string,
  proxyPort: number,
  targetHost: string,
  targetPort: number,
  credentials: ProxyCredentials,
  timeoutMs: number,
): Promise<Socket> {
  const socket = await connectSocket(proxyHost, proxyPort, timeoutMs)
  const authority = `${targetHost}:${targetPort}`
  const headers = [`CONNECT ${authority} HTTP/1.1`, `Host: ${authority}`, 'Proxy-Connection: Keep-Alive']
  if (credentials.username !== undefined) {
    const token = Buffer.from(`${credentials.username}:${credentials.password ?? ''}`).toString('base64')
    headers.push(`Proxy-Authorization: Basic ${token}`)
  }
  socket.write(`${headers.join('\r\n')}\r\n\r\n`)
  const response = (await readUntil(socket, Buffer.from('\r\n\r\n'), 32_768, timeoutMs)).toString('latin1')
  const status = /^HTTP\/\d(?:\.\d)?\s+(\d{3})\b/.exec(response)?.[1]
  if (status !== '200') {
    socket.destroy()
    throw new Error(`HTTP proxy CONNECT failed${status === undefined ? '' : ` with status ${status}`}`)
  }
  return socket
}

export async function connectSocks5Proxy(
  proxyHost: string,
  proxyPort: number,
  targetHost: string,
  targetPort: number,
  credentials: ProxyCredentials,
  timeoutMs: number,
): Promise<Socket> {
  const socket = await connectSocket(proxyHost, proxyPort, timeoutMs)
  const useAuth = credentials.username !== undefined
  socket.write(Buffer.from(useAuth ? [5, 2, 0, 2] : [5, 1, 0]))
  const greeting = await readExact(socket, 2, timeoutMs)
  if (greeting[0] !== 5 || greeting[1] === 0xff) throw closeError(socket, 'SOCKS5 proxy rejected authentication methods')
  if (greeting[1] === 2) {
    const username = Buffer.from(credentials.username ?? '', 'utf8')
    const password = Buffer.from(credentials.password ?? '', 'utf8')
    if (username.length > 255 || password.length > 255) throw closeError(socket, 'SOCKS5 credentials are too long')
    socket.write(Buffer.concat([Buffer.from([1, username.length]), username, Buffer.from([password.length]), password]))
    const auth = await readExact(socket, 2, timeoutMs)
    if (auth[1] !== 0) throw closeError(socket, 'SOCKS5 proxy authentication failed')
  } else if (greeting[1] !== 0) {
    throw closeError(socket, `SOCKS5 proxy selected unsupported authentication method ${String(greeting[1])}`)
  }
  const host = Buffer.from(targetHost, 'utf8')
  if (host.length > 255) throw closeError(socket, 'SOCKS5 target host is too long')
  socket.write(Buffer.concat([
    Buffer.from([5, 1, 0, 3, host.length]), host,
    Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff]),
  ]))
  const head = await readExact(socket, 4, timeoutMs)
  if (head[0] !== 5 || head[1] !== 0) throw closeError(socket, `SOCKS5 proxy connection failed with code ${String(head[1])}`)
  const atyp = head[3]
  if (atyp === 1) await readExact(socket, 4 + 2, timeoutMs)
  else if (atyp === 4) await readExact(socket, 16 + 2, timeoutMs)
  else if (atyp === 3) {
    const length = (await readExact(socket, 1, timeoutMs))[0]
    await readExact(socket, (length ?? 0) + 2, timeoutMs)
  } else throw closeError(socket, 'SOCKS5 proxy returned an invalid address type')
  return socket
}

export async function connectSocket(host: string, port: number, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port })
    const timer = setTimeout(() => socket.destroy(new Error(`connection to ${host}:${port} timed out`)), timeoutMs)
    const cleanup = (): void => { clearTimeout(timer); socket.off('error', reject) }
    socket.once('connect', () => { cleanup(); resolve(socket) })
    socket.once('error', reject)
  })
}

async function readUntil(socket: Socket, marker: Buffer, max: number, timeoutMs: number): Promise<Buffer> {
  let buffer = Buffer.alloc(0)
  while (buffer.indexOf(marker) < 0) {
    const chunk = await readChunk(socket, timeoutMs)
    buffer = Buffer.concat([buffer, chunk])
    if (buffer.length > max) throw closeError(socket, 'proxy response exceeded limit')
  }
  const end = buffer.indexOf(marker) + marker.length
  const extra = buffer.subarray(end)
  if (extra.length > 0) socket.unshift(extra)
  return buffer.subarray(0, end)
}

async function readExact(socket: Socket, length: number, timeoutMs: number): Promise<Buffer> {
  let buffer = Buffer.alloc(0)
  while (buffer.length < length) buffer = Buffer.concat([buffer, await readChunk(socket, timeoutMs)])
  const extra = buffer.subarray(length)
  if (extra.length > 0) socket.unshift(extra)
  return buffer.subarray(0, length)
}

function readChunk(socket: Socket, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer): void => { cleanup(); resolve(chunk) }
    const onError = (error: Error): void => { cleanup(); reject(error) }
    const onEnd = (): void => { cleanup(); reject(new Error('proxy closed the connection')) }
    const timer = setTimeout(() => { cleanup(); reject(new Error('proxy handshake timed out')) }, timeoutMs)
    const cleanup = (): void => {
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onError)
      socket.off('end', onEnd)
    }
    socket.once('data', onData)
    socket.once('error', onError)
    socket.once('end', onEnd)
  })
}

function closeError(socket: Socket, message: string): Error {
  socket.destroy()
  return new Error(message)
}
