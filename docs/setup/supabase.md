# Supabase Setup

## Project

1. Create a Supabase project.
2. Copy the project URL and anon key for the frontend.
3. Copy the service role key for the API and worker only.
4. Apply the migration in `supabase/migrations/001_resource_light_audit.sql`.

## Frontend Environment

Set these on Vercel and in local `.env.local` when testing live updates:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

These values are browser-safe. Do not put privileged keys in `VITE_*` variables.

## API And Worker Environment

Set these only in server/worker environments:

```bash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

The service role key can bypass RLS and must never be committed or exposed to the browser.

## Migration

Run the migration through the Supabase dashboard SQL editor, the Supabase CLI, or your deployment pipeline.

The migration creates:

- `audits`
- `audit_events`
- `audit_pages`
- `audit_issues`
- `audit_reports`

It also enables RLS, adds Realtime publication entries, and creates indexes for queue claiming, live timelines, pages, issues, and cleanup.

## Runtime Contract

- Vercel API routes create/cancel/read/export audit jobs.
- The separate Node worker claims queued jobs and writes progress/results using `SUPABASE_SERVICE_ROLE_KEY`.
- The browser uses `VITE_SUPABASE_ANON_KEY` for auth and Realtime subscriptions.
- Long crawls never run inside Vercel request handling.
- After deploying a Vercel preview and the worker, run a Quick Audit with `example.com` to verify queued status, live updates, final report, exports, and cancellation.

## Local Tests

If Supabase env vars are unset, smoke and local e2e tests use an in-memory repository fallback and print:

```text
Running local in-memory E2E mode - not production Supabase.
```

This mode verifies API/worker behavior without touching production data.
