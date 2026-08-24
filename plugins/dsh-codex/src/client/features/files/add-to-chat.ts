/**
 * Insert a workspace file into the conversation composer as an `@file`
 * reference chip — same payload the built-in `@` picker uses for files
 * (`source: "reference"`, `appearance: "file"`).
 *
 * Relies on `dsh-client-ui-reference` already registering the `reference`
 * trigger source + codec; this module only dispatches the insert bail.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReferenceInsert } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Source name owned by `@deepseek-ai/dsh-client-ui-reference`. */
const FILE_REFERENCE_SOURCE = 'reference'

interface ClientSessionsLike {
  scope(id: string): ClientContext | undefined
}

interface InputStateFace {
  readonly draft: string
  readonly draftRev: number
}

interface SessionInputFace {
  readonly state: { getSnapshot(): InputStateFace }
}

interface ConversationFace {
  readonly input: {
    for(actx: unknown): SessionInputFace
  }
}

/**
 * Format a relative worktree path the way the shared `@path` grammar does
 * (see `dsh-client-ui-reference` / file-reference grammar).
 */
export function formatFileMention(path: string): string | undefined {
  if (path.length === 0) return undefined
  if (/[\u0000-\u001f\u007f-\u009f"]/u.test(path)) return undefined
  if (/\s/u.test(path)) return `@"${path}"`
  return `@${path}`
}

/**
 * Append one file reference chip at the end of the session's draft.
 * @returns whether the composer applied the insertion.
 */
export function insertFileReference(
  ctx: ClientContext,
  sessionId: string,
  path: string,
): boolean {
  const mention = formatFileMention(path)
  if (mention === undefined) return false
  const slash = path.lastIndexOf('/')
  const label = slash === -1 ? path : path.slice(slash + 1)
  if (label.length === 0) return false

  try {
    const sessions = ctx.sessions as unknown as ClientSessionsLike
    const actx = sessions.scope(sessionId)
    if (actx === undefined) return false
    const conversation = ctx.get('conversation') as ConversationFace | undefined
    if (conversation === undefined) return false
    const input = conversation.input.for(actx)
    const snapshot = input.state.getSnapshot()

    const reference: ReferenceInsert = {
      source: FILE_REFERENCE_SOURCE,
      ref: mention,
      label,
      appearance: 'file',
      clipboardText: mention,
    }
    const span = {
      start: snapshot.draft.length,
      end: snapshot.draft.length,
      draftRev: snapshot.draftRev,
    }
    return actx.bail(actx, 'slash/input-insert-reference', {
      reference,
      span,
    }) === true
  } catch {
    return false
  }
}
