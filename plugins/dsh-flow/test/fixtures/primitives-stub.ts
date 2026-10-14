/**
 * Test stub for `@deepseek-ai/dsh-client-ui-primitives`.
 *
 * The shared UI kit's ROOT entry forwards the official conversation primitives,
 * so importing anything from it — even a glyph, which lives in the kit's own
 * icon set — also pulls that package in. It is a browser-only DSH client
 * module: it imports CSS modules and depends on `simple-icons`, `katex`, and
 * `shiki`, none of which Node can resolve here.
 *
 * Vitest substitutes this module for that specifier (see `vitest.config.ts`),
 * so a test can import the kit's own components without dragging the renderers
 * in. Only the names the kit root re-exports are listed; the renderers are
 * never rendered by these tests.
 */

const component = () => null
const constant = 0

export const CodeBlock = component
export const DiffBlock = component
export const JsonBlock = component
export const ReadBlock = component
export const SearchBlock = component
export const TerminalBlock = component
export const MarkdownText = component
export const Menu = component
export const MenuItemButton = component

export const relativeTime = () => ''

export const DEFAULT_DIFF_MAX_LINES = constant
export const DEFAULT_READ_MAX_LINES = constant
export const DEFAULT_SEARCH_MAX_LINES = constant
export const DEFAULT_TERMINAL_MAX_LINES = constant

export const IconArchiveOutlineRegular = component
export const IconBranchOutlineRegular = component
export const IconCheckCircleOutlineRegular = component
export const IconCopyOutlineRegular = component
export const IconDownloadOutlineRegular = component
export const IconEditOutlineRegular = component
export const IconFolderOpenOutlineRegular = component
export const IconNewChatOutlineRegular = component
export const IconPinFillRegular = component
export const IconPinOutlineRegular = component
export const IconTrashOutlineRegular = component
export const IconWorkspaceTreeOutlineRegular = component
