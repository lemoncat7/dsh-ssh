import type { RemoteEndpointView, RemoteFileSystemAdapter, RemoteFileSystemSession } from './remote-files.js'
import { splitEndpointId } from './remote-files.js'

export class RemoteFileSystems {
  private readonly byKind = new Map<string, RemoteFileSystemAdapter>()
  constructor(adapters: RemoteFileSystemAdapter[]) {
    for (const adapter of adapters) this.byKind.set(adapter.kind, adapter)
  }

  endpoints(): RemoteEndpointView[] { return [...this.byKind.values()].flatMap(adapter => adapter.endpoints()) }
  endpoint(value: string): RemoteEndpointView | undefined {
    const parsed = splitEndpointId(value)
    return parsed === undefined ? undefined : this.byKind.get(parsed.kind)?.endpoint(parsed.id)
  }
  connect(value: string, signal?: AbortSignal): Promise<RemoteFileSystemSession> {
    const parsed = splitEndpointId(value)
    if (parsed === undefined) throw Object.assign(new Error(`invalid file endpoint ${value}`), { status: 400 })
    const adapter = this.byKind.get(parsed.kind)
    if (adapter === undefined) throw Object.assign(new Error(`file endpoint protocol ${parsed.kind} is unavailable`), { status: 404 })
    return adapter.connect(parsed.id, signal)
  }
}
