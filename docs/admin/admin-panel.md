# Crawlio Admin Panel

Admin routes live under `/admin`:

- `/admin`
- `/admin/users`
- `/admin/audits`
- `/admin/queue`
- `/admin/workers`
- `/admin/content-health`
- `/admin/resources`
- `/admin/activity`
- `/admin/diagnostics`
- `/admin/settings`
- `/admin/plans`
- `/admin/blog`

## Assign Admin

Set this server-side env var on Vercel:

```bash
ADMIN_EMAILS=owner@example.com,ops@example.com
```

When one of those users signs in, the server-side profile bootstrap sets:

- `role=admin`
- `plan=admin`
- `subscription_status=active`

Do not expose `ADMIN_EMAILS` to browser code.

## Manage Users

Admins can:

- Search and paginate users by email, name, username, role, plan, and status.
- Open an account drawer with quota use, projects, recent audits, notes, and deletion status.
- Change role: `user`, `support`, `admin`.
- Change plan: `free`, `paid`, `agency`, `admin`.
- Change subscription status.
- Reset quotas.
- Suspend or restore an account with a Supabase Auth ban and restrictive RLS enforcement.
- Process only a durable deletion request created by the user.
- Retry a failed self-service deletion even when its profile row was already removed.

Administrators cannot suspend or demote themselves, and the last active administrator cannot be removed. The final-admin invariant is also enforced transactionally in Postgres. All changes require a recorded reason and are logged in `admin_actions`.

## Manage Audits

Admins can:

- View latest audits.
- Filter visually by status, plan, mode, user, and error.
- Cancel queued/running audits.
- Retry failed audits.
- Recover stale locked audits.
- Raise or lower queue priority.
- Select up to 25 explicit audit IDs for a guarded bulk action.
- Save filters and export bounded CSV data.

Bulk state validation and updates run in one locked database transaction, so a worker completion cannot be overwritten between validation and update.

Pagination totals are query-planner estimates rather than full-table counts. Cursor pagination remains authoritative; the estimate is display-only.

## Inspect Queue

The queue page shows queued/running audits ordered by:

1. Highest `queue_priority`.
2. Oldest `created_at`.

## Inspect Workers

The workers page reads `platform_settings` rows keyed as `audit_worker:*` and shows:

- workerId
- status
- lastSeenAt
- currentAuditId
- runtime
- supported modes
- stale/sleeping warning

## Production Diagnostics

The diagnostics page combines bounded recent audit rows, heartbeats, deployment contracts, plan limits, safe API errors, and stable failure categories. It does not scan the full audit history or expose credentials, private infrastructure, page content, or user email addresses. Status reasons explain queue age, stale leases, heartbeat loss, completion-rate degradation, commit mismatch, and pending schema migration.

If no heartbeat exists, deploy the Render Web Service worker and verify `https://seointel-audit-worker.onrender.com/health`. Uptime monitors must ping only that worker health URL; do not ping the Crawlio homepage or audit start routes such as `/api/tools/audit/start`.

## Settings

Safe settings include:

- platform name
- support email
- queue fairness paid burst
- guest audit enabled

Secrets are never displayed or editable in the admin panel.

## Content Health

Content Health reports drafts waiting for review, overdue schedules, stalled or failed generation jobs, missing SEO fields, publication-gate failures, stale articles, and source or image review requirements. It links to the existing editor and can hold publication, recover eligible jobs, or rerun deterministic checks. It never claims indexing, rankings, traffic, or search performance.

## Resources and Retention

The Resources page shows:

- allowlisted table size and approximate row counts
- oldest records, retention policy, and cleanup eligibility
- service configuration as configured/not configured only
- application, database, and audit-engine versions
- optional allowlisted HTTPS links for Supabase, Vercel, Render, Sentry, and GitHub

Supabase billing, storage quota, Realtime quota, and Vercel usage remain provider-dashboard-only. Retention is a two-step action: create a preview, then apply the same fingerprint within ten minutes using a reason and the exact confirmation `APPLY RETENTION`.

Database readiness compares the stored audit API schema to the application contract. Application and audit-engine deployments compare Git commit identifiers. Resource links reject credentials and credential-like query parameters even on allowlisted provider hosts.

Read-heavy administrator snapshots use private in-process caching: 10 seconds for operations and worker health, 30 seconds for content health, and 60 seconds for plans, settings, and resource inventory. Concurrent identical reads share one request. Responses remain `private, no-store`, and successful mutations invalidate the affected cache immediately.

## Activity History

The Activity page searches administrator actions and displays bounded before/after summaries. CSV exports escape spreadsheet formulas and do not contain provider credentials, raw IP addresses, tokens, or environment values.

## Plans

The plans page edits `plan_limits`:

- daily/monthly quotas
- page limits
- allowed modes
- priority
- export/PDF/white-label/embed/API flags

Run every migration through `020_admin_control_center.sql` before using Control Center V2.
