# Supabase Setup

## Project

1. Create a Supabase project.
2. Copy the project URL and anon key for the frontend.
3. Copy the service role key for the API and worker only.
4. Apply every SQL file in `supabase/migrations/` in numeric order through `019_finding_workflow_and_operations.sql`. Never rewrite an applied migration.

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

Run the migrations through the Supabase dashboard SQL editor, the Supabase CLI, or your deployment pipeline. Do not skip later numbered migrations on an existing project.

The migration creates:

- `audits`
- `audit_events`
- `audit_pages`
- `audit_issues`
- `audit_reports`
- `audit_finding_workflow`
- service-only operational state and deployment records

It also enables RLS, adds Realtime publication entries, and creates indexes for queue claiming, live timelines, pages, issues, and cleanup.

Migration 019 permits authenticated owners to manage workflow only for their own signed-in audits. Guests retain a device-only fallback and cannot write shared workflow rows. `operations_alert_state` has RLS and no browser policy.

## Runtime Contract

- Vercel API routes create/cancel/read/export audit jobs.
- The separate Node worker claims queued jobs and writes progress/results using `SUPABASE_SERVICE_ROLE_KEY`.
- Authenticated owners use `VITE_SUPABASE_ANON_KEY` for owner-scoped Realtime subscriptions.
- Guest audits use the same live interface with identity-protected API polling. Anonymous clients cannot select every guest audit row directly.
- Long crawls never run inside Vercel request handling.
- After deploying a Vercel preview and the worker, run a Quick Audit with `example.com` to verify queued status, live updates, final report, exports, and cancellation.

## Local Tests

If Supabase env vars are unset, smoke and local e2e tests use an in-memory repository fallback and print:

```text
Running local in-memory E2E mode - not production Supabase.
```

This mode verifies API/worker behavior without touching production data.
