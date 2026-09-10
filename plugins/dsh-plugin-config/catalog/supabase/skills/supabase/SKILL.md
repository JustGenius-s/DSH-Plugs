---
name: supabase
description: Use when doing ANY task involving Supabase — Database, Auth, Edge Functions, Storage, Realtime, supabase-js, RLS, migrations, or MCP tools from the Supabase agent pack.
---

# Supabase

## Principles

1. **Verify against current docs** before implementing. Supabase APIs and CLI change often.
2. **Prefer MCP tools** from this pack (`mcp__supabase__*`) for schema inspection, SQL, and advisors when they are available.
3. **RLS by default** on every table in exposed schemas (`public` included). Pair with explicit `GRANT` when Data API access is required.
4. **Never put `service_role` in browsers.** Use publishable / anon keys on the client.
5. **Do not use `user_metadata` for authorization.** Prefer `app_metadata` / `raw_app_meta_data`.

## Workflow

1. MCP is org-scoped after browser OAuth. Pick the project with list/project tools.
2. Inspect schema with list/migration tools before writing SQL.
3. For local/imperative schema changes, iterate with execute SQL; generate a migration only when the change is ready.
4. After security-sensitive changes, run advisors / review RLS policies (`TO authenticated` + ownership predicates; UPDATE needs both `USING` and `WITH CHECK`).

## Safety

- Keep tool approval enabled for destructive SQL.
- Prefer staging / branch databases over production.
- If a tool returns auth errors, ask the user to reconnect OAuth in **Settings → Plugins → Agent packs**.
