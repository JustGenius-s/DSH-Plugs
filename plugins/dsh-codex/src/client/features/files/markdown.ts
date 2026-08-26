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
import MarkdownIt, { type StateCore, type Token } from 'markdown-it'
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

  // GFM task lists: markdown-it has no built-in rule, and VS Code's preview
  // renders them as disabled checkboxes. We do the same here by (a) rewriting
  // the leading `[ ]`/`[x]` of a list-item paragraph into a checkbox token,
  // and (b) rendering that token as a disabled input; DOMPurify already
  // allows input + type/checked/disabled, and strips any handler attrs.
  installTaskList(md)

  return md
}

/**
 * Inline `[ ]`/`[x]` markers at the start of a list item become disabled
 * checkbox inputs, GitHub-style. The rewrite happens before rendering (core
 * rule, `state.tokens`), so it composes with the existing link/fence rules.
 */
function installTaskList(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'codex-task-list', (state: StateCore) => {
    const tokens = state.tokens
    for (let index = 0; index < tokens.length; index += 1) {
      const item = tokens[index]
      // Skip close/self-closing tokens; children live on `*_open`.
      if (item?.type !== 'list_item_open') continue
      let inline: Token | undefined
      const paragraphDepth = item.level + 1
      for (let look = index + 1; look < tokens.length; look += 1) {
        const cursor = tokens[look]
        if (cursor === undefined || cursor.level < paragraphDepth) break
        // The paragraph sits at `paragraphDepth`; its inline children sit one
        // level deeper. Take only the first paragraph's inline (the task marker
        // leads the item); later paragraphs stay untouched.
        if (cursor.type === 'inline' && cursor.level === paragraphDepth + 1) {
          inline = cursor
          break
        }
        if (cursor.type === 'paragraph_close' && cursor.level === paragraphDepth) break
      }
      if (inline === undefined || inline.children === null) continue

      const lead = inline.children[0]
      // Need `[ ]`/`[x]` as the FIRST text child followed by whitespace so
      // `- [ ] todo` works but `- [ ]todo` (no space) does not, matching GFM.
      if (lead === undefined || lead.type !== 'text') continue
      const marker = /^\[([ xX])\]\s+/.exec(lead.content)
      if (marker === null) continue

      // Task items render checkbox-first with no bullet, like GitHub: tag the
      // `<li>` so the stylesheet can drop its list marker.
      item.attrJoin('class', 'task-list-item')

      lead.content = lead.content.slice(marker[0].length)
      if (lead.content === '') {
        inline.children.shift()
      }

      const checkbox = new state.Token('checkbox_input', 'input', 0)
      checkbox.attrSet('type', 'checkbox')
      checkbox.attrSet('disabled', 'disabled')
      if (marker[1] !== ' ') checkbox.attrSet('checked', 'checked')
      checkbox.block = false
      inline.children.unshift(checkbox)
    }
    return false
  })

  md.renderer.rules.checkbox_input = (tokens, idx) => {
    const token = tokens[idx]
    const checked = token?.attrGet('checked') !== null ? ' checked' : ''
    const disabled = token?.attrGet('disabled') !== null ? ' disabled' : ''
    return `<input type="checkbox"${checked}${disabled}>`
  }
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
