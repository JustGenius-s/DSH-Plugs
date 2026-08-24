/**
 * Markdown renderer for the files panel's preview mode.
 *
 * Mirrors VS Code's markdown engine (markdown-it) and its `html: true` choice,
 * but the output is sanitized with DOMPurify because the preview lives in the
 * main DSH window rather than a CSP-sandboxed webview:
 *  - `html: true` — raw HTML in the file renders (centered README headers,
 *    `<details>`, tables, …), matching VS Code.
 *  - DOMPurify strips scripts, event handlers and `javascript:` URLs while
 *    keeping inline `style` (the Shiki fenced-code colors ride `--shiki-*`
 *    custom properties) plus `align`/`target`/`rel`.
 *  - `linkify: true` — bare URLs become clickable.
 *  - `typographer: true` — smartquotes/ellipsis, matching VS Code.
 *  - `breaks: false` — GitHub-style: a single newline is a space.
 *  - Fenced code blocks go through Shiki (the same singleton the source view
 *    uses); unknown or no language falls back to plain escaped text.
 *  - Anchor tags open in a new tab with `noopener`, so a relative/odd link
 *    can never navigate the sidebar itself away.
 */
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import { highlightToHtml } from './highlight'

/** File extensions that render with a preview/Markdown toggle. */
const MARKDOWN_EXTENSIONS = new Set([
  'md',
  'markdown',
  'mdown',
  'mkdn',
  'mkd',
  'mdx',
  'mdwn',
])

/** True when `path` names a markdown file (by extension). */
export function isMarkdownFile(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return false
  return MARKDOWN_EXTENSIONS.has(base.slice(dot + 1))
}

/**
 * Reuse a single markdown-it instance across renders (it is stateless between
 * `render` calls), matching VS Code's engine-cache pattern.
 */
let engine: MarkdownIt | undefined

function getEngine(): MarkdownIt {
  engine ??= createEngine()
  return engine
}

function createEngine(): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    breaks: false,
    highlight: (code, lang) => highlightToHtml(code, lang) ?? '',
  })

  // Open links in a new tab with a restrictive rel; prevents a relative or
  // malformed href from navigating the DSH window itself.
  const defaultLinkOpen = md.renderer.rules.link_open
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noopener noreferrer')
    return defaultLinkOpen !== undefined
      ? defaultLinkOpen(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options)
  }

  return md
}

/** Render markdown `source` to a sanitized HTML string for the preview pane. */
export function renderMarkdown(source: string): string {
  return sanitizeHtml(getEngine().render(source))
}

/**
 * Strip anything DOMPurify's default HTML profile blocks (scripts, inline
 * handlers, `javascript:` URLs, unsafe iframes) while keeping the pieces the
 * preview needs: inline `style` carries the Shiki `--shiki-*` code colors,
 * `align` is the legacy attribute README headers use for centering, and
 * `target`/`rel` are the ones the link renderer sets.
 */
function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    // Inline `style` carries the Shiki `--shiki-*` code colors; `align` is the
    // legacy attribute README headers use for centering; `target`/`rel` are
    // the ones the link renderer sets. `img` keeps safe data: URIs (base64
    // images), while scripts, event handlers and javascript: URLs stay blocked.
    ADD_ATTR: ['style', 'align', 'target', 'rel'],
    ADD_DATA_URI_TAGS: ['img'],
  })
}
