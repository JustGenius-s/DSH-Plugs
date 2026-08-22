# @just-genius/dsh-plugin-ui

DSH-native UI kit: `--dsw-*` theme tokens plus React primitives. Used by plugins in this monorepo (bundled at build time) and by standalone apps such as Vellum (runtime dependency).

## What it exports

| Surface | Contents |
| --- | --- |
| `.` | Components + `installTheme` / `setThemePreference` |
| `./theme.css` | Concatenated token sheets for Vite/CSS `@import` |
| `./css-modules` | Build helper (`dshCssModules`) for plugin tsdown configs |

**Atoms:** `Button`, `Input`, `Pill`, `Tooltip`, `Modal`, `Menu`, `StateDot`, `DisclosureRow`, plus the `ic_ds_*` icon set.

**Settings chrome:** `Switch`, `Field*`, `SettingsCard`, `ExpandableRow`, `Tree*`, `FilterChip*`, `Tag`, …

## Standalone app (e.g. Vellum)

```ts
// boot once
import { installTheme } from '@just-genius/dsh-plugin-ui'
installTheme('system') // 'light' | 'dark' | 'system'
```

```css
@import '@just-genius/dsh-plugin-ui/theme.css';
```

```ts
import { Button, Input, Modal } from '@just-genius/dsh-plugin-ui'
```

Tokens live on `body` / `body[data-ds-dark-theme]`. Dark mode is toggled by `installTheme` / `setThemePreference`, not by a `.dark` class.

## Sync theme from deepseek-harness

```sh
pnpm --filter @just-genius/dsh-plugin-ui sync-theme
# or: DSH_THEME_SRC=/path/to/ui-theme/src/styles pnpm sync-theme
```

`prebuild` runs the same sync. Source default: `~/Ops/deepseek-harness/packages/client/ui-theme/src/styles`.

## Local link (before npm publish)

```json
"@just-genius/dsh-plugin-ui": "file:../DSH-Plugs/packages/ui"
```

Build this package first (`pnpm --filter @just-genius/dsh-plugin-ui build`) so `lib/` exists.

## Peer deps

`react` and `react-dom` `>=18.2.0`.
