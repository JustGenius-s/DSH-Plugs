// Loader-aware shared boundary for content-heavy primitives already owned by
// DSH. Keeping this separate prevents an ordinary plugin-ui import (an icon or
// button) from eagerly evaluating the Markdown/KaTeX implementation.
export {
  CodeBlock,
  DiffBlock,
  JsonBlock,
  MarkdownText as OfficialMarkdownText,
  MessageText,
  ReadBlock,
  SearchBlock,
  TerminalBlock,
} from '@deepseek-ai/dsh-client-ui-primitives'
export type { MarkdownCodeLabels } from '@deepseek-ai/dsh-client-ui-primitives'
