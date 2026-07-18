# Database Migration Deployment

Apply migrations in numeric order. Existing production migrations must not be edited or reordered.

For the audit-resilience release:

1. Apply `supabase/migrations/010_audit_resilience_and_failures.sql` in the database SQL editor.
2. Confirm the new audit status constraint accepts `completed_with_warnings`.
3. Confirm audit/page/issue resilience columns and indexes exist.
4. Confirm `audit_diagnostics` has RLS enabled and no anonymous or authenticated policies.
5. Deploy the API/frontend build.
6. Deploy the matching audit engine build separately.
7. Check the engine health endpoint and run one audit that contains a known broken link.
8. Confirm the report completes with warnings, shows the exact failure type, and the engine remains online.

The repository includes temporary write fallbacks for a rolling deployment, but the migration must be applied before relying on warning metadata. Do not expose service-role credentials to the browser.

## Current migration head

Apply every migration in numeric order from `001_resource_light_audit.sql` through `020_admin_control_center.sql`. Migrations 001-019 are published history and must not be edited. Migration 020 is additive and keeps audit API schema 13 because it does not change the audit-engine contract.

For migration 020:

1. Record the production release commit and create a Supabase-supported backup or restore point.
2. Apply the complete `020_admin_control_center.sql` file in the Supabase SQL Editor or normal CLI migration pipeline.
3. Run the verification queries at the bottom of the migration.
4. Confirm RLS is enabled on `admin_user_notes`, `account_deletion_requests`, and `admin_operation_previews`, with no anon or authenticated browser policies.
5. Confirm `admin_resource_inventory()`, `admin_operations_timeseries(24)`, `admin_user_plan_distribution()`, and `admin_bulk_audit_operation(...)` execute only through the service role.
6. Deploy the same validated commit to Vercel and Render. The worker contract remains API schema 13.
7. Open Admin > Resources and confirm database and worker versions, table inventory, and service readiness.
8. Open Admin > Users and verify the self/last-admin protections plus durable failed-deletion visibility without suspending the production owner account.
9. Run the read-only production smoke before creating any retention preview.
10. Do not apply retention until its preview counts have been reviewed and a current backup is available.

For migration 019:

1. Record the production release commit and create a Supabase-supported backup or restore point.
2. Apply the complete migration in the Supabase SQL Editor or normal CLI migration pipeline.
3. Run the verification queries at the bottom of the file.
4. Confirm RLS is enabled on both new tables; `operations_alert_state` must have no browser policies.
5. Confirm an authenticated audit owner can persist one finding status, note, and due date, while another account and a guest cannot.
6. Deploy the frontend/API and audit engine from the same commit.
7. Open Admin > Diagnostics and confirm database schema 13, matching commits, and a healthy engine heartbeat.
8. Run `npm run smoke:production` without audit creation, then optionally run one configured Quick Audit.

The API keeps audit admission compatible with schema 12 during this additive rollout window, but finding synchronization remains unavailable until migration 019 is applied. Do not leave production in that transitional state.

## Production robustness release

Apply `supabase/migrations/011_production_robustness.sql` after 010 and before deploying the matching API/audit engine.

1. Create a database backup and record the current migration head.
2. Apply migration 011 in the Supabase SQL editor.
3. Run its verification queries for deployment ledger, RPC functions, and RLS.
4. Confirm the database row reports API schema version 11.
5. Set `RATE_LIMIT_HASH_SECRET` and queue-limit environment variables on Vercel only.
6. Deploy the frontend/API, then deploy the matching Render audit engine commit.
7. Open Admin Diagnostics and confirm database/API/engine/scoring/check-registry compatibility.
8. Run the manual production smoke and one controlled audit.
9. Preview retention cleanup before scheduling apply mode.

If rollback is required, disable audit admission, revert application and engine callers, and follow `docs/production/backups-and-restore.md`. Never rewrite migrations 001-010. Oracle and Stripe work remains postponed.
