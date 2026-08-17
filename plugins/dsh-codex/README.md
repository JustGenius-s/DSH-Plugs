# @just-genius/dsh-codex

The consolidated Codex shell for Codex-style navigation, side panels, a Warp-style terminal, and a Git commit graph.

This package owns the Codex settings section, the `side.panel` shell, the imperative `ctx.sidePanels` service, the Terminal panel, and the Git panel. Terminal and graph behavior are configurable from the Codex settings page. The graph is a side-panel feature: host routes at `/dsh-codex/git-graph` walk `git log` for the session cwd, and the client draws lanes in the same shell as Terminal. Right-click a commit for copy, checkout, branch, cherry-pick, revert, and reset.

The old standalone side-panel and Warp Terminal packages are no longer profile dependencies. Their legacy localStorage keys remain readable so existing panel state is preserved.

## Build

~~~bash
pnpm install
pnpm run typecheck
pnpm run build
~~~
