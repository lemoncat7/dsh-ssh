/** Resolve relative input against the displayed directory, not the server login cwd.
 * Leave dot segments to the filesystem so paths through symlinks keep their meaning.
 */
export function explorerInputPath(input: string, directory: string): string {
  const target = input.trim()
  if (!target || target.length > 4096 || /[\0\r\n]/.test(target)) throw new Error('请输入有效的目录或文件路径（最多 4096 字符，不能包含换行）')
  if (target.startsWith('/') || /^~(?:\/|$)/.test(target) || /^[A-Za-z]:[/\\]/.test(target) || target.startsWith('\\\\')) return target
  const resolved = directory ? `${directory.replace(/\/$/, '')}/${target}` : target
  if (resolved.length > 4096) throw new Error('路径过长，请缩短后重试')
  return resolved
}
