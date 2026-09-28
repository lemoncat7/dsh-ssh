/** Coalesce concurrent reads only. Do not cache access decisions or stale data. */
export function createSharedRead<T>(read: () => Promise<T>): { read(): Promise<T>; invalidate(): void } {
  let pending: Promise<T> | undefined
  return {
    read() {
      if (pending) return pending
      const request = Promise.resolve().then(read)
      pending = request
      const clear = (): void => { if (pending === request) pending = undefined }
      void request.then(clear, clear)
      return request
    },
    invalidate() { pending = undefined },
  }
}
