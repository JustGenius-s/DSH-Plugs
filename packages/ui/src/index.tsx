import type { ComponentProps } from 'react'
// DSH-native UI kit for plugins and standalone apps (e.g. Vellum).
//
// Two layers:
// 1. Theme tokens (--dsw-*) via installTheme() / ./theme/all.css
// 2. Components: official-look atoms (Button, Input, …) plus settings/list
//    chrome that @deepseek-ai/dsh-client-ui-primitives does not publish as a
//    standalone dep (PluginCard fields, inventory rows, …).
//
// Components self-inject their CSS on first render (CSS modules) or via
// ensureStyles() for the settings chrome. Standalone apps must call
// installTheme() once at boot so --dsw-* tokens exist.

export {
  Switch,
  Field,
  FieldHead,
  FieldHint,
  SwitchField,
  NumberField,
  ResetButton,
  ActionButton,
  AddButton,
} from './fields'

export {
  PendingBadge,
  SettingsCard,
  CardFooter,
  DiscardButton,
  SaveButton,
} from './settings-card'

export {
  Chevron,
  RowList,
  ExpandableRow,
  Tree,
  TreeGroup,
  TreeIndent,
  TreeSubName,
} from './tree'

export {
  Tag,
  FilterChip,
  FilterChips,
  IconButton,
  InlineNotice,
  CommandRow,
} from './inline'

export {
  SettingsSection,
  StatusText,
  FailureRow,
} from './page'

export { ensureStyles, injectStyles } from './styles'
export { writeClipboard } from './clipboard'

export {
  installTheme,
  setThemePreference,
  getThemePreference,
  isDarkTheme,
} from './install-theme'
export type { ThemePreference } from './install-theme'

export { Button } from './primitives/Button'
export type { ButtonVariant } from './primitives/Button'
export { Input } from './primitives/Input'
export { Pill } from './primitives/Pill'
export { Tooltip } from './primitives/Tooltip'
export type { TooltipSide } from './primitives/Tooltip'
export { Modal } from './primitives/Modal'
export { Menu } from './primitives/Menu'
export type { MenuEntry, MenuItem, MenuSeparator, MenuLabel } from './primitives/Menu'
export { StateDot } from './primitives/StateDot'
export type { StateDotState } from './primitives/StateDot'
export { DisclosureRow } from './primitives/DisclosureRow'
export type { DisclosureRowProps } from './primitives/DisclosureRow'
export { MarkdownText } from './primitives/MarkdownText'
export { RiskConfirmation } from './primitives/RiskConfirmation'
export type { RiskConfirmationProps } from './primitives/RiskConfirmation'
export { Toast } from './primitives/Toast'

export * from './icons/index'

// Conversation-rendering surfaces. These exist only in the official
// `@deepseek-ai/dsh-client-ui-primitives` bundle (Markdown pipeline, JSON tree,
// and ANSI terminal rendering), so the shared UI layer forwards them rather
// than reimplementing them — plugins still import from one boundary.
import {
  CodeBlock,
  DiffBlock,
  JsonBlock,
  MessageText,
  ReadBlock,
  SearchBlock,
  TerminalBlock,
} from '@deepseek-ai/dsh-client-ui-primitives'
export {
  CodeBlock,
  DiffBlock,
  JsonBlock,
  MessageText,
  ReadBlock,
  SearchBlock,
  TerminalBlock,
}
export {
  DEFAULT_DIFF_MAX_LINES,
  DEFAULT_READ_MAX_LINES,
  DEFAULT_SEARCH_MAX_LINES,
  DEFAULT_TERMINAL_MAX_LINES,
} from '@deepseek-ai/dsh-client-ui-primitives'
// Renamed on purpose: this package already ships its own lighter
// `MarkdownText`, and the official one is the streaming-aware renderer with
// code-copy labels. Exporting it under its own name would shadow ours.
export { MarkdownText as OfficialMarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
export type {
  CodeBlockProps,
  DiffBlockProps,
  DiffHunk,
  ReadBlockLine,
  ReadBlockProps,
  SearchBlockProps,
  SearchFileGroup,
  SearchBlockLineMatch,
  TerminalBlockLabels,
  TerminalBlockProps,
  MarkdownCodeLabels,
  MarkdownFileMentions,
} from '@deepseek-ai/dsh-client-ui-primitives'
// Width-fitting stylesheet for the forwarded primitives above. Their own CSS
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
// `JsonBlock` / `MessageText` do not publish named prop types, so derive them
// from the components themselves.

// `JsonBlock` / `MessageText` do not publish named prop types, so derive them
// from the already-exported components.
export type JsonBlockProps = ComponentProps<typeof JsonBlock>
export type MessageTextProps = ComponentProps<typeof MessageText>
