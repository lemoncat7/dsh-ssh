import { randomUUID } from 'node:crypto'
import type { SavedCommand } from './domain.js'
import type { SshStore } from './store.js'

export function commandDraft(value: unknown): Pick<SavedCommand, 'name' | 'command'> {
  if (typeof value !== 'object' || value === null) throw invalid('命令内容无效')
  const { name, command } = value as Record<string, unknown>
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw invalid('名称需为 1–80 个字符')
  const normalized = typeof command === 'string' ? command.replace(/\r\n/g, '\n') : ''
  if (!normalized.trim() || normalized.length > 16000 || /[\x00-\x08\x0b-\x1f\x7f]/.test(normalized)) throw invalid('命令需为 1–16000 个字符，不能包含终端控制字符')
  return { name: name.trim(), command: normalized }
}

export async function saveCommand(store: SshStore, value: unknown, id?: string): Promise<SavedCommand> {
  const draft = commandDraft(value)
  let saved!: SavedCommand
  await store.update(state => {
    const commands = state.commands ??= []
    const previous = id === undefined ? undefined : commands.find(item => item.id === id)
    if (id !== undefined && previous === undefined) throw Object.assign(new Error('命令已删除，请刷新'), { status: 404 })
    if (!previous && commands.length >= 500) throw invalid('最多保存 500 条命令')
    saved = { ...draft, id: previous?.id ?? randomUUID(), createdAt: previous?.createdAt ?? Date.now(), updatedAt: Date.now() }
    state.commands = [...commands.filter(item => item.id !== saved.id), saved]
  })
  return saved
}

function invalid(message: string): Error { return Object.assign(new Error(message), { status: 400 }) }
