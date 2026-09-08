/**
 * Self-drawn code and diff surfaces for the files panel.
 *
 * The ui-primitives `CodeBlock`/`DiffBlock` are NOT used here: that package
 * stubs its CSS modules out of the built bundle and ships no stylesheet, so
 * in a plugin bundle those components render unstyled. These views draw with
 * the panel's own CSS (same `--dsw-*` tokens as the git-graph panel), which
 * keeps the files panel visually consistent with the rest of the sidebar.
 *
 * This module is the public entry point; the pieces live beside it:
 *  - `code-view.tsx` — one file's contents (gutter, find, comments)
 *  - `diff-view.tsx` — one file's unified patch
 *  - `find-bar.tsx` — the find widget
 *  - `review-comment-editor.tsx` — the inline review composer
 *  - `code-text.ts` — line painting and clipping (shared by both views)
 *  - `diff-model.ts` — patch parsing and diff highlighting (pure)
 *
 * Performance gates mirror editor defaults:
 *  - `MAX_TOKENIZATION_LINE_LENGTH` (in highlight.ts): overlong lines skip
 *    the grammar entirely.
 *  - `STOP_RENDERING_LINE_AFTER` (in code-text.ts): DOM only paints the first
 *    N characters of a line (`editor.stopRenderingLineAfter`).
 * Rows stay in normal document flow so wrapped lines have their real height,
 * matching Codex Desktop's no-horizontal-scroll file and diff previews.
 */
import { useMemo } from 'react'
import { renderMarkdown } from './markdown'

export { FileCodeView } from './code-view'
export { FileDiffView } from './diff-view'
export type { ViewLabels } from './view-labels'

/**
 * One markdown file rendered for preview. `renderMarkdown` is memoized so
 * re-renders of the same mounted preview (e.g. a parent state change) don't
 * re-parse the source; the toggle-back to preview re-parses once, which is
 * cheap for typical documents. The container scrolls (no virtualization —
 * markdown blocks have no fixed row height) and `.dsh-files-md-body` carries
 * the prose styling.
 */
export function FileMarkdownView(props: { content: string; themeKey?: string }) {
  const html = useMemo(
    () => renderMarkdown(props.content),
    [props.content, props.themeKey ?? ''],
  )
  return (
    <div
      className="dsh-files-md-body"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
