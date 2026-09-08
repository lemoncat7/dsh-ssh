import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import { statLocalWorkspacePath } from './local-workspace.js'

export type NativeDirectoryController = Pick<SessionController, 'canOpenWorkspacePath' | 'openWorkspacePath'>

/** Reuse the Host opener only after resolving a directory inside the session. */
export async function openSessionDirectory(controller: NativeDirectoryController | undefined, root: string, path: string, signal: AbortSignal): Promise<void> {
  if (!controller?.canOpenWorkspacePath()) throw Object.assign(new Error('DSH 运行环境不支持系统文件管理器，请使用目录弹窗或下载'), { status: 409 })
  const entry = await statLocalWorkspacePath(root, path)
  if (entry.kind !== 'directory') throw Object.assign(new Error('只能在文件管理器中打开目录'), { status: 400 })
  signal.throwIfAborted()
  await controller.openWorkspacePath({ path: entry.path }, signal)
}
