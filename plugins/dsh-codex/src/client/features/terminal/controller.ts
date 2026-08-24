/**
 * A terminal controller owns one terminal session and knows how to run a
 * command in it. `run` is the single entry point used by consumers that want
 * to drive a terminal without holding a direct reference to the view.
 */
export interface TerminalController {
  /** Run a command in the terminal. An empty command is rejected. */
  run(command: string): Promise<void>
}

/**
 * A registry of terminal controllers keyed by id.
 *
 * The store bridges two producer/consumer timings:
 *
 * - A consumer may need a controller that has not been registered yet. It calls
 *   `waitFor(id)`, which stays pending until `register(id, controller)` runs,
 *   then resolves with that controller. If the id is already registered,
 *   `waitFor` resolves immediately.
 * - A producer registers a controller, replacing any controller previously
 *   registered under the same id. Every controller is wrapped so that an empty
 *   command rejects regardless of the underlying implementation.
 *
 * `dispose` makes the store terminal: every pending `waitFor` is rejected and
 * all registrations are dropped. Registering after dispose is a misuse and
 * throws.
 */
export interface TerminalControllerStore {
  /**
   * Register a controller by id. Returns a removal function that clears the
   * registration only if it is still the one being removed (so replacing an id
   * does not let a stale removal function clear the replacement).
   */
  register(id: string, controller: TerminalController): () => void
  /** Resolve with the controller for `id` once it is registered. */
  waitFor(id: string): Promise<TerminalController>
  /** Reject every pending `waitFor` and clear all registrations. */
  dispose(): void
}

/** Awaiting callers are paired with their reject so `dispose` can fail them. */
interface Waiter {
  resolve: (controller: TerminalController) => void
  reject: (reason: Error) => void
}

const DISPOSED_MESSAGE = 'TerminalControllerStore is disposed'
const EMPTY_COMMAND_MESSAGE = 'command must not be empty'

export function createTerminalControllerStore(): TerminalControllerStore {
  const controllers = new Map<string, TerminalController>()
  const waiters = new Map<string, Waiter[]>()
  let disposed = false

  /** Wrap a controller so an empty command always rejects. */
  const wrap = (controller: TerminalController): TerminalController => ({
    run(command: string): Promise<void> {
      if (command.length === 0) {
        return Promise.reject(new Error(EMPTY_COMMAND_MESSAGE))
      }
      return controller.run(command)
    },
  })

  const register = (id: string, controller: TerminalController): (() => void) => {
    if (disposed) throw new Error(DISPOSED_MESSAGE)
    const wrapped = wrap(controller)
    controllers.set(id, wrapped)

    // Unblock any caller that was waiting for this id.
    const pending = waiters.get(id)
    if (pending) {
      waiters.delete(id)
      for (const waiter of pending) waiter.resolve(wrapped)
    }

    // Identity-based removal: an earlier removal function for a controller that
    // was since replaced must not clear the replacement.
    return () => {
      if (controllers.get(id) === wrapped) controllers.delete(id)
    }
  }

  const waitFor = (id: string): Promise<TerminalController> => {
    if (disposed) return Promise.reject(new Error(DISPOSED_MESSAGE))
    const existing = controllers.get(id)
    if (existing) return Promise.resolve(existing)
    return new Promise<TerminalController>((resolve, reject) => {
      const list = waiters.get(id) ?? []
      list.push({ resolve, reject })
      waiters.set(id, list)
    })
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    controllers.clear()
    const error = new Error(DISPOSED_MESSAGE)
    for (const list of waiters.values()) {
      for (const waiter of list) waiter.reject(error)
    }
    waiters.clear()
  }

  return { register, waitFor, dispose }
}
