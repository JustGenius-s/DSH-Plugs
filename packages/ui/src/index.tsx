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

// Conversation-rendering surfaces deliberately live in `./official-primitives`,
// NOT here. They are forwarded from `@deepseek-ai/dsh-client-ui-primitives`,
// which is a DSH client module: importing it emits
// `require("@deepseek-ai/dsh-client-ui-primitives")` into whichever bundle
// consumes this entry. A plugin that only wanted a Button would then need
// `dsh.client.inject` to declare that package, and would eagerly evaluate the
// Markdown/KaTeX implementation at load time. Keeping the forwarding behind its
// own subpath leaves this entry free of any official-module require — the
// light `MarkdownText` above stays usable without one.
