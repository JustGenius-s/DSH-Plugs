# @just-genius/dsh-computer-tools

Settings page for DSH Browser Use and Computer Use. Each capability is one card with its own save. When a card's official packages are missing the page offers **一键安装**, which installs exactly the packages that card needs through `pluginProfile.install`; a copyable command is the fallback.

Requires `@just-genius/dsh-plugin-config` (`pluginProfile`). Target runtime: DSH `0.1.6-alpha.1`.

## Install

```sh
dsh plugin --profile web add ./plugins/dsh-computer-tools
```

Restart DSH web (bundle patch). Then open **Settings → 浏览器与桌面**.

## Enabling a capability

The capability packages are **not** part of the `dsh` runtime and are not bundles — the release only adds support for them. Each one is a separate opt-in install, so a fresh runtime shows them as missing:

| Card | Packages |
| --- | --- |
| 浏览器操作 | `@deepseek-ai/dsh-browser-use`, `@deepseek-ai/dsh-experimental-browser-use-playwright-mcp` |
| 桌面操作 | `@deepseek-ai/dsh-computer-use`, `@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp` |

Press **一键安装** on the card; the page installs that card's packages and refreshes. Then save the card and restart Desktop — a provider never takes over a session that is already live, so **start a new session after restarting**.

The install goes through the profile owner (`dsh plugin --profile web add`), which needs a working pnpm in the profile. A profile installed by one pnpm major and re-opened by another fails with `ERR_PNPM_UNEXPECTED_STORE`; pin `packageManager` in the profile's `package.json` to the major that created `node_modules`.

Computer Use default is **Cua MCP** (`cua-driver mcp`). The card writes the resolved **absolute path** to `cua-driver` — the official installer drops it in `~/.local/bin`, which a DSH host's PATH does not carry, so a bare command would fail to spawn.

Why MCP over Native: Native depends on `@trycua/cua-driver` in-process and TCC attaches to whatever app launched DSH. If that app is adhoc-signed (as DSH-Desktop is), macOS cannot pin its identity and the grants do not stick. The MCP route runs a separately signed `CuaDriver.app` (Developer ID) that holds the permissions instead.

```sh
curl -fsSL https://cua.ai/driver/install.sh -o /tmp/cua-install.sh
CUA_DRIVER_RS_TELEMETRY_ENABLED=0 /bin/bash /tmp/cua-install.sh --no-modify-path
cua-driver telemetry disable
cua-driver permissions grant   # prompts; grants Accessibility + Screen Recording
```

Native runs in-process and needs a confirmation. macOS TCC panes: `scripts/macos-computer-use-permissions.sh` (opens System Settings; does not write TCC.db).

The status endpoint also checks the registered Cua MCP provider through the Host tool pipeline using `list_windows`. This read-only probe does not capture images or send application input. Polls share one request and cache the result for five seconds. `driver.toolchain` reports the actual call state; a live plugin/daemon with a failed MCP call is shown as failed instead of healthy. The driver permission probe uses the configured executable.

With `dsh-cua-pip` v8 installed, the Host owns per-conversation Cua session labels and preflights lifecycle readiness before application calls. The settings probe uses that same pipeline, not a separately spawned CLI connection. No driver restart or TCC reset is needed for idle-session recovery.

The plugin itself never runs npm at request time beyond that one install endpoint, never restarts the host, and never sends application input.
