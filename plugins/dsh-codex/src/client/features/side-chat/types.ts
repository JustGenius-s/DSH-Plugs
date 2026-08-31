/**
 * Local stand-ins for conversation-rendering types.
 *
 * The side chat renders the official conversation node tree. Newer DSH
 * releases dropped (or renamed) several of the type exports this code was
 * written against, and the shared runtime boundary does not re-export the
 * replacements. Rather than guess at official semantics these declare only
 * the fields this feature actually reads, and structural typing keeps them
 * assignable to whatever the live node objects are.
 */

/** A block inside an assistant message or a tool result. */
export interface ContentBlock {
  type?: string
  text?: string
  [key: string]: unknown
}

/** A tool call before it settles: the call identity lives on the block itself. */
export interface ToolCallBlock {
  name?: string
  argsRaw?: string
  callId?: string
  [key: string]: unknown
}

/** A settled tool call: the result carries the originating call. */
export interface ToolResultNode {
  kind?: string
  call?: { name?: string; argsRaw?: string; callId?: string }
  content: readonly ContentBlock[]
  error?: { name?: string; code?: string; message?: string }
  [key: string]: unknown
}

/** One node in the rendered conversation tree. */
export interface ChatConversationViewNode {
  kind?: string
  role?: string
  id?: string
  [key: string]: unknown
}

/** A pending interaction the user must answer (approval, question, …). */
export interface PendingWait<K extends string = string> {
  kind: K
  /** Stable identity for this wait, used for DOM keys and aria wiring. */
  key: string
  sessionId?: string
  /**
   * Wait-specific fields. Deliberately loose: the official payload types are
   * exact object types without index signatures, so a `Record<string, unknown>`
   * intersection would reject them — every field here is optional and read
   * defensively at the use site.
   */
  payload: {
    [key: string]: unknown
    callId?: string
    reason?: string
    toolName?: string
    questions?: readonly PendingQuestionItem[]
  }
  respond(answer: Record<string, unknown>): Promise<PendingWaitReceipt>
}

/**
 * One question in a pending `question` wait. Declared structurally (not as a
 * `Record`) so the official `AskUserQuestionItem` stays assignable to it.
 */
export interface PendingQuestionItem {
  id: string
  question: string
  detail?: string
  header?: string
  multiSelect?: boolean
  options?: readonly {
    id?: string
    label?: string
    description?: string
    recommended?: boolean
    intent?: { kind?: string; approve?: string }
  }[]
  intent?: { kind?: string; approve?: string }
  [key: string]: unknown
}

/** What `PendingWait.respond` answers. */
export interface PendingWaitReceipt {
  accepted: boolean
  reason?: string
  [key: string]: unknown
}

/** One model entry in a session's model directory. */
export interface ModelCatalogModel {
  id: string
  name?: string
  provider?: string
  reasoning?: ModelReasoning
}

/** Reasoning levels a model offers. */
export interface ModelReasoning {
  efforts?: readonly {
    id: string
    name?: string
    label?: string
    description?: string
  }[]
  defaultEffort?: string
}

/** The model directory for one session. */
export interface SessionModels {
  current?: ModelSelection
  groups: readonly {
    id: string
    name?: string
    models: readonly ModelCatalogModel[]
  }[]
}

/** A provider + model pair, optionally with a chosen reasoning effort. */
export interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}
