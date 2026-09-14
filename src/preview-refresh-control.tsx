import { IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

export function PreviewRefreshControl({ busy, blocked = false, automatic, available, onRefresh, onToggle }: {
  busy: boolean; blocked?: boolean; automatic: boolean; available: boolean; onRefresh(): void; onToggle(): void
}): JSX.Element {
  return <span className="dsh-ssh-preview-refresh" role="group" aria-label="预览刷新" data-automatic={automatic}>
    <button type="button" aria-label="刷新预览" title={blocked ? '请先保存正文修改' : busy ? '正在刷新…' : '刷新预览，保留阅读位置'} disabled={busy || blocked} onClick={onRefresh}><IconRefreshOutline16 size={16} /></button>
    <button type="button" className="dsh-ssh-preview-refresh-mode" aria-label="自动刷新" aria-pressed={automatic} disabled={!available} title={!available ? '此预览暂不支持自动刷新' : automatic ? '每 5 秒检查变化，点击切换为手动' : '当前手动刷新，点击开启自动刷新'} onClick={onToggle}>{automatic ? '自动' : '手动'}</button>
  </span>
}
