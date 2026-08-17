# @just-genius/dsh-codex

The consolidated Codex shell for Codex-style navigation, side panels, and a Warp-style terminal.

This package owns the Codex settings section, the `side.panel` shell, the imperative `ctx.sidePanels` service, and the Terminal panel. Terminal behavior is configurable from the Codex settings page, including enablement, shell selection, scrollback, font size, panel width, and remembered tabs.

The old standalone side-panel and Warp Terminal packages are no longer profile dependencies. Their legacy localStorage keys remain readable so existing panel state is preserved.

## Build

~~~bash
pnpm install
pnpm run typecheck
pnpm run build
~~~
