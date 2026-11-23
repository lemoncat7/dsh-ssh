import { isIP } from 'node:net'

export function parseTemporarySshCommand(value: string): { username: string; host: string; port: number } {
  if (/[\r\n]/.test(value)) throw invalidCommand()
  const tokens = value.trim().split(/\s+/)
  if (tokens.shift() !== 'ssh') throw invalidCommand()
  let port = 22
  let hasPort = false
  let destination: string | undefined
  while (tokens.length) {
    const token = tokens.shift()!
    if (token.startsWith('-p')) {
      const argument = token.length === 2 ? tokens.shift() : token.slice(2)
      if (hasPort || !argument || !/^\d{1,5}$/.test(argument)) throw invalidCommand()
      port = Number(argument)
      if (port < 1 || port > 65_535) throw invalidCommand()
      hasPort = true
    } else {
      if (destination || token.startsWith('-')) throw invalidCommand()
      destination = token
    }
  }
  const match = /^([a-z0-9_.][a-z0-9_.-]{0,63})@(.+)$/i.exec(destination ?? '')
  if (!match) throw invalidCommand()
  const rawHost = match[2]!
  const host = rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost
  const domain = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.?$/i
  if (!(host.length <= 253 && (domain.test(rawHost) || isIP(host) === 6 && /^[0-9a-f:.]+$/i.test(host)))) throw invalidCommand()
  return { username: match[1]!, host, port }
}

function invalidCommand(): Error {
  return Object.assign(new Error('请输入 ssh 用户名@主机，可用 -p 指定端口'), { status: 400 })
}
