# @just-genius/dsh-plugin-config

**Settings → 插件管理** as one tab for **two plugin kinds**:

1. **Cordis plugins** — npm packages from awesome-dsh-plugin / profile (`dsh plugin add`). Install/enable/disable/uninstall writes the web profile; usually needs a DSH restart.
2. **Agent capability packs** — data packs (manifest + hosted MCP + skills) from the builtin catalog under `catalog/`. Install only copies files to `~/.dsh/agent-plugins/installed/<name>/` and updates `~/.dsh/agent-plugins/state.json`. **Enable** connects remote MCP and registers tools/skills into the live agent; **disable** detaches runtime but keeps credentials; **uninstall** detaches, deletes the install dir, clears state, and removes that pack's credentials.


## Features

- **Installed (collapsible, open by default)** — group by origin (built-in / marketplace / external) with the same funnel filter + tree hierarchy as the marketplace; **Disable** / **Enable** / **Uninstall** for profile-owned plugins.
- **Marketplace** — awesome-dsh-plugin catalog only (no hardcoded DSH-Plugs source). Search, category filters, copy install command, one-click install.
- **Shared top search** — filters both the installed list and the marketplace list.
- **Safety rails** — core web-surface rows stay locked; session-plane preset tools are not toggled from the host.

## Design

| Source | Role |
| --- | --- |
| `src/index.ts` | Host: Cordis inventory/action/catalog/install + Agent pack routes |
| `src/agent/*` | Agent pack activator (MCP mount / auth / uninstall cleanup) |
| `catalog/*` | Builtin Agent pack catalog (Supabase, CloudBase, …) |
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
