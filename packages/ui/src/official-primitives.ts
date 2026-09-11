// Loader-aware shared boundary for content-heavy primitives already owned by
// DSH. Keeping this separate prevents an ordinary plugin-ui import (an icon or
// button) from eagerly evaluating the Markdown/KaTeX implementation.
export {
  CodeBlock,
  DiffBlock,
  JsonBlock,
  MarkdownText as OfficialMarkdownText,
  projectUserText as OfficialUserText,
  ReadBlock,
  SearchBlock,
  TerminalBlock,
} from '@deepseek-ai/dsh-client-ui-primitives'
export type {
  DiffBlockLabels,
  MarkdownLabels,
  ReadBlockLabels,
  SearchBlockLabels,
  TerminalBlockLabels,
} from '@deepseek-ai/dsh-client-ui-primitives'
