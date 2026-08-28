# DSH dependency contracts

Official DSH packages expose nominally branded runtime, slot, session, and
schema types. Plugins therefore do not select or import those packages
independently. The repository has two shared ownership boundaries:

- `@just-genius/dsh-plugin-runtime` owns all host/client DSH API adapters,
  service accessors, declaration bridges, and official package versions.
- `@just-genius/dsh-plugin-ui` owns reusable UI primitives and bundles its
  browser implementation dependencies.

Every plugin has `@just-genius/dsh-plugin-runtime: workspace:*` as a production
dependency. A plugin may use the shared UI package while building its client
bundle, but no plugin `dependencies`, `devDependencies`, or `peerDependencies`
may contain an `@deepseek-ai/*` package. The names under `dsh.client.inject`
are platform module declarations, not npm dependencies, and remain allowed.

The shared runtime is tested against the newest published DSH contract line,
currently `0.1.1-rc.2`, using exact pins. The only recorded registry exception
is the legacy `dsh-client-schema-form` package at `0.1.0-rc.7`; this repository
does not consume it because the current Settings API exposes
`SettingsSchemaService` from `dsh-client-ui-settings`.

The current adapter map follows the APIs that actually exist in that release:

| Shared face | Official owner |
| --- | --- |
| Client context, session/workspace faces, conversation snapshots | `dsh-client-runtime/client` |
| Settings scope, schema operations, and describe mirror | `dsh-client-ui-settings/client` |
| Remote/connection API and wire views | `dsh-api-remotes/client` + `dsh-client-connection/client` |
| Slot, locale, and conversation extension points | their current `dsh-client-ui-*` modules |
| Surface event guards | the `dsh-session` surface contract |

`createSnapshotStore` and the two surface guards are behavior-compatible local
implementations in the client adapter. The official `dsh-client-runtime/client`
JavaScript is itself wrapped for DSH's browser module loader, so importing its
named values into a plugin bundle is not valid ESM. Their public types still
come from the official package.

Run `pnpm typecheck` after changing an import or manifest. The dependency guard
rejects direct official imports/augmentations in plugin source and rejects
official npm dependencies in plugin manifests. To adopt a later DSH release,
update `packages/runtime` and its adapters together, regenerate the lockfile,
then run the full typecheck and build.

Client bundles run inside DSH's finite module table, not Node's general
resolver. `pnpm check:client-modules` verifies that generated `require()` calls
are either React platform seeds or packages listed under `dsh.client.inject`.
It also rejects leaked shared-package requires and the retired official
primitives package. The root build runs this check automatically.
