# Speed, Efficiency, and Usability Release

## Changes

- Immediate, focused audit-launch feedback; one admission request, concurrent screen loading, and reuse of the accepted audit summary.
- Concise homepage with dynamic audit modes, conceptual motion, deferred sample interaction, and viewport-triggered pricing.
- Grouped customer/admin navigation, compact overviews, and demand-mounted report/configuration details.
- Session-scoped in-flight reads with independent consumer cancellation, obsolete-response rejection, and account-change invalidation.
- One audit update path, post-subscription reconciliation, hidden-tab suspension, and terminal shutdown.
- Lazy server route families; existing URLs, authorization, rate limits, exports, and worker contracts retained.
- Explicit history summaries, one bounded frontier-selection RPC, and serialized idle-only worker maintenance.
- Chunked CSV processing and account-isolated import/project state.

## Build Measurements

Complete static dependency graphs, not just the HTML entry script:

| Measurement | Before | After |
| --- | ---: | ---: |
| Initial customer JavaScript, gzip bytes | 98,788 | 90,211 |
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
- Eight selected critical browser journeys passed, including launch, terminal recovery, navigation, keyboard access, homepage accessibility, and deferred homepage loading.
- Registration/access behavior, audit scoring cadence, and terminal protection are preserved.
- SEO/security package checks passed. These checks are not a penetration test.
- Homepage checked at 390, 768, and 1440 pixels in light and Vanta Black themes; agent checks covered compact admin navigation and demand loading.

## Rollout

Migration `033_performance_optimization.sql` was applied to production Supabase before dependent code. It adds a read-only, service-role-only frontier RPC; it does not change audit ownership, claims, evidence, or schema version 15.

Deploy the validated commit through `main`, verify the public API and Render worker commit, then run a small real audit. No preview, paid service, or test article is required.

## Production Observation

`scripts/measure-public-loading.mjs` records fresh/repeat browser requests, resource transfers, lab paint/layout observations, and CDN response headers without signing in or mutating data. Saved observations are under `artifacts/performance-optimization`.

Before release, a fresh unthrottled desktop visit made five browser requests and no initial API request; pricing scrolling made one plan request. Repeat loading used browser caches. Browser requests, CDN hits, and origin executions are different quantities.

Lab samples are not field Core Web Vitals. Origin query/write telemetry, large-audit peak memory, and genuine cold-instance latency require production instrumentation; they are not inferred from transfer sizes or cache headers.
