# Speed, Efficiency, and Usability Release

## Changes

- Immediate, focused audit-launch feedback; one admission request, concurrent screen loading, and reuse of the accepted audit summary.
- Concise homepage with dynamic audit modes, conceptual motion, deferred sample interaction, and viewport-triggered pricing.
- Grouped customer/admin navigation, compact overviews, and demand-mounted report/configuration details.
- Session-scoped in-flight reads with independent consumer cancellation, obsolete-response rejection, and account-change invalidation.
- One audit update path, post-subscription reconciliation, hidden-tab suspension, and terminal shutdown.
- Authenticate Realtime before joining and reconcile bounded final-score/terminal-row ordering gaps without adding a periodic timer to normal preliminary updates.
- Lazy server route families; existing URLs, authorization, rate limits, exports, and worker contracts retained.
- Explicit history summaries, one bounded frontier-selection RPC, and serialized idle-only worker maintenance.
- Chunked CSV processing and account-isolated import/project state.

## Build Measurements

Complete static dependency graphs, not just the HTML entry script:

| Measurement | Before | After |
| --- | ---: | ---: |
| Initial customer JavaScript, gzip bytes | 98,788 | 90,220 |
| Total emitted CSS, bytes | 111,659 | 111,639 |
| Core API static dependency graph, bytes | 4,419,345 | 1,461,887 |
| Shared API shell, bytes | 1,328,812 | 1,329,201 |

Initial JavaScript is 8.7% smaller. The core route graph is 66.9% smaller; this does not mean the entire deployment or shared API shell shrank by that amount.

## Controlled Worker Measurements

- Frontier selection: one RPC instead of one to four sequential repository requests, preserving robots/retry ordering and lease-checked claims.
- Five-minute idle fixture: export checks 75 to 19; cleanup scans 5 to 1. Admission checks remain 75.
- Checkpoint-heavy history fixture: selected row payload 209,402 to 835 bytes; query count remains two.
- These are deterministic fixture results, not production throughput or memory benchmarks.

## Validation

- TypeScript and production build passed; generated Vercel entry/chunk smoke passed.
- Focused admission/request tests, 35 worker tests, and 43 lazy-route/access tests passed.
- Five subscription-startup regression tests cover authentication ordering, cancellation, final evidence reconciliation, delayed active rows, and permanent access errors.
- Eight selected critical browser journeys passed, including launch, terminal recovery, navigation, keyboard access, homepage accessibility, and deferred homepage loading.
- Registration/access behavior, audit scoring cadence, and terminal protection are preserved.
- SEO/security package checks passed. These checks are not a penetration test.
- Homepage checked at 390, 768, and 1440 pixels in light and Vanta Black themes; agent checks covered compact admin navigation and demand loading.

## Rollout

Migration `033_performance_optimization.sql` was applied to production Supabase before dependent code. It adds a read-only, service-role-only frontier RPC; it does not change audit ownership, claims, evidence, or schema version 15.

Production metadata confirms that anon/authenticated cannot execute the frontier RPC, service_role can, and all five audit tables participate in Realtime. Read-only query plans use `audit_crawl_frontier_pending` for bounded frontier selection, `audits_user_created` for history, and `blog_admin_notifications_inbox_idx` for unread notifications. Empty-match frontier/history observations took 1.900 ms and 1.218 ms respectively; these are not large-audit throughput benchmarks. Existing indexes were retained rather than adding duplicates.

Deploy the validated commit through `main`, verify the public API and Render worker commit, then run a small real audit. No preview, paid service, or test article is required.

## Production Observation

`scripts/measure-public-loading.mjs` records fresh/repeat browser requests, resource transfers, lab paint/layout observations, and CDN response headers without signing in or mutating data. Saved observations are under `artifacts/performance-optimization`.

Before release, a fresh unthrottled desktop visit made five browser requests and no initial API request; pricing scrolling made one plan request. Repeat loading used browser caches. Browser requests, CDN hits, and origin executions are different quantities.

The first deployed measurement identified an early sample-report preload (six initial requests). The observer was corrected to load the interaction only when the sample section is visible. The initial code and sample text remain crawlable; no audit startup behavior changed.

Final production measurement, with the same unthrottled desktop procedure:

| Observation | Before | After |
| --- | ---: | ---: |
| Fresh initial browser requests | 5 | 4 |
| Fresh resource transfer, bytes | 123,645 | 114,858 |
| Fresh lab LCP, milliseconds | 3,556 | 3,432 |
| Repeat lab LCP, milliseconds | 108 | 100 |
| Lab CLS | 0 | 0 |
| Initial API requests | 0 | 0 |
| Pricing-scroll plan requests | 1 | 1 |

The healthy homepage requested only its entry and React scripts, not Sentry, Supabase, editor, admin, or sample-report chunks. Initial transfer decreased 7.1%. Timing differences are single network-dependent observations, not statistical performance guarantees. Fresh lab LCP remains above the desired 2.5-second target.

After-deployment read-only API samples: `/version` returned 200 in 288/194/188/231 ms (STALE/STALE/HIT/HIT). An inaccessible audit ID returned 404 in 839/645/648/663 ms, versus the recorded 1,275/1,133/1,035/1,119 ms baseline. These do not establish genuine cold-instance latency or authorization-dependent successful-audit latency.

Both production services were verified on code commit `590c446`, schema 15. A real Quick audit of `example.net` reached Report ready without reloading, retaining one analysed page, score 72/100, 13 findings, correct coverage limits, and a stopped terminal timer. The first `example.org` check exposed the completion-subscription ordering gap; the focused fix and repeat check resolved it. The stored report workspace and compact admin overview were also inspected in production.

Lab samples are not field Core Web Vitals. Origin query/write telemetry, large-audit peak memory, and genuine cold-instance latency require production instrumentation; they are not inferred from transfer sizes or cache headers.
