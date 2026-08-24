/**
 * Insert a workspace file into the conversation composer as an `@file`
 * reference chip — same payload the built-in `@` picker uses for files
 * (`source: "reference"`).
 *
 * Relies on `dsh-client-ui-reference` already registering the `reference`
 * trigger source + codec; this module only dispatches the insert bail.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReferenceInsert } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { insertComposerReference } from '../../host-adapters/composer'

/** Source name owned by `@deepseek-ai/dsh-client-ui-reference`. */
const FILE_REFERENCE_SOURCE = 'reference'

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
    const reference: ReferenceInsert = {
      source: FILE_REFERENCE_SOURCE,
      ref: mention,
      label,
      clipboardText: mention,
    }
    return insertComposerReference(ctx, sessionId, reference)
  } catch {
    return false
  }
}
