/**
 * Insert a workspace file — or folder — into the conversation composer as an
 * `@path` reference chip: the same payload the built-in `@` picker produces for
 * a settled pick (`source: "reference"`), including the trailing slash and
 * folder glyph a directory row carries.
 *
 * Relies on `dsh-client-ui-reference` already registering the `reference`
 * trigger source + codec; this module only dispatches the insert bail.
 */
import type { ClientContext } from '@just-genius/dsh-plugin-runtime/client'
import type { ReferenceInsert } from '@just-genius/dsh-plugin-runtime/client'
import { insertComposerReference } from '../../host-adapters/composer'

/** Source name owned by `@deepseek-ai/dsh-client-ui-reference`. */
const FILE_REFERENCE_SOURCE = 'reference'

/** What one tree row names — mirrored from `GitTreeEntry['kind']`. */
export type PathKind = 'file' | 'dir'

/**
 * Format a relative worktree path the way the shared `@path` grammar does
 * (see `dsh-file-reference` / `dsh-client-ui-reference`):
 * a directory always ends in `/`, and one whose path contains whitespace keeps
 * the quoted form open after that slash — exactly what the `@` picker inserts
 * for a settled folder pick, so both surfaces serialize identically.
 */
export function formatFileMention(path: string, kind: PathKind = 'file'): string | undefined {
  const value = kind === 'dir' ? `${path}/` : path
  if (value.length === 0) return undefined
  if (/[\u0000-\u001f\u007f-\u009f"]/u.test(value)) return undefined
  if (/\s/u.test(value)) return kind === 'dir' ? `@"${value}` : `@"${value}"`
  return `@${value}`
}

/**
 * Append one file or folder reference chip at the end of the session's draft.
 * @returns whether the composer applied the insertion.
 */
export function insertFileReference(
  ctx: ClientContext,
  sessionId: string,
  path: string,
  kind: PathKind = 'file',
): boolean {
  const mention = formatFileMention(path, kind)
  if (mention === undefined) return false
  const slash = path.lastIndexOf('/')
  const name = slash === -1 ? path : path.slice(slash + 1)
  if (name.length === 0) return false
  const label = kind === 'dir' ? `${name}/` : name

  try {
    const reference: ReferenceInsert = {
      source: FILE_REFERENCE_SOURCE,
      ref: mention,
      label,
      appearance: kind === 'dir' ? 'folder' : 'file',
      clipboardText: mention,
    }
    return insertComposerReference(ctx, sessionId, reference)
  } catch {
    return false
  }
}
