# @just-genius/dsh-plugin-config

Replaces the official read-only **Plugin list** tab in **Settings → Plugins** with a manageable inventory: grouped, labeled, and actionable.

## Features

- **Grouping** — plugins are grouped by **origin** (DSH built-in / marketplace / external) and **mount plane** (global host vs session / agent-preset).
- **Actions** — **Disable** / **Enable** (writes `~/.dsh/profiles/web/cordis.patch.yml`) and **Uninstall** (`dsh plugin --profile web remove`) for profile-owned plugins.
- **Collision flags** — short-name collisions between external/marketplace plugins and `@deepseek-ai/*` built-ins are called out.
- **Safety rails** — core web-surface rows stay locked; session-plane tools parked for agent presets cannot be flipped back on from the host.

## Design

| Source | Role |
| --- | --- |
| `src/index.ts` | Host entry: serves the inventory and mutation endpoints |
| `src/inventory.ts`, `src/classify.ts` | Loader-row inventory and origin/plane classification |
| `src/actions.ts`, `src/profile.ts` | Disable/enable/uninstall mutations against the profile |
| `src/client/index.ts`, `src/client/ManageTab.tsx` | The replacement tab UI (CSS Modules for styling) |

The stock tab dumps every Loader row into one searchable grid; this plugin keeps the same tab slot but layers classification and mutations on top, replacing `ui-settings-plugin-inventory` via cordis patch.

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

Restart DSH web, then open **Settings → Plugins → Plugin list**.

## Uninstall

```sh
dsh plugin --profile web remove @just-genius/dsh-plugin-config
```

Removing the bundle also drops its disable of `ui-settings-plugin-inventory`, so the official read-only list returns after restart.
