/**
 * Terminal-selection references for the composer.
 *
 * "Add selection as context" turns the text selected in the Warp terminal
 * into a composer reference chip (`@终端`), exactly like the built-in `@`
 * sources (skills / subagents / sessions). Two pieces:
 *
 * - A registered `@` trigger source named `terminal`. The source itself never
 *   surfaces candidates in the slash menu (candidates resolve empty), but its
 *   `codec` is the ONLY registry the submit pipeline consults when
 *   serializing a chip occurrence (`slash/input-insert-reference` → mint →
 *   `sinkSerialized` → `serializeReference(source, ref)`). Without the
 *   registration the send would fail with "no serializer for reference
 *   source", so the codec lives here even though the menu never uses it.
 *
 * - The insertion helper: resolve the session scope, read the live input
 *   machine state (draft + revision), and dispatch the scoped
 *   `slash/input-insert-reference` bail event with a span at the END of the
 *   current draft. This is the same event the input-trigger pipeline's
 *   `execute()` dispatches for a menu pick, so the composer applies it with
 *   the full CAS + phase guards and mints one chip occurrence.
 *
 * The selected text is retained by `ref` in a module registry so the codec
 * can rebuild the model form at submit time; entries are pruned when the
 * chip is removed or the registry grows.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  InputTriggerSource,
  ReferenceInsert,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Source name the composer's `serializeReference` routing key uses. */
export const TERMINAL_REFERENCE_SOURCE = 'terminal'

interface TerminalSelectionEntry {
  readonly ref: string
  readonly text: string
}

/** Module-level registry: ref → captured text, readable by the codec later. */
const entries = new Map<string, TerminalSelectionEntry>()
let refSeq = 0

function mintRef(): string {
  refSeq += 1
  return 'terminal:' + refSeq.toString(36)
}

/** Model form of one terminal reference: the captured text as a fenced block. */
function serializeTerminalReference(ref: string): Promise<string> {
  const entry = entries.get(ref)
  if (entry === undefined) {
    return Promise.reject(new Error(`terminal reference "${ref}" is no longer available`))
  }
  const body = entry.text.replace(/```/g, '\\`\\`\\`')
  return Promise.resolve('\n```\n' + body + '\n```\n')
}

/**
 * The client runtime's sessions face, narrowed structurally. This package
 * compiles host and client entries in one program, and the host-side
 * `sessions` augmentation (dsh-host-apiproxy's SessionStore) wins the
 * merged `Context` interface — so the client face is read through a cast,
 * the same way file-links narrows `ctx.sessions`.
 */
interface ClientSessionsLike {
  scope(id: string): ClientContext | undefined
}

/** Minimal structural face of the conversation input facade we read. */
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

export interface TerminalReferenceApi {
  /**
   * Insert the captured text into the current conversation draft as one
   * `@终端` chip (appended at the end of the draft).
   * @param sessionId - the conversation session to target.
   * @param text - the terminal selection text.
   * @param label - chip display label (localized).
   * @returns whether the composer applied the insertion.
   */
  insert(sessionId: string, text: string, label: string): boolean
  /** Unregister the trigger source. */
  dispose(): void
}

export function createTerminalReference(ctx: ClientContext): TerminalReferenceApi {
  const source: InputTriggerSource = {
    trigger: '@',
    name: TERMINAL_REFERENCE_SOURCE,
    candidates: async () => [],
    onPick: () => undefined,
    codec: {
      clipboardText(ref: string): string {
        return entries.get(ref)?.text ?? ''
      },
      serialize(ref: string, _signal: AbortSignal): Promise<string> {
        return serializeTerminalReference(ref)
      },
    },
  }

  // Declared in client `inject` so property access is legal; register once at
  // activate so submit can resolve this source's codec.
  const disposeSource = ctx.inputTriggers.registerSource(source)

  const insert = (sessionId: string, text: string, label: string): boolean => {
    const trimmed = text.trim()
    if (trimmed.length === 0) return false
    try {
      const sessions = ctx.sessions as unknown as ClientSessionsLike
      const actx = sessions.scope(sessionId)
      if (actx === undefined) return false
      // Optional at call time: avoid an undeclared property throw; conversation
      // is provided by the web profile but is not a hard dep of this plugin.
      const conversation = ctx.get('conversation') as ConversationFace | undefined
      if (conversation === undefined) return false
      const input = conversation.input.for(actx)
      const snapshot = input.state.getSnapshot()

      const ref = mintRef()
      entries.set(ref, { ref, text: trimmed })

      const reference: ReferenceInsert = {
        source: TERMINAL_REFERENCE_SOURCE,
        ref,
        label,
        clipboardText: '@' + label,
      }
      // Append the chip at the end of the current draft: empty span at EOF.
      const span = {
        start: snapshot.draft.length,
        end: snapshot.draft.length,
        draftRev: snapshot.draftRev,
      }
      const applied = actx.bail(actx, 'slash/input-insert-reference', {
        reference,
        span,
      }) === true
      if (!applied) entries.delete(ref)
      return applied
    } catch {
      return false
    }
  }

  return { insert, dispose: disposeSource }
}
