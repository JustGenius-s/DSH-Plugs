# @just-genius/dsh-plugin-config

Replaces the official read-only **Plugin list** tab in **Settings → Plugins**.

The stock tab dumps every Loader row into one searchable grid: no mount-plane grouping, no origin split, and no way to turn a mounted plugin off. This plugin keeps the same tab, then:

1. Groups by **origin** (DSH built-in / marketplace / external) and **plane** (global host vs session / agent-preset).
2. Adds **Disable** / **Enable** (writes `~/.dsh/profiles/web/cordis.patch.yml`) and **Uninstall** (`dsh plugin --profile web remove`) for profile-owned plugins.
3. Flags short-name collisions between external/marketplace plugins and `@deepseek-ai/*` built-ins.

Core web-surface rows stay locked. Session-plane tools that the web bundle already parked for agent presets cannot be flipped back on from the host.

## Install

```bash
cd /path/to/DSH-Plugs
pnpm install
pnpm --filter @just-genius/dsh-plugin-config build
dsh plugin --profile web add ./plugins/dsh-plugin-config
```

Restart the DSH web profile, then open **Settings → Plugins → Plugin list**.

## Uninstall

```bash
dsh plugin --profile web remove @just-genius/dsh-plugin-config
```

Removing this bundle also drops its disable of `ui-settings-plugin-inventory`, so the official read-only list comes back after restart.
