/**
 * Syntax highlighting for the files panel's code preview.
 *
 * A synchronous shiki core on the JavaScript regex engine, themed with
 * VSCode's default token colors: `light-plus` / `dark-plus` (the "Light
 * Modern" / "Dark Modern" themes share Dark+/Light+'s TextMate token colors;
 * the Modern variants only re-skinned the workbench). Both themes ride one
 * tokenization through shiki's dual-theme mode: each token carries its light
 * color as `var(--shiki-light)` plus a `--shiki-dark` custom property, and
 * the panel stylesheet flips on `body[data-ds-dark-theme]` — the same marker
 * the app's ui-theme package uses. Grammars are bundled eagerly — the plugin
 * ships a single client file and cannot lazy `import()` chunks — so the list
 * covers common languages without shipping shiki's full catalog.
 */
import type { CSSProperties } from 'react'
import { createHighlighterCoreSync } from 'shiki/core'
import {
  createJavaScriptRegexEngine,
  defaultJavaScriptRegexConstructor,
} from 'shiki/engine/javascript'
import themeDarkPlus from '@shikijs/themes/dark-plus'
import themeLightPlus from '@shikijs/themes/light-plus'
import langTs from '@shikijs/langs/typescript'
import langJavascript from '@shikijs/langs/javascript'
import langJsx from '@shikijs/langs/jsx'
import langTsx from '@shikijs/langs/tsx'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'
import langJsonc from '@shikijs/langs/jsonc'
import langJson5 from '@shikijs/langs/json5'
import langPython from '@shikijs/langs/python'
import langGo from '@shikijs/langs/go'
import langRust from '@shikijs/langs/rust'
import langJava from '@shikijs/langs/java'
import langC from '@shikijs/langs/c'
import langCpp from '@shikijs/langs/cpp'
import langCsharp from '@shikijs/langs/csharp'
import langRuby from '@shikijs/langs/ruby'
import langPhp from '@shikijs/langs/php'
import langYaml from '@shikijs/langs/yaml'
import langToml from '@shikijs/langs/toml'
import langMarkdown from '@shikijs/langs/markdown'
import langHtml from '@shikijs/langs/html'
import langCss from '@shikijs/langs/css'
import langScss from '@shikijs/langs/scss'
import langSql from '@shikijs/langs/sql'
import langXml from '@shikijs/langs/xml'
import langVue from '@shikijs/langs/vue'
import langSvelte from '@shikijs/langs/svelte'
import langAstro from '@shikijs/langs/astro'
import langMdx from '@shikijs/langs/mdx'
import langLess from '@shikijs/langs/less'
import langSass from '@shikijs/langs/sass'
import langStylus from '@shikijs/langs/stylus'
import langPostcss from '@shikijs/langs/postcss'
import langHandlebars from '@shikijs/langs/handlebars'
import langPug from '@shikijs/langs/pug'
import langJinja from '@shikijs/langs/jinja'
import langTwig from '@shikijs/langs/twig'
import langErb from '@shikijs/langs/erb'
import langRazor from '@shikijs/langs/razor'
import langDart from '@shikijs/langs/dart'
import langSwift from '@shikijs/langs/swift'
import langKotlin from '@shikijs/langs/kotlin'
import langObjectiveC from '@shikijs/langs/objective-c'
import langScala from '@shikijs/langs/scala'
import langGroovy from '@shikijs/langs/groovy'
import langLua from '@shikijs/langs/lua'
import langPerl from '@shikijs/langs/perl'
import langR from '@shikijs/langs/r'
import langJulia from '@shikijs/langs/julia'
import langPowershell from '@shikijs/langs/powershell'
import langBat from '@shikijs/langs/bat'
import langCoffeescript from '@shikijs/langs/coffeescript'
import langDockerfile from '@shikijs/langs/dockerfile'
import langMakefile from '@shikijs/langs/makefile'
import langCmake from '@shikijs/langs/cmake'
import langNginx from '@shikijs/langs/nginx'
import langHcl from '@shikijs/langs/hcl'
import langTerraform from '@shikijs/langs/terraform'
import langIni from '@shikijs/langs/ini'
import langReg from '@shikijs/langs/reg'
import langDiff from '@shikijs/langs/diff'
import langGraphql from '@shikijs/langs/graphql'
import langPrisma from '@shikijs/langs/prisma'
import langProtobuf from '@shikijs/langs/protobuf'
import langCsv from '@shikijs/langs/csv'
import langVim from '@shikijs/langs/vim'
import langSolidity from '@shikijs/langs/solidity'
import langWasm from '@shikijs/langs/wasm'
import langTex from '@shikijs/langs/tex'
import langLatex from '@shikijs/langs/latex'
import langBibtex from '@shikijs/langs/bibtex'
import langHaskell from '@shikijs/langs/haskell'
import langOcaml from '@shikijs/langs/ocaml'
import langElixir from '@shikijs/langs/elixir'
import langErlang from '@shikijs/langs/erlang'
import langClojure from '@shikijs/langs/clojure'
import langElm from '@shikijs/langs/elm'
import langNix from '@shikijs/langs/nix'
import langLisp from '@shikijs/langs/lisp'
import langScheme from '@shikijs/langs/scheme'
import langRacket from '@shikijs/langs/racket'
import langZig from '@shikijs/langs/zig'
import langNim from '@shikijs/langs/nim'
import langCrystal from '@shikijs/langs/crystal'
import langV from '@shikijs/langs/v'
import langFsharp from '@shikijs/langs/fsharp'
import langVb from '@shikijs/langs/vb'
import langGdscript from '@shikijs/langs/gdscript'

const LANGS = [
  langTs,
  langJavascript,
  langJsx,
  langTsx,
  langBash,
  langJson,
  langJsonc,
  langJson5,
  langPython,
  langGo,
  langRust,
  langJava,
  langC,
  langCpp,
  langCsharp,
  langRuby,
  langPhp,
  langYaml,
  langToml,
  langMarkdown,
  langHtml,
  langCss,
  langScss,
  langSql,
  langXml,
  langVue,
  langSvelte,
  langAstro,
  langMdx,
  langLess,
  langSass,
  langStylus,
  langPostcss,
  langHandlebars,
  langPug,
  langJinja,
  langTwig,
  langErb,
  langRazor,
  langDart,
  langSwift,
  langKotlin,
  langObjectiveC,
  langScala,
  langGroovy,
  langLua,
  langPerl,
  langR,
  langJulia,
  langPowershell,
  langBat,
  langCoffeescript,
  langDockerfile,
  langMakefile,
  langCmake,
  langNginx,
  langHcl,
  langTerraform,
  langIni,
  langReg,
  langDiff,
  langGraphql,
  langPrisma,
  langProtobuf,
  langCsv,
  langVim,
  langSolidity,
  langWasm,
  langTex,
  langLatex,
  langBibtex,
  langHaskell,
  langOcaml,
  langElixir,
  langErlang,
  langClojure,
  langElm,
  langNix,
  langLisp,
  langScheme,
  langRacket,
  langZig,
  langNim,
  langCrystal,
  langV,
  langFsharp,
  langVb,
  langGdscript,
]

/**
 * Language hints (file-extension ids) → registered grammar ids. A Map, not an
 * object: extensions are file-authored, so a name like `constructor` must
 * miss instead of resolving an inherited property. Several grammar ids differ
 * from their module names (docker/make/proto/viml/common-lisp/coffee).
 */
const LANG_ALIASES = new Map([
  ['typescript', 'typescript'],
  ['ts', 'typescript'],
  ['mts', 'typescript'],
  ['cts', 'typescript'],
  ['tsx', 'tsx'],
  ['javascript', 'javascript'],
  ['js', 'javascript'],
  ['mjs', 'javascript'],
  ['cjs', 'javascript'],
  ['jsx', 'jsx'],
  ['shellscript', 'shellscript'],
  ['bash', 'shellscript'],
  ['sh', 'shellscript'],
  ['shell', 'shellscript'],
  ['zsh', 'shellscript'],
  ['json', 'json'],
  ['jsonc', 'jsonc'],
  ['json5', 'json5'],
  ['py', 'python'],
  ['python', 'python'],
  ['go', 'go'],
  ['rs', 'rust'],
  ['rust', 'rust'],
  ['java', 'java'],
  ['c', 'c'],
  ['h', 'c'],
  ['cpp', 'cpp'],
  ['cc', 'cpp'],
  ['hpp', 'cpp'],
  ['cs', 'csharp'],
  ['csharp', 'csharp'],
  ['rb', 'ruby'],
  ['ruby', 'ruby'],
  ['php', 'php'],
  ['yaml', 'yaml'],
  ['yml', 'yaml'],
  ['toml', 'toml'],
  ['md', 'markdown'],
  ['markdown', 'markdown'],
  ['html', 'html'],
  ['htm', 'html'],
  ['css', 'css'],
  ['scss', 'scss'],
  ['sql', 'sql'],
  ['xml', 'xml'],
  ['svg', 'xml'],
  ['vue', 'vue'],
  ['svelte', 'svelte'],
  ['astro', 'astro'],
  ['mdx', 'mdx'],
  ['less', 'less'],
  ['sass', 'sass'],
  ['styl', 'stylus'],
  ['pcss', 'postcss'],
  ['hbs', 'handlebars'],
  ['handlebars', 'handlebars'],
  ['pug', 'pug'],
  ['jade', 'pug'],
  ['jinja', 'jinja'],
  ['jinja2', 'jinja'],
  ['j2', 'jinja'],
  ['twig', 'twig'],
  ['erb', 'erb'],
  ['cshtml', 'razor'],
  ['dart', 'dart'],
  ['swift', 'swift'],
  ['kt', 'kotlin'],
  ['kts', 'kotlin'],
  ['m', 'objective-c'],
  ['mm', 'objective-c'],
  ['scala', 'scala'],
  ['sc', 'scala'],
  ['groovy', 'groovy'],
  ['gradle', 'groovy'],
  ['gvy', 'groovy'],
  ['lua', 'lua'],
  ['pl', 'perl'],
  ['pm', 'perl'],
  ['r', 'r'],
  ['jl', 'julia'],
  ['ps1', 'powershell'],
  ['psm1', 'powershell'],
  ['psd1', 'powershell'],
  ['bat', 'bat'],
  ['cmd', 'bat'],
  ['coffee', 'coffee'],
  ['dockerfile', 'docker'],
  ['mk', 'make'],
  ['cmake', 'cmake'],
  ['nginx', 'nginx'],
  ['hcl', 'hcl'],
  ['tf', 'terraform'],
  ['tfvars', 'terraform'],
  ['ini', 'ini'],
  ['cfg', 'ini'],
  ['properties', 'ini'],
  ['reg', 'reg'],
  ['diff', 'diff'],
  ['patch', 'diff'],
  ['graphql', 'graphql'],
  ['gql', 'graphql'],
  ['prisma', 'prisma'],
  ['proto', 'proto'],
  ['csv', 'csv'],
  ['vim', 'viml'],
  ['sol', 'solidity'],
  ['wat', 'wasm'],
  ['tex', 'latex'],
  ['sty', 'latex'],
  ['cls', 'latex'],
  ['bib', 'bibtex'],
  ['hs', 'haskell'],
  ['ml', 'ocaml'],
  ['mli', 'ocaml'],
  ['ex', 'elixir'],
  ['exs', 'elixir'],
  ['erl', 'erlang'],
  ['hrl', 'erlang'],
  ['clj', 'clojure'],
  ['cljs', 'clojure'],
  ['cljc', 'clojure'],
  ['elm', 'elm'],
  ['nix', 'nix'],
  ['lisp', 'common-lisp'],
  ['lsp', 'common-lisp'],
  ['cl', 'common-lisp'],
  ['el', 'common-lisp'],
  ['scm', 'scheme'],
  ['ss', 'scheme'],
  ['rkt', 'racket'],
  ['zig', 'zig'],
  ['nim', 'nim'],
  ['cr', 'crystal'],
  ['v', 'v'],
  ['fs', 'fsharp'],
  ['fsx', 'fsharp'],
  ['fsi', 'fsharp'],
  ['vb', 'vb'],
  ['gd', 'gdscript'],
])

const regexEngine = createJavaScriptRegexEngine({
  forgiving: true,
  regexConstructor: (pattern) =>
    defaultJavaScriptRegexConstructor(pattern, {
      lazyCompileLength: Number.POSITIVE_INFINITY,
    }),
})

let singleton: ReturnType<typeof createHighlighter> | undefined

function createHighlighter() {
  return createHighlighterCoreSync({
    themes: [themeLightPlus, themeDarkPlus],
    langs: LANGS,
    engine: regexEngine,
  })
}

function highlighter() {
  singleton ??= createHighlighter()
  return singleton
}

/**
 * Cap for per-line tokenization. VS Code's editor default is 20_000
 * (`editor.maxTokenizationLineLength`); the files panel uses a stricter
 * 4_000 because this is a sidebar preview — files like generated icon
 * maps ship few lines with multi-kilobyte string literals, and the grammar
 * cost scales with line length, not line count.
 */
export const MAX_TOKENIZATION_LINE_LENGTH = 4_000
/**
 * When a large file already has several overlong lines, skip highlighting
 * the whole buffer. Per-line blanking alone still leaves Shiki chewing on
 * many kilobyte-scale neighbours (measured ~0.5–1s on icon data maps).
 */
const SKIP_ALL_HIGHLIGHT_BYTES = 200_000
const SKIP_ALL_HIGHLIGHT_OVERLONG = 10

/** One highlighted run of a line: text plus the inline style shiki assigned. */
export interface HighlightSpan {
  text: string
  style: CSSProperties
}

/**
 * Tokenize `code` into per-line highlighted runs when `lang` maps to a
 * registered grammar; `undefined` means the caller renders its plain
 * fallback. The trailing newline shiki appends as a final empty line is
 * dropped so the run count matches the caller's own line array.
 *
 * Dual-theme mode: each token's `color` is `var(--shiki-light)` (the default
 * color) and both theme values ride the `--shiki-light`/`--shiki-dark`
 * custom properties in `htmlStyle`; the panel CSS swaps to the dark value
 * under `body[data-ds-dark-theme]`.
 *
 * Font styles matter for markup languages: VSCode's default themes bold
 * headings/strong and italicize emphasis in markdown, and shiki reports them
 * as `--shiki-{light,dark}-font-weight/-font-style/-text-decoration` custom
 * properties — which nothing consumes unless mapped back onto real style
 * properties. Both themes share the same seven fontStyle rules, so the light
 * value (dark as fallback) is applied directly.
 *
 * Overlong lines (see `MAX_TOKENIZATION_LINE_LENGTH`) are skipped — same
 * intent as VS Code's line-length gate — so a 97 KB SVG string literal does
 * not stall the main thread for seconds.
 */
export function highlightLines(
  code: string,
  lang: string | undefined,
): HighlightSpan[][] | undefined {
  const resolved =
    lang === undefined || lang === ''
      ? undefined
      : LANG_ALIASES.get(lang.toLowerCase())
  if (resolved === undefined) return undefined
  // Split once so we can both massage blanks AND blank out overlong lines
  // before Shiki sees them. Trailing empty segment from a final `\n` is kept
  // so the massaged string still ends with `\n` when the source did.
  const rawLines = code.split('\n')
  const overlong = new Set<number>()
  const massagedLines: string[] = []
  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index] ?? ''
    // The last empty piece after a trailing newline is not a real content
    // line; leave it alone so `code.endsWith('\n')` still drops the phantom
    // token row below.
    if (index === rawLines.length - 1 && line.length === 0 && code.endsWith('\n')) {
      massagedLines.push('')
      continue
    }
    if (line.length >= MAX_TOKENIZATION_LINE_LENGTH) {
      overlong.add(index)
      massagedLines.push(' ')
      continue
    }
    // Shiki's tokenize loop skips empty lines WITHOUT advancing the grammar
    // stack, so rules whose `while`/`end` is keyed on a blank line (markdown's
    // HTML block ends on one) never see it and swallow the rest of the file.
    massagedLines.push(/^[^\S\n]*$/.test(line) ? ' ' : line)
  }
  // Generated dumps (icon SVGs-in-TS, …): many overlong neighbours in a big
  // buffer — fall back to plain text for the whole file.
  if (
    overlong.size > 0
    && (overlong.size >= SKIP_ALL_HIGHLIGHT_OVERLONG || code.length >= SKIP_ALL_HIGHLIGHT_BYTES)
  ) {
    return undefined
  }
  const massaged = massagedLines.join('\n')
  const { tokens } = highlighter().codeToTokens(massaged, {
    lang: resolved,
    themes: { light: 'light-plus', dark: 'dark-plus' },
    cssVariablePrefix: '--shiki-',
  })
  // The phantom line after a trailing newline now tokenizes to a real
  // (space) row, so drop it based on the source, not on row emptiness.
  const rows =
    tokens.length > 1 && code.endsWith('\n') ? tokens.slice(0, -1) : tokens
  return rows.map((line, lineIndex) => {
    // Overlong source lines: pretend there were no tokens so the view falls
    // back to plain text (then truncates for DOM via stopRenderingLineAfter).
    if (overlong.has(lineIndex)) return []
    return line.map((token) => {
      const style: CSSProperties = {}
      if (token.color !== undefined) style.color = token.color
      const extra = token.htmlStyle
      if (extra !== undefined && typeof extra !== 'string') {
        Object.assign(style, extra)
        const fontWeight = extra['--shiki-light-font-weight'] ?? extra['--shiki-dark-font-weight']
        if (fontWeight !== undefined) style.fontWeight = fontWeight
        const fontStyle = extra['--shiki-light-font-style'] ?? extra['--shiki-dark-font-style']
        if (fontStyle !== undefined) style.fontStyle = fontStyle
        const textDecoration = extra['--shiki-light-text-decoration'] ?? extra['--shiki-dark-text-decoration']
        if (textDecoration !== undefined) style.textDecoration = textDecoration
      }
      return { text: token.content, style }
    })
  })
}
