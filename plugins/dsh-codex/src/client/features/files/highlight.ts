/**
 * Syntax highlighting for the files panel's code preview.
 *
 * Mirrors the app's own highlighter (`dsh-client-ui-primitives` markdown/
 * highlight, which is not exported): a synchronous shiki core on the
 * JavaScript regex engine with a CSS-variables theme. Token colors resolve
 * through the global `--shiki-*` custom properties the theme package injects,
 * so preview colors match the conversation's code blocks exactly. Grammars
 * are bundled eagerly — the plugin ships a single client file and cannot lazy
 * `import()` chunks — so the allowlist stays small.
 */
import type { CSSProperties } from 'react'
import { createCssVariablesTheme, createHighlighterCoreSync } from 'shiki/core'
import {
  createJavaScriptRegexEngine,
  defaultJavaScriptRegexConstructor,
} from 'shiki/engine/javascript'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'
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

const LANGS = [
  langTs,
  langBash,
  langJson,
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
]

/**
 * Language hints (file-extension ids) → registered grammar ids. A Map, not an
 * object: extensions are file-authored, so a name like `constructor` must
 * miss instead of resolving an inherited property. The JS family maps to the
 * TypeScript grammar — the same approximation the app's highlighter makes.
 */
const LANG_ALIASES = new Map([
  ['typescript', 'typescript'],
  ['ts', 'typescript'],
  ['tsx', 'typescript'],
  ['javascript', 'typescript'],
  ['js', 'typescript'],
  ['jsx', 'typescript'],
  ['shellscript', 'shellscript'],
  ['bash', 'shellscript'],
  ['sh', 'shellscript'],
  ['shell', 'shellscript'],
  ['zsh', 'shellscript'],
  ['json', 'json'],
  ['jsonc', 'json'],
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
  ['less', 'scss'],
  ['sql', 'sql'],
  ['xml', 'xml'],
  ['svg', 'xml'],
])

/** Token colors resolve through the global `--shiki-*` custom properties. */
const cssVariablesTheme = createCssVariablesTheme({
  name: 'css-variables',
  variablePrefix: '--shiki-',
  fontStyle: true,
})

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
    themes: [cssVariablesTheme],
    langs: LANGS,
    engine: regexEngine,
  })
}

function highlighter() {
  singleton ??= createHighlighter()
  return singleton
}

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
  const { tokens } = highlighter().codeToTokens(code, {
    lang: resolved,
    theme: 'css-variables',
  })
  const last = tokens[tokens.length - 1]
  const rows =
    tokens.length > 1 && last !== undefined && last.length === 0
      ? tokens.slice(0, -1)
      : tokens
  return rows.map((line) =>
    line.map((token) => ({
      text: token.content,
      style: { color: token.color },
    })),
  )
}
