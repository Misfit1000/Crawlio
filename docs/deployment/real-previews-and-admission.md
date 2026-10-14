# Real Previews and Atomic Admission

Release contracts remain API schema 16 and audit processing version 2.

## Rollout

1. Apply `037_audit_preview_and_admission.sql` before deploying the application.
2. Deploy `src/workers/site-preview` with its Browser Run binding and SQLite Durable Object.
3. Configure its encrypted `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PREVIEW_PROXY_URL`, and `PREVIEW_CONTROL_SECRET` values. Keep `SITE_PREVIEW_ENABLED=false` until the production resource proxy is available.
4. Configure Vercel Production with `SITE_PREVIEWS_ENABLED`, `SITE_PREVIEW_WORKER_URL`, the matching `PREVIEW_CONTROL_SECRET`, and `OPEN_PAGE_RANK_API_KEY`.
5. Configure Render and Vercel with matching `AUDIT_WORKER_CONTROL_SECRET`; set Vercel's `AUDIT_WORKER_WAKE_URL` to the worker's `/control/wake` endpoint.
6. Release the application and compatible Render worker, then enable the capture worker and verify a controlled public URL.

The secondary audit executor is unchanged by this release. Its optional wake URL and control secret must only be configured after verifying that executor's supported contract.

## Isolation and Budgets

- Preview capture is separate from audit execution. Failures do not change scores or audit outcomes.
- Browser-native HTTP/HTTPS traffic is denied by session guardrails. Intercepted GET resources use the server's DNS-pinned public fetcher, with redirect-by-redirect safety and document robots checks.
- Desktop and mobile have separate anonymous contexts, viewports, and user agents. No cookies or incoming authorization headers are forwarded.
- Each capture has a 20-second deadline, a global single-browser lease, an eight-minute UTC daily budget, a 24-hour reuse window, and seven-day private artifact retention.
- Stored previews remain private. Owners, the original guest session, administrators, and valid share tokens can obtain short-lived signed image URLs.
- The storage admission gate reserves space for two bounded images under 100 MiB. Cleanup removes oldest eligible captures when space is needed.
- An unconfirmed browser shutdown blocks new captures. Check the worker's operational health and Browser Run sessions before manually recovering it; do not disable guards to obtain a screenshot.

## Measurement Rules

Crawlio Site Strength uses only measured audit factors. Open PageRank is a separate native 0-10 external link-authority measurement, not Google PageRank, search traffic, Moz DA, or Ahrefs DR. Hosted subdomains require exact host evidence. Missing data is never converted to zero. Provider-estimated history remains explicitly estimated.

Successful provider evidence is cached for 24 hours. Stale evidence is reused only after a provider error and never past seven days. Source timestamps are not extended by a failed refresh.

## Validation Recorded Locally

- TypeScript passed.
- Production build passed: 80,976 bytes compressed initial JavaScript, 111,035 bytes total CSS; static API dependency graph 984,529 bytes.
- Focused coverage includes transactional duplicate/quota handling, suspension and ownership, private preview access, stale-generation fencing, global capture budget, isolated mobile/desktop capture, protected resource transport, capture deadlines, completion recovery, provider parsing/cache expiry, hosted-domain coverage, and strength scope isolation.
- Build sizes are not field loading times. CDN version-response timing is not audit admission or origin execution latency.

## Rollback

Disable `SITE_PREVIEWS_ENABLED` and the capture worker's `SITE_PREVIEW_ENABLED` before reverting the application. Existing audit RPCs and reports are retained. Do not remove the additive tables while admitted work or private artifacts remain in use.
