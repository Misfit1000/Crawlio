# Scalable audit rollout

Processing version 2 is opt-in. Shipping this commit does not enable increased
allowances by itself. Existing customer allowances are preserved. The new ceiling
is 500 customer pages and 5,000 administrator pages; the admin default is 1,000.

## Deployment order

1. Back up the database and confirm migrations through 024 are applied.
2. Apply `supabase/migrations/025_scalable_audits.sql` as a database administrator.
3. Deploy this commit to the Render worker. Set `SCALABLE_AUDITS_ENABLED=true` on
   that worker. Keep `DEEP_AUDIT_ENABLED` aligned with the supported modes.
4. Verify worker heartbeat freshness and its entry in `audit_scalable_workers`.
   Drain legacy workers before enabling v2 admission: host coordination covers
   v2 workers, not an older binary's independent HTTP requests.
5. Deploy the same commit to Vercel. Set `SCALABLE_AUDITS_ENABLED=true` only after
   worker verification. The API also checks a compatible heartbeat within 90 seconds.
6. Run a small controlled audit, verify its final score, evidence pagination,
   comparison and complete export. Then raise customer allowances deliberately.

Use `AUDIT_WORKER_RSS_LIMIT_MB` to set the worker's memory-pressure threshold
(default 384 MiB). A pressured worker checkpoints and yields; this is not a claim
that a particular hosting plan can complete 5,000 pages within a fixed time.

## Validation

- `npm run lint`
- `npm run smoke:scalable-audits`
- `npm run smoke:audit-scoring`
- `npm run e2e:critical`
- `npm run build`

The local PostgreSQL fixture covers migration execution, 500/1,000/5,000 retained
pages and findings, replay idempotence, expired-lease generation rejection,
slice resumption, cancellation, finalization, comparison totals and privileges.
It is not a benchmark of live HTTP throughput or production database latency.
Peak worker memory, real-network retries, multi-process crash recovery and live
deployment compatibility still require controlled deployment verification.

Evidence requests are bounded to 100 rows; reports and PDFs contain labeled
samples. JSON and CSV exports read all retained evidence in resumable 50-row
chunks and remain private. Downloads expire after 24 hours. Cleanup is bounded
and may finish later; expired artifacts cannot be downloaded through the API.

## Rollback

Disable `SCALABLE_AUDITS_ENABLED` in Vercel to stop new v2 admission. Keep the
compatible Render worker enabled until already-admitted v2 audits finish.
Do not drop the additive tables, reset processing versions or remove sentinel
locks to force legacy workers to claim v2 jobs. A worker restart resumes from
the durable frontier after its lease expires.
