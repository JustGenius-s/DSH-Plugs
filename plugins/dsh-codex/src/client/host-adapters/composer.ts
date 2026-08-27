import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReferenceInsert } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { clientSessionScope } from './sessions'

interface InputStateFace {
  readonly draft: string
  readonly draftRev: number
}

interface ConversationFace {
  readonly input: {
    for(actx: unknown): {
      readonly state: { getSnapshot(): InputStateFace }
    }
  }
}

/** Append one reference chip through the conversation input transaction seam. */
export function insertComposerReference(
  ctx: ClientContext,
  sessionId: string,
  reference: ReferenceInsert,
): boolean {
  const actx = clientSessionScope(ctx.sessions, sessionId)
  if (actx === undefined) return false
  const conversation = ctx.get('conversation') as ConversationFace | undefined
  if (conversation === undefined) return false
  const snapshot = conversation.input.for(actx).state.getSnapshot()
  return actx.bail(actx, 'slash/input-insert-reference', {
    reference,
    span: {
      start: snapshot.draft.length,
      end: snapshot.draft.length,
      draftRev: snapshot.draftRev,
    },
  }) === true
}

/** Append plain text at the end of the session's draft (no chip/occurrence). */
export function insertComposerText(
  ctx: ClientContext,
  sessionId: string,
  text: string,
): boolean {
  const actx = clientSessionScope(ctx.sessions, sessionId)
  if (actx === undefined) return false
  const conversation = ctx.get('conversation') as ConversationFace | undefined
  if (conversation === undefined) return false
  const snapshot = conversation.input.for(actx).state.getSnapshot()
  return actx.bail(actx, 'slash/input-insert-text', {
    text,
    span: {
      start: snapshot.draft.length,
      end: snapshot.draft.length,
      draftRev: snapshot.draftRev,
    },
  }) === true
}
