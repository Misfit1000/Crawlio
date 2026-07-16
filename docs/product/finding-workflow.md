# Finding Workflow Persistence

Audit findings remain immutable evidence. Mutable status, notes, optional due date, priority override, resolution metadata, updater, timestamps, and optimistic version live in `audit_finding_workflow` from migration 019.

The stable key uses the worker-supplied `finding_key`; older evidence falls back to a deterministic category/title/affected-URL fingerprint. It never uses list position.

Authenticated owners read and update workflow through bounded Vercel APIs. The server verifies the session, audit ownership, finding existence, status, lengths, due date, and expected version. Supabase RLS independently enforces the same audit-owner relationship. Admin access follows the existing server-verified role. Guests cannot write persistent rows.

The report updates optimistically and rolls back on API failure or a version conflict. Realtime listens only to the active audit's workflow rows. Legacy device status/notes are validated, capped, matched against accessible findings, and migrated only after the owner API succeeds. Device keys are removed only after all writes succeed; a failure leaves them available for retry. Temporary filters, sort order, expanded rows, and drawer state remain client-only.
