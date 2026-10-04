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
  TextField,
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
// The official menu container and its row types, forwarded.
//
// A plugin that draws its own menu must use the SAME menu the host uses, or the
// two drift: the shared layer used to carry a hand-written copy of this
// component, and the copy had already diverged in ways that mattered — it
// hand-built its rows as raw `<button>`s instead of using `MenuItemButton`, so
// its rows did not share the host rows' layout, keyboard walk, or focus return.
// Forwarding removes the second implementation entirely.
//
// The exported type names are identical to the host's, so a consumer's
// `import type { MenuEntry }` keeps working unchanged.
export { Menu, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
export type { MenuEntry, MenuItem, MenuSeparator, MenuLabel, MenuItemButtonProps } from '@deepseek-ai/dsh-client-ui-primitives'
export { StateDot } from './primitives/StateDot'
export type { StateDotState } from './primitives/StateDot'
export { DisclosureRow } from './primitives/DisclosureRow'
export type { DisclosureRowProps } from './primitives/DisclosureRow'
export { MarkdownText } from './primitives/MarkdownText'
export { RiskConfirmation } from './primitives/RiskConfirmation'
export type { RiskConfirmationProps } from './primitives/RiskConfirmation'
export { Toast } from './primitives/Toast'

export * from './icons/index'

// Conversation renderers live behind their own subpath. Lightweight menus,
// glyphs and relative-time helpers remain available from this shared entry.
// The shared relative-time bucketing. Exported so a plugin listing sessions
// dates them with the SAME buckets the official rows use; the words stay in the
// consuming plugin's dictionary, as the helper's own contract requires.
export { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
export type { RelativeTime, RelativeTimeUnit } from '@deepseek-ai/dsh-client-ui-primitives'
// Official glyphs, re-exported under a plugin-facing name.
//
// A plugin row must look identical to the official row beside it, so where DSH
// already ships the exact artwork we FORWARD the component rather than copying
// its paths into our own icon set: a copy drifts the moment DSH redraws the
// glyph, and two copies of one shape is exactly how two surfaces end up looking
// subtly different.
//
// The `Regular` variant is deliberate, and the bare name is a trap: these ship
// as an Artwork plus `Regular` (1px stroke) and `Medium` (1.3px) wrappers, and
// the BARE name exists ONLY in the TypeScript declarations. Importing the bare
// name typechecks, then resolves to `undefined` at runtime — which React reports
// as "Element type is invalid" (error #130), not as a missing import.
export {
  IconArchiveOutlineRegular as OfficialArchiveIcon,
  IconBranchOutlineRegular as OfficialBranchIcon,
  IconCheckCircleOutlineRegular as OfficialCheckCircleIcon,
  IconCopyOutlineRegular as OfficialCopyIcon,
  IconDownloadOutlineRegular as OfficialDownloadIcon,
  IconEditOutlineRegular as OfficialEditIcon,
  IconFolderOpenOutlineRegular as OfficialFolderOpenIcon,
  IconNewChatOutlineRegular as OfficialNewChatIcon,
  IconPinFillRegular as OfficialPinFillIcon,
  IconPinOutlineRegular as OfficialPinOutlineIcon,
  IconTrashOutlineRegular as OfficialTrashIcon,
  IconWorkspaceTreeOutlineRegular as OfficialWorkspaceTreeIcon,
} from '@deepseek-ai/dsh-client-ui-primitives'
