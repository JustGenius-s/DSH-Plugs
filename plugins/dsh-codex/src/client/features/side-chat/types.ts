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
  /** Host-computed pending render intent; null = generic JSON card. */
  callView?: ToolCallView | null
  /** Child calls owned by this call, in dispatch order. */
  subCalls?: readonly ToolCallBlock[]
  [key: string]: unknown
}

/** A settled tool call: the result carries the originating call. */
export interface ToolResultNode {
  kind?: string
  call?: { name?: string; argsRaw?: string; callId?: string }
  content: readonly ContentBlock[]
  error?: { name?: string; code?: string; message?: string }
  /** Host-computed pending render intent, present when the call is in-window. */
  callView?: ToolCallView | null
  /** Host-computed completed render intent; null = generic JSON card. */
  resultView?: ToolResultView | null
  /** Child calls owned by this call, in dispatch order. */
  subCalls?: readonly ToolCallBlock[]
  [key: string]: unknown
}

/**
 * Host-computed pending-call render intent, declared structurally.
 *
 * The official `ToolCallView` is a tagged union over `card`; only the fields
 * this feature reads are declared, and the `kind` category is what drives icon
 * and title selection.
 */
export interface ToolCallView {
  card?: string
  /** Category for icon/treatment; defaults to `other`. */
  kind?: string
  title?: string
  description?: string
  command?: string
  diffs?: readonly { path?: string }[]
  locations?: readonly { path?: string }[]
}

/** Host-completed render intent, declared structurally. */
export interface ToolResultView {
  card?: string
  kind?: string
  title?: string
  path?: string
  offset?: number
  lines?: readonly { number?: number; text?: string }[]
  totalLines?: number
  lang?: string
  /** One file's grouped content matches (`search` card, `shape: 'matches'`). */
  files?: readonly { path?: string; matches?: readonly unknown[] }[]
  /** A flat path list (`search` card, `shape: 'paths'`). */
  paths?: readonly string[]
  total?: number
  truncated?: boolean
  /** Applied file changes (`diff` card): the before/after text the card draws. */
  diffs?: readonly { path?: string; oldText?: string | null; newText?: string }[]
  sources?: readonly { url?: string; title?: string; snippet?: string }[]
  url?: string
  statusCode?: number
  output?: string
  exitCode?: number
  content?: readonly ContentBlock[]
}

/** A durable image reference carried by an `image` content block. */
export interface ImageAttachmentRefLike {
  attachmentId?: unknown
  mediaType?: string
  name?: string
  width?: number
  height?: number
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
  /**
   * Providers whose directory lookup refused, so the picker can explain an
   * empty list instead of reading as "no models exist".
   */
  failures?: readonly {
    id: string
    name?: string
    message?: string
  }[]
}

/** A provider + model pair, optionally with a chosen reasoning effort. */
export interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}
