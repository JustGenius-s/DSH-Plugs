# @just-genius/dsh-model-custom-ex

A fork of the official Models settings page (`@deepseek-ai/dsh-client-ui-settings-models`) that adds the two per-model controls the stock page punts to `settings.yaml`: **vision** (`input`) and **thinking strength** (`reasoningEfforts`).

![Custom Models settings](../../public/model-custom-ex.png)

## Features

- **Input modality (vision)** — per-model dropdown multi-select; checking "image" declares `input: [text, image]` so the model is treated as vision-capable.
- **Reasoning effort** — per-model multi-select over off / minimal / low / medium / high / xhigh / max, written to `reasoningEfforts`; the composer model picker then shows those levels.
- **Pixel-identical otherwise** — provider rows, API keys, model fetching, delete confirmation, and onboarding match the official page; both write to the same `llm-pi-ai` namespace, so the fork is 100% compatible with the official page, the composer, and `settings.yaml`.

## Design

| Source | Role |
| --- | --- |
| `src/index.ts` | Empty host half (bundle loader entry) |
| `src/client/index.ts` | Registers the locale dictionary, the Models section, and the two onboarding steps — fully replacing the official plugin |
| `src/client/*` | Forked official source; the **only** change is in `ModelListEditor.tsx` (search `输入模态` to locate it) |
| `src/client/MultiSelectMenu.tsx` | Dropdown multi-select built on the official `Menu` / `Pill` primitives |
| `tsdown.client.config.ts` | Inlines `.module.css` via `dshCssModules`, matching the official client bundle |

The fork exists because the official model-row editor renders only id / name / context window / max output — `input` and `reasoningEfforts` are per-model capabilities with no UI.

## Develop

```sh
pnpm install
pnpm typecheck
pnpm build
```

### Syncing from upstream

The forked source comes from the deepseek-harness repo's `packages/client/ui-settings-models/src/client`. After an official upgrade:

1. Re-copy that directory into `src/client/`.
2. Re-apply the two multi-select changes in `ModelListEditor.tsx`.
3. Keep `MultiSelectMenu.tsx` and the `index.ts` registration changes.

## Install

```sh
dsh plugin --profile web add ./plugins/dsh-model-custom-ex
```

Then **disable the official plugin** in `~/.dsh/profiles/web/cordis.patch.yml` to avoid two Models tabs:

```yaml
- id: ui-settings-models
  disabled: true
```

Restart DSH web (bundle-stack + cordis patch change — a refresh is not enough).

## Uninstall

Remove the plugin **and** the `ui-settings-models` disable from `cordis.patch.yml`, otherwise the official Models page stays hidden.
