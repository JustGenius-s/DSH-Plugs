# @just-genius/dsh-plugin-config

**Settings → 插件 → 插件扩展** as an additional tab for **two plugin kinds**:

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
| `catalog/*` | Builtin Agent pack catalog (Supabase, CloudBase, COS) |
| `src/inventory.ts`, `src/classify.ts`, `src/actions.ts`, `src/profile.ts` | Installed inventory + profile mutations |
| `src/market/*` | Awesome catalog fetch, install validation |
| `src/client/PluginsTab.tsx` | Single tab UI (search + installed + market) |

The bundle patch only adds this plugin. Its `settings.plugins.tab` contribution
uses the independent id `dsh-plugin-config`, leaving the official `all` inventory
tab enabled and selectable.

On DSH **v0.1.6-alpha.2 and later**, the sidebar **插件 / Plugins** page owns the
official plugin manager (install, configure, enable, disable, and uninstall).
This extension coexists with that page and the official Settings **插件列表 /
Plugin list**, adding the marketplace, npm updates, and Agent packs. Both the
official manager and inventory are protected from disable/uninstall actions here.

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

Restart DSH web, then open **Settings → 插件 → 插件扩展**.

When upgrading from the earlier replacement version, update/rebuild this plugin
and restart DSH so its bundle patch is recomposed. The old bundle-owned disable
of `ui-settings-plugin-inventory` then disappears; no profile migration is needed.
If you separately disabled that entry in your profile's own `cordis.patch.yml`,
remove that override to restore the official Settings list.

## Uninstall

```sh
dsh plugin --profile web remove @just-genius/dsh-plugin-config
```

Removing the bundle removes only the extension tab and its services; DSH's own
plugin pages remain available.
