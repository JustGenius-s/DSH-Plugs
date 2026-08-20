// DSH-native UI primitives shared by the plugins in this monorepo. Every
// component pulls the official DSH look (design tokens, geometry, motion)
// from ./styles and self-injects it on first render, so consumers only pay
// a component import. These components cover the official settings/list
// chrome that @deepseek-ai/dsh-client-ui-primitives does not export
// (PluginCard, fields, inventory rows); anything the primitives package
// already ships (Button, Input, Menu, StateDot, ...) is used from there
// instead of being re-created here.
//
// The implementation is split by domain; this entry only re-exports, so the
// public API stays a single import surface.

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
