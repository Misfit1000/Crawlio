# Crawlio secondary executor

This worker consumes the existing Supabase durable audit queue. Render remains
the primary executor. Both use `scalable-item-analysis.ts`, the production check
registry, incremental scoring, and `scalable-report.ts`.

## Deployment

1. Apply `supabase/migrations/036_secondary_executor.sql` after migrations 034/035.
2. From this directory, run `npm ci` and authenticate Wrangler with a scoped
   Cloudflare deployment token (Workers Scripts Write and Account Settings Read).
3. Run `npx wrangler deploy`. The checked-in configuration is disabled by default.
4. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a random
   `EXECUTOR_CONTROL_SECRET` using `wrangler secret put` or `wrangler secret bulk`.
   Never store these values in Git or browser application code.
5. Enable with `npx wrangler deploy --var EXECUTOR_ENABLED:true --var GIT_COMMIT_SHA:<commit>`.
6. Verify `/health`, then POST `/control/wake` with the control secret as a Bearer
   token. Verify `/control/status` and the server-only `audit_executor_health` row.

## Operational limits

- Uses one SQLite Durable Object on Workers Free, not a long-running ordinary
  Worker request. No paid-plan activation is required.
- At most four documents or twenty seconds per slice, one target request at a
  time, and forty total outbound subrequests including database/DNS operations.
- Durable generations reject expired writers. Atomic commits preserve evidence
  across retries and Render/Cloudflare handoff. Target-host exclusion uses the
  same database claim lock as Render.
- Active work resumes after four seconds; idle checks run every thirty seconds.
  A one-minute cron wakes the singleton after eviction or deployment. Temporary
  failures back off to five minutes.
- Public endpoints: GET `/health` and `/capability`. Authenticated controls:
  GET `/control/status`; POST `/control/wake`, `/control/pause`, `/control/resume`.
- No public direct crawl, claim-only endpoint, SSE proxy, or arbitrary webhook.
  The prototype diagnostic modules are not production endpoints.

`/health` reports configuration and engine compatibility, not proof that a
specific audit completed. Use authenticated status and persisted evidence for
execution verification. A health request does not claim work.

## Network boundary

The Cloudflare transport validates both DNS families, rejects private/reserved
addresses, validates every redirect, and bounds response sizes and deadlines.
There are no VPC or private-network bindings. Workers `fetch` resolves the host
again, so this is not Render's DNS-pinned socket transport. Do not claim identical
network behavior, field-performance measurements, or guaranteed throughput.

Free-tier CPU, memory, daily duration and request quotas still apply. Resource
failures leave the SQL lease recoverable; larger audits may finish on Render.
Pause through `/control/pause` or redeploy with `EXECUTOR_ENABLED:false` to stop
new slices without deleting queued audits or evidence.

## Focused checks

From the repository root:

```sh
npm run smoke:secondary-executor
npm run smoke:cloudflare-fetch
npm run smoke:cloudflare-queue
npx tsx --test src/lib/audit/scalable-item-analysis.test.ts
```

The nested TypeScript project keeps Cloudflare globals out of the website build.
