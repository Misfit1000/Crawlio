# Resource-Light Audit Architecture

SEOIntel is a lightweight SEO, performance, crawlability, reporting, and passive security audit platform. It does not use AI or paid SEO APIs for audit data.

## Runtime Split

- Vercel handles the frontend, dashboard UI, landing page, report pages, and lightweight job APIs.
- Supabase/Postgres stores audit jobs, live events, crawled page summaries, issues, final reports, and user/project data.
- Supabase Realtime powers live audit updates in the browser over WebSocket.
- A separate Node audit worker handles crawling, checks, progress writes, and report generation.

Vercel API routes create, read, cancel, and export jobs only. They must not run long multi-page crawls.

## Supabase Data Model

- `audits` stores job status, normalized URL details, mode, progress, current phase/check/page, counts, lease fields, timestamps, and errors.
- `audit_events` stores compact live timeline events.
- `audit_pages` stores crawled page summaries only.
- `audit_issues` stores issue summaries and remediation guidance.
- `audit_reports` stores scores, summary, top issues, page summaries, export metadata, and generation time.

Raw full HTML is never stored.

## Audit Modes

- Quick Audit is the default: 10 pages, concurrency 2, 6 second fetch timeout.
- Standard Audit: 25 pages, concurrency 3, 8 second fetch timeout.
- Deep Audit: 50 pages, concurrency 3, 10 second fetch timeout. Users must choose it manually and see a warning that deep audits may take longer and use more resources.

## Limits

- Maximum 300 events per audit.
- Maximum 10 pages for Quick, 25 for Standard, and 50 for Deep.
- Maximum 1,000 issues per audit.
- `expires_at` is set on audit jobs so old data can be cleaned up.

## URL Handling

Inputs such as `example.com`, `www.example.com`, `https://example.com`, `http://example.com`, and paths are normalized server-side and client-side. Domain-only input defaults to HTTPS. Invalid schemes, empty input, malformed URLs, localhost, and private IP targets are rejected in production.

If HTTPS fails, the worker may try HTTP once, records `usedHttpFallback`, and writes an issue titled `HTTPS failed or unavailable`.

## Worker Behavior

The worker polls every few seconds, claims queued jobs with Supabase lease fields, writes `running`, crawls same-domain HTML pages only, checks cancellation before each page/check, and keeps partial results when cancelled.

The crawler uses fetch with `AbortController`, robots.txt rules, limited sitemap discovery, `cheerio` parsing, and a small concurrency queue. It does not use Playwright, Puppeteer, Lighthouse, browser rendering, external broken-link crawling by default, port scanning, exploit testing, credential testing, or admin/private crawling.

## Progress And Live UI

Progress is work-based:

- queued/started: 0-5%
- URL validation/final URL: 5-10%
- robots/sitemap: 10-20%
- crawling pages: 20-55%
- SEO checks: 55-75%
- security checks: 75-90%
- scoring/report: 90-100%

The frontend listens to Supabase Realtime WebSocket updates for the audit row plus latest events, pages, issues, and final report. The live client shows the current connection state and falls back to lightweight status polling when Supabase browser env vars are absent or the Realtime channel fails.

The live page shows the submitted input, normalized URL, final URL, hostname, mode, status, current phase, current URL, current check, pages crawled/page limit, issues found, elapsed time, live pages, live issues, timeline, WebSocket/polling status, the current worker action, and a Stop Audit button.

## Reports And Exports

JSON, pages CSV, and issues CSV exports read from stored Supabase report/page/issue data. Exports never rerun an audit.

## Cleanup

`scripts/cleanup-old-audits.mjs` deletes expired audit rows for jobs whose `expires_at` is in the past. Related events, pages, issues, and reports are deleted by cascade. Production deployments should schedule this script outside Vercel request handling.

## Competitor Gap Future Work

The legacy competitor-gap API crawler is disabled in Vercel routes. It should return as a queued worker-backed job that:

- creates a lightweight `competitor-gap` job row,
- limits crawls per domain by mode,
- stores extracted page/topic summaries only,
- writes progress to Supabase event rows,
- never stores raw HTML,
- compares imported or crawled content terms without inventing rankings, traffic, backlinks, authority, or search volume.
