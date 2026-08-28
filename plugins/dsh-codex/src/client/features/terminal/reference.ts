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
 * The selected text is retained by `ref` in the feature-owned registry so the
 * codec can rebuild the model form at submit time; disposal clears the data.
 */

import type { ClientContext } from '@just-genius/dsh-plugin-runtime/client'
import type {
  InputTriggerSource,
  ReferenceInsert,
} from '@just-genius/dsh-plugin-runtime/client'
import { insertComposerReference } from '../../host-adapters/composer'

/** Source name the composer's `serializeReference` routing key uses. */
export const TERMINAL_REFERENCE_SOURCE = 'terminal'

interface TerminalSelectionEntry {
  readonly ref: string
  readonly text: string
  readonly label: string
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
  const entries = new Map<string, TerminalSelectionEntry>()
  const mintRef = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return 'terminal:' + crypto.randomUUID()
    }
    return 'terminal:' + Date.now().toString(36) + Math.random().toString(36).slice(2)
  }

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
        const entry = entries.get(ref)
        if (entry === undefined) {
          return Promise.reject(new Error(`terminal reference "${ref}" is no longer available`))
        }
        return Promise.resolve('\n' + entry.text + '\n')
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
      const ref = mintRef()
      entries.set(ref, { ref, text: trimmed, label })

      const reference: ReferenceInsert = {
        source: TERMINAL_REFERENCE_SOURCE,
        ref,
        label,
        clipboardText: '@' + label,
      }
      const applied = insertComposerReference(ctx, sessionId, reference)
      if (!applied) entries.delete(ref)
      return applied
    } catch {
      return false
    }
  }

  return {
    insert,
    dispose() {
      entries.clear()
      disposeSource()
    },
  }
}
