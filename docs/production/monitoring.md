# Production Monitoring

Monitor only supported health and diagnostic surfaces:

- application contract: `https://keywordsintel.vercel.app/api/version`;
- audit engine: `https://seointel-audit-worker.onrender.com/health`;
- protected Admin Diagnostics for queue, failures, stale leases, request IDs, and compatibility.

Never use the homepage or audit-start route as an uptime ping. Never create audits from a recurring uptime monitor.

Admin Diagnostics calculates a bounded 24-hour operational summary with `healthy`, `degraded`, `critical`, or `unknown` status. It shows application/engine commits, API/database schema versions, engine/scoring versions, heartbeat age, active workers, queue depth and age, running jobs, stale leases, recent completion rate, median duration, safe failure categories, HTTP fallback count, Deep availability, and current public plan limits.

Alert on prolonged queue age, stale leases, queue polling errors, database disconnects, compatibility mismatch, elevated failed/abandoned jobs, repeated 429/503 responses, and page-failure spikes by stable code. Zero recent activity is not an error.

Optional webhook alerts are disabled by default. When enabled on Vercel, they send aggregate status only, use `operations_alert_state` for fingerprint/cooldown deduplication, and never include customer URLs, page content, account email, stack traces, keys, hashes, or connection strings. Production-smoke failures can use the same webhook secret from the GitHub production environment. Database storage and Realtime quota totals remain provider-dashboard metrics and must be labelled unavailable when not retrieved.

Optional Sentry error monitoring is also disabled until DSNs are configured. It separates browser, Vercel API, and audit-worker events with runtime/service tags, reports only unexpected application failures, and applies centralized privacy scrubbing. Admin Diagnostics shows configuration state and exposes one rate-limited administrator test action. See `docs/operations/sentry.md`; do not replace health checks with recurring Sentry test events.
