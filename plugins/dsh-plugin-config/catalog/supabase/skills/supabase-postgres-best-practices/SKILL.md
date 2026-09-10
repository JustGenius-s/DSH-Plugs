---
name: supabase-postgres-best-practices
description: Use when writing, reviewing, or optimizing Postgres queries, schema designs, indexes, connection settings, or RLS patterns on Supabase.
---

# Supabase Postgres best practices

## Schema

- Prefer explicit primary keys and `timestamptz` for timestamps.
- Add indexes that match real filter / join columns; avoid unused indexes.
- Keep foreign keys indexed on the referencing side.

## RLS

- Enable RLS on exposed tables before granting `anon` / `authenticated`.
- Prefer `TO authenticated` / `TO anon` over deprecated `auth.role()` checks.
- Wrap `auth.uid()` in a subquery: `(select auth.uid()) = user_id`.
- UPDATE policies need both `USING` and `WITH CHECK`.

## Queries

- Select only needed columns; avoid `select *` in hot paths.
- Use `explain analyze` for slow queries when available.
- Cap result sets; paginate large tables.

## Connections

- Use the pooler for serverless / edge clients.
- Keep transactions short; avoid holding connections during external IO.
