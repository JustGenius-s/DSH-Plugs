import type { MenuEntry } from '@just-genius/dsh-plugin-ui'
import { relativePathOf, type FilesHostInfo } from './files-actions'

/**
 * The row a menu was opened on, plus what it needs to decide row availability.
 */
export interface FilesMenuTarget {
  path: string
  /** Directory rows reveal the folder itself and take a folder chip. */
  kind: 'file' | 'dir'
  cwd: string
}

export interface FilesMenuOptions {
  /** Whether the current conversation can accept an `@path` chip. */
  canAddToChat: boolean
  /** Host capability probe; undefined until the one-page probe settles. */
  hostInfo?: FilesHostInfo | undefined
}

/** The reveal row's label key for one host platform. */
export function revealLabelKey(platform: FilesHostInfo['platform']): string {
  switch (platform) {
    case 'win32':
      return 'context.revealWindows'
    case 'linux':
      return 'context.revealLinux'
    default:
      // `darwin` and any unprobed host: the user asked for Finder, so name it.
      return 'context.reveal'
  }
}

/**
 * Build the files-tree row menu: file-manager actions, then clipboard actions,
 * with a hairline between the two groups so the menu reads as two kinds of
 * gesture rather than four equal rows.
 *
 * The separator is dropped when the first group is empty — a hairline with
 * nothing above it is just a stray line.
 */
export function buildFilesMenu(
  target: FilesMenuTarget,
  options: FilesMenuOptions,
  t: (key: string) => string,
): MenuEntry[] {
  const actions: MenuEntry[] = []
  if (options.canAddToChat) {
    // Both kinds read the same label: what was added is already legible from
    // the chip itself (folder glyph + trailing slash), so the menu row does
    // not need to re-say it.
    actions.push({ id: 'add-to-chat', label: t('context.addToChat') })
  }
  // The reveal row is named after the host it will actually invoke, and is
  // omitted when this host has no file manager to hand the path to.
  if (options.hostInfo?.revealSupported === true) {
    actions.push({ id: 'reveal', label: t(revealLabelKey(options.hostInfo.platform)) })
  }

  const copies: MenuEntry[] = [
    { id: 'copy-path', label: t('context.copyPath') },
    {
      id: 'copy-relative-path',
      label: t('context.copyRelativePath'),
      // A path outside the workspace has no relative spelling; the row stays
      // visible but inert so the menu does not reshuffle between rows.
      disabled: relativePathOf(target.path, target.cwd) === undefined,
    },
  ]

  if (actions.length === 0) return copies
  return [...actions, { type: 'separator', id: 'separator-clipboard' }, ...copies]
}
