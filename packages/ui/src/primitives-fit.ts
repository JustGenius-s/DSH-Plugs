/**
 * Width-fitting rules for the forwarded conversation surfaces.
 *
 * `@deepseek-ai/dsh-client-ui-primitives` ships `MarkdownText`, `CodeBlock`,
 * `JsonBlock`, `MessageText` and `TerminalBlock` as a module-loader bundle.
 * A plugin bundle that imports them through this package gets the components
 * with their hashed class names but WITHOUT the matching stylesheet —
 * verified against a built bundle: the class names are referenced on the DOM
 * while no injected `<style>` contains them (`TnfYnq_*`, `twwVoa_*`,
 * `fXMbVG_*`, `_9j33BW_*` all appear in the markup and in none of the
 * injected CSS strings).
 *
 * The consequence is not merely cosmetic: with no stylesheet the browser's
 * defaults apply, and a default `<pre>` never wraps. In a narrow side panel
 * that means any long code line, table, or unwrapped token produces a
 * horizontal scrollbar — the transcript stops reflowing to the window width.
 *
 * These rules restore the wrapping behaviour the official sheet would provide.
 * They are structural only (wrapping, min-width, contained overflow) — colors,
 * fonts and spacing stay with the consuming plugin, so this sheet cannot
 * restyle a surface it does not own.
 *
 * Specificity note: every rule targets descendant elements (`.md pre`) rather
 * than the hashed module classes, so the rules hold regardless of which hash
 * the upstream build produced.
 */

/**
 * The raw rule text, without a selector prefix.
 *
 * Exported so a consumer can scope the rules to its own containers by
 * prefixing them (see {@link fitRulesFor}) or inject them verbatim under a
 * global class (see {@link ensurePrimitivesFitStyles}).
 *
 * Selectors are descendant-only, so a consumer scopes the whole set by
 * wrapping it in one ancestor selector.
 */
const FIT_RULES = `
/* Long unbroken tokens (URLs, hashes, minified lines) wrap rather than
   overflow: anywhere plus an explicit break opportunity covers a bare
   text node in engines that need it. */
&{min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:break-word}
& :where(p,li,blockquote,dd,dt,h1,h2,h3,h4,h5,h6){overflow-wrap:anywhere}
& :where(code,span,kbd,samp){overflow-wrap:anywhere;word-break:break-word}

/* Fenced code: wrap long lines instead of scrolling sideways. pre-wrap
   preserves indentation; break-word handles a token wider than the panel.
   The official CodeBlock sheet already does this, so this rule matters for
   raw <pre> markup that reaches a container without that sheet. */
& :where(pre){white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;max-width:100%}
& :where(pre) :where(code){white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}

/* Tables are deliberately NOT forced to reflow. The official sheet puts them
   in a .tableScroll wrapper (max-width:100%;overflow-x:auto) whose table is
   width:max-content — forcing table-layout:fixed there collapses the columns.
   Cells still need to wrap so a wide cell does not force the wrapper itself
   past the panel edge. */
& :where(th,td){overflow-wrap:anywhere;word-break:break-word}

/* Inline code chips must not become the widest element on their row. */
& :not(pre) > code{max-width:100%;overflow-wrap:anywhere}

/* Math: KaTeX display blocks overflow rather than wrap; keep them contained. */
& :where(.katex-display){max-width:100%;overflow-x:auto}

/* Replaced content stays inside the column. */
& :where(img,video,svg){max-width:100%;height:auto}
`

/**
 * Scope the fit rules to one or more ancestor selectors.
 *
 * @param selectors - CSS selectors that own the rendered primitives, e.g.
 *   `'.dsh-codex-sidechat-md-body'`. The `&` placeholder in the rule text is
 *   replaced by each selector, so the rules apply to the container's
 *   descendants at any depth.
 * @returns a stylesheet fragment safe to concatenate into a plugin's CSS.
 */
export function fitRulesFor(selectors: readonly string[]): string {
  return selectors
    .map(selector => FIT_RULES.replaceAll('&', selector))
    .join('\n')
}

/**
 * Global fallback: the same rules bound to a class a consumer adds to any
 * wrapper element it renders. For surfaces whose DOM the consumer does not
 * control (a forwarded primitive's internal nodes), prefer
 * {@link fitRulesFor} with the consumer's own container selector — that needs
 * no cooperation from the primitive's markup.
 */
export const PRIMITIVES_FIT_CLASS = 'dsh-ui-primitives-fit'

/** The fit rules scoped to {@link PRIMITIVES_FIT_CLASS}. */
export const PRIMITIVES_FIT_CSS = fitRulesFor([`.${PRIMITIVES_FIT_CLASS}`])

/** Stable tag id for {@link PRIMITIVES_FIT_CSS}. */
export const PRIMITIVES_FIT_CSS_ID = '@just-genius/dsh-plugin-ui/primitives-fit.css'

let injected = false

/**
 * Inject {@link PRIMITIVES_FIT_CSS} once through this package's own injection
 * contract, so it is idempotent and the HMR receiver can strip it like any
 * other plugin stylesheet.
 *
 * Prefer {@link fitRulesFor} when you own the container selector: scoping the
 * rules into your existing stylesheet costs nothing and cannot race the first
 * render. Use this only for markup you cannot reach with a selector.
 */
export function ensurePrimitivesFitStyles(): void {
  if (injected || typeof document === 'undefined') return
  const selector = 'style[data-plugin-css=' + JSON.stringify(PRIMITIVES_FIT_CSS_ID) + ']'
  // Another copy of this module (a second bundled instance) may have injected
  // it already; the DOM is the only shared source of truth for that.
  if (document.querySelector(selector) !== null) {
    injected = true
    return
  }
  const tag = document.createElement('style')
  tag.dataset.plugin = '@just-genius/dsh-plugin-ui'
  tag.dataset.pluginCss = PRIMITIVES_FIT_CSS_ID
  tag.textContent = PRIMITIVES_FIT_CSS
  document.head.appendChild(tag)
  injected = true
}
