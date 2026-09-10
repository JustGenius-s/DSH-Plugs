import type { ClientContext } from '@just-genius/dsh-plugin-runtime/client'
import { getSessions } from '@just-genius/dsh-plugin-runtime/client'
import type { ReferenceInsert } from '@just-genius/dsh-plugin-runtime/client'
import { clientSessionScope } from './sessions'
import { detectEndOf, type OccurrenceSpan } from './composer-span'

interface InputStateFace {
  /** Clipboard projection: chips spelled out as their mention. */
  readonly draft: string
  readonly draftRev: number
  /** Chip occurrences in the clipboard projection. */
  readonly occurrences: readonly OccurrenceSpan[]
}

interface ConversationFace {
  readonly input: {
    for(actx: unknown): {
      readonly state: { getSnapshot(): InputStateFace }
    }
  }
}

/**
 * The append-at-the-end span for the current draft.
 *
 * Insert events are span-CAS'd against the editor's DETECT projection, where a
 * chip is one character; see `composer-span.ts` for why `draft.length` alone
 * is wrong as soon as the draft holds a chip.
 */
function endSpan(snapshot: InputStateFace): {
  start: number
  end: number
  draftRev: number
} {
  const end = detectEndOf(snapshot.draft, snapshot.occurrences)
  return { start: end, end, draftRev: snapshot.draftRev }
}

/** Append one reference chip through the conversation input transaction seam. */
export function insertComposerReference(
  ctx: ClientContext,
  sessionId: string,
  reference: ReferenceInsert,
): boolean {
  const actx = clientSessionScope(getSessions(ctx), sessionId)
  if (actx === undefined) return false
  const conversation = ctx.get('conversation') as ConversationFace | undefined
  if (conversation === undefined) return false
  const snapshot = conversation.input.for(actx).state.getSnapshot()
  return actx.bail(actx, 'slash/input-insert-reference', {
    reference,
    span: endSpan(snapshot),
  }) === true
}

/** Append plain text at the end of the session's draft (no chip/occurrence). */
export function insertComposerText(
  ctx: ClientContext,
  sessionId: string,
  text: string,
): boolean {
  const actx = clientSessionScope(getSessions(ctx), sessionId)
  if (actx === undefined) return false
  const conversation = ctx.get('conversation') as ConversationFace | undefined
  if (conversation === undefined) return false
  const snapshot = conversation.input.for(actx).state.getSnapshot()
  return actx.bail(actx, 'slash/input-insert-text', {
    text,
    span: endSpan(snapshot),
  }) === true
}
