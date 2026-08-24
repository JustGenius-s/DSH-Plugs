# DSH dependency contracts

DSH packages expose nominally branded runtime, slot, session, and schema
types. A semver range can therefore install two structurally similar but
incompatible copies into the same plugin graph.

This repository uses an exact, tested compatibility matrix:

- Foundation and contract packages are pinned to `0.1.0-rc.7`.
- UI shell packages whose public contract is still rc.6 are pinned to
  `0.1.0-rc.6`.
- No `^`, `~`, workspace wildcard, or mixed version is allowed for a DSH
  dependency.

Run `pnpm check:dependency-contracts` after changing a plugin manifest. To
upgrade a family, update the matrix in
`scripts/check-dependency-contracts.mjs`, update every consumer together,
regenerate the lockfile, then run the full typecheck and build.

Client bundles run inside DSH's finite module table, not Node's general
resolver. Shared UI implementation dependencies are bundled at the UI package
boundary. `pnpm check:client-modules` rejects any generated client `require()`
that is not a declared platform peer; the root build runs this automatically.
