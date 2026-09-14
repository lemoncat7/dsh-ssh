import { createHash } from 'node:crypto'

export const MAX_MARKDOWN_EDIT_BYTES = 262144
export interface MarkdownSaveRequest { path: string; text: string; expectedHash: string }
export const markdownHash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')
export function markdownError(status: number, message: string): Error { return Object.assign(new Error(message), { status }) }
export function parseMarkdownSave(body: Record<string, unknown>): MarkdownSaveRequest {
  if (typeof body.path !== 'string' || !body.path || body.path.length > 4096 || !/\.md$/i.test(body.path) || body.path.includes('\0')) throw markdownError(400, '仅支持编辑 .md 文件')
  if (typeof body.text !== 'string' || Buffer.byteLength(body.text) > MAX_MARKDOWN_EDIT_BYTES) throw markdownError(413, 'Markdown 编辑上限为 256 KB')
  if (typeof body.expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedHash)) throw markdownError(400, '缺少有效的文件版本，请重新打开文件')
  return { path: body.path, text: body.text, expectedHash: body.expectedHash }
}

const saving = new Set<string>()
/** Serializes our writers. External changes are checked again just before replacement. */
export async function saveMarkdownWithAdapter(key: string, request: MarkdownSaveRequest, adapter: {
  read(): Promise<Buffer>; stage(text: string): Promise<void>; commit(): Promise<void>; cleanup(): Promise<void>
}): Promise<{ contentHash: string }> {
  parseMarkdownSave(request as unknown as Record<string, unknown>)
  if (saving.has(key)) throw markdownError(409, '文件正在保存，请稍后重试')
  saving.add(key)
  try {
    const before = await adapter.read()
    if (before.length > MAX_MARKDOWN_EDIT_BYTES) throw markdownError(413, '文件超过 256 KB，不能直接编辑')
    try { new TextDecoder('utf-8', { fatal: true }).decode(before) } catch { throw markdownError(400, '仅支持 UTF-8 Markdown 文件') }
    const contentHash = markdownHash(request.text)
    const previousHash = markdownHash(before)
    if (previousHash === contentHash) return { contentHash }
    if (previousHash !== request.expectedHash) throw markdownError(409, '文件已被其他地方修改，未覆盖远端；请保留草稿并重新打开核对')
    await adapter.stage(request.text)
    if (markdownHash(await adapter.read()) !== previousHash) throw markdownError(409, '保存期间文件发生变化，已停止写入')
    await adapter.commit()
    return { contentHash }
  } finally {
    try { await adapter.cleanup() } finally { saving.delete(key) }
  }
}
