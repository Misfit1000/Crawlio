# Worker Deployment

The audit worker performs crawling, SEO checks, passive security checks, progress writes, and final report generation. It must run outside Vercel serverless functions.

## Local Run

```bash
npm run worker:audit
```

Development watch mode:

```bash
npm run worker:audit:dev
```

## Required Environment

```bash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
AUDIT_WORKER_ID=worker-production-1
AUDIT_POLL_INTERVAL_MS=4000
```

`AUDIT_WORKER_ID` is optional but useful in logs and lock fields. The worker must use the Supabase service role key because it claims jobs and writes progress/results.

## Deployment Targets

Render, Railway, Fly.io, a VPS, or any persistent Node.js process host can run the worker.

Suggested process command:

```bash
npm ci
npm run worker:audit
```

Do not run the worker as a Vercel serverless function. Multi-page crawls can exceed request timeouts and resource limits, and users need progress to continue after the initial API response.

## Logs

Check worker logs for:

- `SEOIntel audit worker started as ...`
- claimed queued audits
- fetch/crawl failures
- Supabase credential or network errors
- uncaught worker crashes

If the live audit page says `Audit is queued. The audit worker has not picked it up yet`, either the worker is not running, it cannot reach Supabase, or its service role environment variable is invalid.

## Concurrency And Limits

Audit settings are centralized in `src/lib/audit/audit-config.ts`.

- Quick: 10 pages, concurrency 2, 6 second timeout.
- Standard: 25 pages, concurrency 3, 8 second timeout.
- Deep: 50 pages, concurrency 3, 10 second timeout.
- Event limit: 300 events.
- Issue limit: 1,000 issues.
- Worker poll interval: 4 seconds by default.

## Cancellation

The cancel API marks an audit as `cancelled` and writes a cancellation event. The worker checks cancellation before pages and major checks, then leaves partial pages/issues/report data in Supabase.

## Stale Lock Recovery

Workers claim jobs with `locked_by`, `locked_at`, and `lease_expires_at`. If a worker dies, another worker can reclaim queued work after the configured lock lease/stale recovery window in `src/lib/audit/audit-config.ts`.
