# @just-genius/dsh-plugin-marketplace

Adds a **Marketplace** tab to **Settings → Plugins**, merging two catalogs: this [DSH-Plugs](https://github.com/JustGenius-s/DSH-Plugs) monorepo and the curated [awesome-dsh-plugin](https://awesome-dsh-plugin.com/) registry.

## Features

- **Merged catalog** — this repo's plugins (local `plugins/*` when linked, otherwise `github:` monorepo specs) in front of the awesome-dsh-plugin registry, with source chips, categories, search, and bilingual descriptions.
- **Installed detection** — tags plugins already present in the web profile (`dependencies` / `dsh.profile.bundles`) and the live Loader inventory; matches npm names, `github:owner/repo` specs, and local `link:` paths.
- **Copy install command** — writes the catalog install command to the clipboard.
- **One-click install** — POSTs the spec to the host, which only accepts specs present in the merged catalog, then runs `dsh plugin --profile web add <spec>`. Plugins that replace official UI (e.g. `dsh-model-custom-ex`) also write the matching `cordis.patch.yml` disable.
- **Restart required** — after a successful install the UI says so; new bundles are composed at process start, a refresh is not enough.

## Design

| Source | Role |
| --- | --- |
| `src/index.ts` | Host entry: `GET /dsh-plugin-marketplace/catalog` and `POST /dsh-plugin-marketplace/install` |
| `src/catalog.ts`, `src/dsh-plugs.ts`, `src/local-source.ts` | Catalog sources and the merge logic |
| `src/install.ts`, `src/profile-inventory.ts` | Spec validation + install, and installed-state detection |
| `src/client/index.ts`, `src/client/MarketplaceTab.tsx` | The tab UI, registered as `settings.plugins.tab` with `id: marketplace`; falls back to a client-side catalog merge if the host proxy is down |

This is a discovery UI over a curated list, not a signed store — review a plugin's repo before installing third-party code.

## Develop

```sh
pnpm install
pnpm typecheck
pnpm build
```

## Install

```sh
dsh plugin --profile web add ./plugins/dsh-plugin-marketplace
```

Restart DSH web, then open **Settings → Plugins → Marketplace**. Git-hosted plugins may need an `allowBuilds` entry in the profile's `pnpm-workspace.yaml`.

## Uninstall

```sh
dsh plugin --profile web remove @just-genius/dsh-plugin-marketplace
```

Then restart DSH.
