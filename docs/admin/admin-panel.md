# Crawlio Admin Panel

Admin routes live under `/admin`:

- `/admin`
- `/admin/users`
- `/admin/audits`
- `/admin/queue`
- `/admin/workers`
- `/admin/settings`
- `/admin/plans`

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

- Search users by email.
- Change role: `user`, `support`, `admin`.
- Change plan: `free`, `paid`, `agency`, `admin`.
- Change subscription status.
- Reset quotas.

All user changes are logged in `admin_actions`.

## Manage Audits

Admins can:

- View latest audits.
- Filter visually by status, plan, mode, user, and error.
- Cancel queued/running audits.
- Retry failed audits.
- Recover stale locked audits.
- Raise or lower queue priority.

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

## Plans

The plans page edits `plan_limits`:

- daily/monthly quotas
- page limits
- allowed modes
- priority
- export/PDF/white-label/embed/API flags

Run every migration through `019_finding_workflow_and_operations.sql` before using the complete panel.
