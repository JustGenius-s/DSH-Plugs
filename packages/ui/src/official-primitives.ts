// Loader-aware shared boundary for content-heavy primitives already owned by
// DSH. Keeping this separate prevents an ordinary plugin-ui import (an icon or
// button) from eagerly evaluating the Markdown/KaTeX implementation — and,
// more importantly, from emitting a `require("@deepseek-ai/dsh-client-ui-primitives")`
// into bundles that never render a conversation. That require is a DSH client
// module: a plugin carrying it must declare the package in `dsh.client.inject`.
import type { ComponentProps } from 'react'
import {
  CodeBlock,
  DiffBlock,
  JsonBlock,
  MarkdownText as MarkdownTextImpl,
  projectUserText as projectUserTextImpl,
  ReadBlock,
  SearchBlock,
  TerminalBlock,
  WebBlock,
  DEFAULT_DIFF_MAX_LINES,
  DEFAULT_READ_MAX_LINES,
  DEFAULT_SEARCH_MAX_LINES,
  DEFAULT_TERMINAL_MAX_LINES,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  CodeBlockProps,
  DiffBlockLabels,
  DiffBlockProps,
  DiffHunk,
  JsonTreeProps,
  MarkdownCodeLabels,
  MarkdownFileMentions,
  MarkdownLabels,
  ReadBlockLabels,
  ReadBlockLine,
  ReadBlockProps,
  SearchBlockLabels,
  SearchBlockLineMatch,
  SearchBlockProps,
  SearchFileGroup,
  TerminalBlockLabels,
  TerminalBlockProps,
  WebBlockLabels,
} from '@deepseek-ai/dsh-client-ui-primitives'

export {
  CodeBlock,
  DiffBlock,
  JsonBlock,
  ReadBlock,
  SearchBlock,
  TerminalBlock,
  WebBlock,
  DEFAULT_DIFF_MAX_LINES,
  DEFAULT_READ_MAX_LINES,
  DEFAULT_SEARCH_MAX_LINES,
  DEFAULT_TERMINAL_MAX_LINES,
}
// Renamed on purpose: the root entry ships its own lighter `MarkdownText`, and
// this is the streaming-aware renderer with code-copy labels. Exporting it
// under its own name would shadow ours.
export const OfficialMarkdownText = MarkdownTextImpl
export const OfficialUserText = projectUserTextImpl
export type {
  CodeBlockProps,
  DiffBlockLabels,
  DiffBlockProps,
  DiffHunk,
  JsonTreeProps,
  MarkdownCodeLabels,
  MarkdownFileMentions,
  MarkdownLabels,
  ReadBlockLabels,
  ReadBlockLine,
  ReadBlockProps,
  SearchBlockLabels,
  SearchBlockLineMatch,
  SearchBlockProps,
  SearchFileGroup,
  TerminalBlockLabels,
  TerminalBlockProps,
  WebBlockLabels,
}
// `JsonBlock` publishes no prop type of its own, so derive it from the
// component. `MessageText` was deleted in 0.1.5 — a consumer that needs a
// projected user bubble uses `OfficialUserText` instead.
export type JsonBlockProps = ComponentProps<typeof JsonBlock>
// Width-fitting stylesheet for the forwarded components above. Their own CSS
// modules are NOT injected into a plugin bundle (see primitives-fit.ts), so a
// consumer that renders them must scope the fit rules to its own containers
// (`fitRulesFor`) or call `ensurePrimitivesFitStyles()` once — otherwise
// assistant answers render with browser defaults and a narrow side panel gets
// a horizontal scrollbar on any long code line or table.
export {
  PRIMITIVES_FIT_CSS,
  PRIMITIVES_FIT_CSS_ID,
  PRIMITIVES_FIT_CLASS,
  ensurePrimitivesFitStyles,
  fitRulesFor,
} from './primitives-fit'
