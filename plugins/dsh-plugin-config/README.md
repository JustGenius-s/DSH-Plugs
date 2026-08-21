# @just-genius/dsh-plugin-config

**Settings → 插件管理** as one tab: manage what is installed, then browse and install from [awesome-dsh-plugin](https://awesome-dsh-plugin.com/).

## Features

- **Installed (collapsible, open by default)** — group by origin (built-in / marketplace / external) with the same funnel filter + tree hierarchy as the marketplace; **Disable** / **Enable** / **Uninstall** for profile-owned plugins.
- **Marketplace** — awesome-dsh-plugin catalog only (no hardcoded DSH-Plugs source). Search, category filters, copy install command, one-click install.
- **Shared top search** — filters both the installed list and the marketplace list.
- **Safety rails** — core web-surface rows stay locked; session-plane preset tools are not toggled from the host.

## Design

| Source | Role |
| --- | --- |
| `src/index.ts` | Host: inventory / action / catalog / install routes |
| `src/inventory.ts`, `src/classify.ts`, `src/actions.ts`, `src/profile.ts` | Installed inventory + profile mutations |
| `src/market/*` | Awesome catalog fetch, install validation |
| `src/client/PluginsTab.tsx` | Single tab UI (search + installed + market) |

Replaces `ui-settings-plugin-inventory` via cordis patch.

## Develop

```sh
pnpm install
pnpm typecheck
pnpm build
```

## Install

```sh
dsh plugin --profile web add ./plugins/dsh-plugin-config
```

Restart DSH web, then open **Settings → 插件管理**.

## Uninstall

```sh
dsh plugin --profile web remove @just-genius/dsh-plugin-config
```

Removing the bundle also drops its disable of `ui-settings-plugin-inventory`, so the official read-only list returns after restart.
