# Resource Reliability and Useful Reports

API schema 16, audit processing version 2, scoring 2.2, and existing plan allowances are unchanged.

## Deployment Order

1. Apply `038_resource_reliability.sql` and `039_preview_demand_priority.sql`.
2. Deploy the site-preview worker with existing encrypted secrets and `SITE_PREVIEW_ENABLED=true`.
3. Configure Vercel Production `SECONDARY_AUDIT_WORKER_URL` and `SECONDARY_AUDIT_CONTROL_SECRET` using the existing compatible Cloudflare executor, not the screenshot worker.
4. Deploy the compatible secondary executor from `src/workers/cloudflare-audit` with `EXECUTOR_ENABLED=true` and the release commit. Render and Cloudflare share the same item analysis, parsing and report helpers; transport and runtime controls remain isolated.
5. Release the application through `main`; verify the public version, private Resources view, a small scoped audit, and optional evidence.

Production validation found the assignment column from migration 023 absent. Apply
`040_finding_workflow_assignment.sql` to repair only that dependency without
replaying older schema metadata or retention routines. It preserves existing
workflow rows, owner policies and audit-evidence validation.

## Measurements

- First-page timestamps are set during the existing audit update, without another page-event write. Existing reports are not backfilled with invented timings.
- New accepted jobs record one bounded background launch observation. Retries reopening the same job do not overwrite the initial sample.
- Resources shows sample counts, median and 95th-percentile server preparation, admission, queue, first-page and successful completion timings. Samples cover the latest 5,000 audits within seven days.
- Browser performance entries measure the feedback frame separately. They add no telemetry request and are not labelled field Core Web Vitals.
- Recorded local build after production follow-ups: initial compressed JavaScript 81,125 bytes, total CSS 111,229 bytes, static API shell graph 984,608 bytes. Relative to the previous release: +133 bytes initial JavaScript, +160 bytes CSS, +79 bytes static API graph. These are build sizes, not production loading times.
- The controlled security-only page audit accepted on 2026-10-15 took 0.71 seconds to first claim, 2.47 seconds to its first analysed page, and 4.02 seconds to successful completion. This is one warm production observation, not a comparative speed guarantee.
- Session hydration invalidates reads from older accounts/tokens while retaining already-started reads for the new verified token. Realtime rows retain immutable focus, coverage, plan allowance and first-page timing.

## Free-Provider Guardrails

- Open PageRank refreshes use a database-backed domain lease and fenced completion. Only the owner may persist the result; simultaneous API instances cannot independently refresh the same domain while its lease is active.
- The application conservatively reserves at most 27,000 monthly lookups and 50 per minute, below the currently published Free ceilings of 30,000 and 60. Failed attempts are not refunded because provider consumption cannot always be established.
- Reservations begin with this release, do not include earlier requests or other applications, and are not an exact provider billing meter. A provider can decline earlier. No paid overages are enabled.
- Cache hits do not reserve another lookup. Provider errors, exhausted budgets, or coordination outages never turn unavailable evidence into a measured zero or fail core audits.
- Successful evidence remains fresh for 24 hours; labelled stale evidence is bounded to seven days when refresh cannot complete. Source timestamps are never extended by failure.

## Preview and Maintenance

- Capture still has one browser, a 20-second deadline, an eight-minute UTC daily application budget, 24-hour reuse, seven-day private artifacts, and a 100 MiB ceiling.
- Opening a preview promotes its queued capture. The ten-minute priority boost expires after 30 minutes; older waiting work can age ahead. Legacy and prioritized claims share the same browser lease and budget lock.
- Independent resource maintenance runs from Render's idle scheduler and the preview worker, coordinated to at most every 15 minutes even when no artifacts are selected for deletion. Each pass removes at most 100 expired evidence, refresh-lease, timing, and budget records, plus ten old preview usage days. It never deletes audits, reports, or articles.
- The maintenance and capacity RPCs are service-role-only. Capacity additionally verifies the administrator profile, including suspension state.

## Reports and Quality

- Findings group by check, category, failure and recommended fix, not title alone. Counts deduplicate affected URLs; paginated batches explicitly cover only the loaded evidence page.
- Manual completion is labelled **Marked fixed**. Comparisons show only supplied new, remaining and no-longer-detected evidence; absence alone is not called a verified fix.
- The local accuracy benchmark uses six synthetic scenarios and 20 labelled checks (120 decisions). Its documented precision/recall applies only to that corpus, not the whole web. See `docs/quality/audit-accuracy.md`.
- Render-offline wake behavior is exercised with controlled transports. No live Render service is deliberately stopped as part of validation.
- An authenticated secondary wake advances a pending idle alarm instead of waiting for its original 30-second deadline. An active slice is never overlapped and an earlier alarm is never postponed.

## Rollback

Disable secondary wake variables before rolling back its integration. Keep additive tables and old preview claim RPCs; the previous application and screenshot worker can run against the upgraded database. Optional provider evidence fails closed if coordination is unavailable. Do not remove migrations while dependent releases remain active.
