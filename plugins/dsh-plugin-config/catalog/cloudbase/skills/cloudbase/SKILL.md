---
name: cloudbase
description: Use when working with Tencent CloudBase / 云开发 — env setup, database, cloud functions, hosting, storage, or CloudBase MCP tools.
---

# Tencent CloudBase

## Principles

1. Confirm `ENV_ID` before mutating anything in an environment.
2. Prefer MCP tools (`mcp__cloudbase__*`) when the pack is enabled and authenticated.
3. **Never embed SecretId / SecretKey in frontend code or git.** Configure them in **Settings → Plugins → Agent packs**.
4. Prefer least-privilege keys; rotate if leaked.

## Workflow

1. Verify the pack is installed, secrets are set, and status is connected.
2. Inspect the target env / resources before write operations.
3. Deploy or mutate one concern at a time; re-check with list/status tools.

## Safety

- Treat production env ids carefully; prefer a dedicated AI/dev env.
- Keep tool approval on for destructive operations.
- On 401 / auth errors, re-enter SecretId / SecretKey in the plugin manager.
