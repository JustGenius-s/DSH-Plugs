/**
 * Session-scoped Flow mode state.
 *
 * Flow mode is OFF by default and only ever turns on when the user asks — via
 * the `/flow` command or the canvas toggle. The alternative (a permanently
 * installed prompt section) made the model guess whether a request was "big
 * enough" to warrant a graph, which is both unreliable and invisible to the
 * user. Explicit entry is the whole point.
 *
 * State lives in process memory, keyed by session id, exactly as
 * @just-genius/dsh-debug-mode does it: writing custom event types into the
 * durable session log would poison reload, because they fall outside the
 * session layer's known event vocabulary.
 */

/** What one session's mode looks like right now. */
export interface SessionFlowState {
  /** Currently in effect for the model's next assembly. */
  active: boolean
  /**
   * Target while a turn is open, or `null` when no switch is pending.
   *
   * A mode change requested mid-turn cannot rewrite the prompt already sent to
   * the model, so it is staged here and committed at the next pre-step.
   */
  wanted: boolean | null
}

export interface FlowModeStore {
  get(sessionId: string): SessionFlowState | undefined
  ensure(sessionId: string): SessionFlowState
  /** Effective mode: a pending target wins over the committed value. */
  isOn(sessionId: string): boolean
  delete(sessionId: string): void
  clear(): void
}

/**
 * Mode, tools, and the Flow tab all share one key: the conversation session.
 *
 * `agent.id` is the live Agent, which is not what the canvas posts as
 * `sessionId`. Keying on that made `/flow` look on while `flow.plan` and the
 * tab still saw the mode as off.
 */
export function sessionIdOf(agent: { readonly session: { readonly id: unknown } }): string {
  return String(agent.session.id)
}

export function createFlowModeStore(): FlowModeStore {
  const store = new Map<string, SessionFlowState>()

  return {
    get: (sessionId) => store.get(sessionId),
    ensure(sessionId) {
      const existing = store.get(sessionId)
      if (existing !== undefined) return existing
      const fresh: SessionFlowState = { active: false, wanted: null }
      store.set(sessionId, fresh)
      return fresh
    },
    isOn(sessionId) {
      const state = store.get(sessionId)
      if (state === undefined) return false
      return state.wanted ?? state.active
    },
    delete: (sessionId) => void store.delete(sessionId),
    clear: () => store.clear(),
  }
}

/**
 * Why a mode switch cannot always apply immediately.
 *
 * The prompt for the in-flight step is already assembled, so a mid-turn switch
 * is staged and committed at the next pre-step boundary.
 */
export type ModeSwitchOutcome = 'committed' | 'queued' | 'restarted' | 'noop'

/** Apply a mode target for one session, respecting an open turn. */
export function setFlowMode(
  store: FlowModeStore,
  sessionId: string,
  on: boolean,
  turnOpen: boolean,
): ModeSwitchOutcome {
  const state = store.ensure(sessionId)

  if (on && state.active && state.wanted !== false) return 'noop'
  if (!on && !state.active && state.wanted !== true) return 'noop'

  if (turnOpen) {
    // Cancel a pending opposite switch, or stage this one.
    if (state.wanted !== null && state.wanted !== on) {
      state.wanted = null
      return state.active === on ? 'noop' : 'queued'
    }
    if (state.active === on) {
      state.wanted = null
      return 'noop'
    }
    state.wanted = on
    return 'queued'
  }

  const wasActive = state.active
  state.active = on
  state.wanted = null
  return wasActive ? 'restarted' : 'committed'
}

/**
 * Commit any staged switch. Called at `agent/pre-step`, the one point where a
 * new prompt can still be assembled for the model.
 */
export function commitFlowMode(store: FlowModeStore, sessionId: string): boolean {
  const state = store.get(sessionId)
  if (state === undefined || state.wanted === null) return false
  state.active = state.wanted
  state.wanted = null
  return true
}
