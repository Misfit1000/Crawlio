# Evidence-First Low-Cost Audit Tools

## Release Scope

- Public and workspace SEO tools provide local metadata previews, structured-data templates, guarded header guidance and a shared standards-aware robots sandbox.
- Report tools reuse retained evidence for crawl-clutter/depth analysis, scoped sitemaps, an executive print summary and explicitly authorized score badges. Page drawers expose selected-page previews.
- Unknown evidence remains unknown. Loaded samples are labelled, final canonical scores are reused, and no rankings, incoming-link graph or indexing guarantees are fabricated.
- `/tools` includes crawlable initial HTML, canonical metadata and a sitemap entry. Tool modules remain lazy-loaded.

## Database and Rollout

`031_low_cost_tools.sql` executed successfully in the production Supabase SQL Editor on October 2. It adds bounded page evidence, a private robots-document table and the sitemap export format. Existing ownership RLS, server-only credentials, worker leases and audit contract version 15 remain unchanged. No records were deleted.

Deploy the matching worker and application after this migration. Existing audits remain readable; fresh audits collect the additional facts. Historical audits without retained facts support paste mode and clearly scoped results rather than new target requests.

## Resource Boundaries

- Page facts are capped at 4,096 serialized bytes and included in existing page writes. Full HTML, credentials and arbitrary headers are not retained.
- Robots evidence is bounded and stored once during initialization, separate from hot crawl metadata; retrieval is explicit and authorized.
- Tool editing makes zero additional API calls, database writes or crawler requests in the focused browser journey.
- Local evidence is capped at 100 rows. Complete sitemap exports use resumable 50-row worker chunks and private 24-hour artifacts.
- Score badges require owner opt-in and an active public-report permission. SVG requests perform bounded authorization/score reads and use no-store caching for immediate revocation; they are not zero-cost CDN assets.

## Focused Verification

TypeScript, the production build and browser-asset secret/source-map verification passed. Seventy-four focused parser, evidence, serialization, ownership, badge, migration and resumable-export tests passed; three evidence tests were rerun after tightening serialized-byte bounds. The existing local Quick/Standard/Deep audit and cancellation/error smoke passed.

Public tools were checked at 390, 768 and 1,440 pixels in both themes, including keyboard tabs, local editing and no additional target/API requests. The report journey checked lazy robots retrieval, audited-value reset, scoped download, isolated print output and share revocation. Unrelated suites were not rerun.

## Build Measurements

| Measure | Previous release | This release |
| --- | ---: | ---: |
| Initial homepage gzip JavaScript | 98,327 bytes | 98,766 bytes |
| Base CSS | 105,598 bytes | 106,227 bytes |
| Total CSS including lazy tools | 105,598 bytes | 111,659 bytes |
| Initial static server dependencies | 1,328,712 bytes | 1,328,812 bytes |
| Stable API entry | 2,852 bytes | 2,852 bytes |

Homepage JavaScript increased 439 bytes (0.45%) for navigation/routing; it did not meet a literal no-increase goal. The tool/editor/Supabase modules remain outside the healthy homepage dependency path. Total CSS exceeds the original 111,314-byte baseline by 345 bytes, while remaining within the current 112,000-byte build budget. These are build measurements, not field LCP/INP or production database benchmarks.

## Remaining Work

- The separate real AI-blog save failure caused by duplicate link identities still needs an idempotent link-sync fix. This release does not claim that publishing is fully repaired or bypass editorial gates.
- Real-world audit completion and accuracy need ongoing measurement across permitted sites. No new 500/5,000-page throughput, production latency or field performance benchmark was performed here.
- Production application and worker versions must be checked against the released commit before calling this live.
