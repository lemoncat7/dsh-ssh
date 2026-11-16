import type { SshStore } from './store.js'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'

/** The host's public fork boundary supplies lineage even when seeded headers do not. */
export type SessionForkController = Pick<SessionController, 'fork'>

export function inheritSessionForks(controller: SessionForkController, store: SshStore): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(controller, 'fork')
  const original = controller.fork
  const wrapped: SessionForkController['fork'] = async function (this: SessionForkController, request) {
    const result = await original.call(this, request)
    // Await persistence before navigation/API callers can read the new session.
    // Existing child settings (including an explicit empty grant) always win.
    await store.inheritInjection(request.sessionId, result.sessionId)
    return result
  }
  controller.fork = wrapped
  return () => {
    // Cordis returns a fresh traced function when a service method is read.
    // Compare the underlying own descriptor rather than that proxy's identity.
    if (Object.getOwnPropertyDescriptor(controller, 'fork')?.value !== wrapped) return
    if (descriptor) Object.defineProperty(controller, 'fork', descriptor)
    else Reflect.deleteProperty(controller, 'fork')
  }
}
