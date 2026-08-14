# @just-genius/dsh-plugin-marketplace

Adds a **Marketplace** tab to DSH **Settings → Plugins**. It merges two sources:
this [DSH-Plugs](https://github.com/Rory-X/DSH-Plugs) monorepo, and the curated
[awesome-dsh-plugin](https://awesome-dsh-plugin.com/) registry. It marks plugins
already present in the current Loader inventory, and can copy or run the
catalog install command.

The official **Plugin configuration** and **Plugin list** tabs are left in place.

## What it does

- Registers `settings.plugins.tab` with `id: marketplace` (order 5).
- Host `GET /dsh-plugin-marketplace/catalog` merges this repo's plugins
  (local `plugins/*` when linked, otherwise `github:Rory-X/DSH-Plugs#path:…`)
  in front of `https://awesome-dsh-plugin.com/plugins.json`.
- Client falls back to the same merge if the Host proxy is down.
- Shows source chips, categories, search, and bilingual descriptions.
- Compares `packageName` / repo name against `pluginInventory.list()` to tag **Installed**.
- **Copy install command** writes the catalog command to the clipboard.
- **Install** POSTs `{ spec }` to `/dsh-plugin-marketplace/install`. The Host
  only accepts specs that appear in the merged catalog (`github:owner/repo`,
  `#path:` monorepo specs, or an absolute local folder), then runs
  `dsh plugin --profile web add <spec>`. Plugins that replace official UI
  (e.g. `dsh-model-custom-ex`) also write the matching `cordis.patch.yml` disable.
- After a successful install the UI shows **Restart required**. New bundles
  are composed at process start — refresh is not enough.

## Install

```bash
cd /path/to/DSH-Plugs
pnpm install
pnpm --filter @just-genius/dsh-plugin-marketplace build
dsh plugin --profile web add ./plugins/dsh-plugin-marketplace
```

Restart the DSH web profile, then open **Settings → Plugins → Marketplace**.

## Uninstall

```bash
dsh plugin --profile web remove @just-genius/dsh-plugin-marketplace
```

Then restart DSH.

## Notes

- This is a discovery UI over a curated list, not a signed store. Review the
  GitHub repo before installing third-party code.
- Install writes `~/.dsh/profiles/web`. Git-hosted plugins may need an
  `allowBuilds` entry in that profile's `pnpm-workspace.yaml`.
