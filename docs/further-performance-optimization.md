# Further performance optimization

## Local production build comparison

Same local build configuration, without Sentry source-map instrumentation:

| Measurement | Previous | Current | Reduction |
| --- | ---: | ---: | ---: |
| Initial compressed JavaScript | 90,012 B | 88,334 B | 1.9% |
| Initial CSS | 106,837 B | 97,349 B | 8.9% |
| Static API shell dependency graph | 1,329,324 B | 981,575 B | 26.2% |

The 5% JavaScript and 10% CSS stretch targets were not reached. Total CSS is
114,874 B, within the existing 115,000 B budget. The core route dependency graph
is 1,472,333 B; the shell reduction does not imply an equivalent reduction in every
route or a measured cold-start improvement.

## Behavior and resource changes

- Workspace, report, blog and administrator styles load with their route modules.
- Database-backed API error persistence loads only on an error. Sentry capture and
  privacy filtering remain enabled.
- Authentication and profile verification are reused only within the same request.
  Subsequent requests revalidate authorization and suspension.
- Terminal exports under 100 pages, 1,000 findings and 300 events read complete
  cursor-paginated evidence without export-job or artifact writes. A two-megabyte
  or four-second preparation bound transfers work to the existing private job.
- Export preparation is shared by exact account headers, with independent consumer
  cancellation and persistent ready/failure/retry feedback.
- Migration 035 adds service-only claim, commit and quiet lease RPCs. Prior RPCs
  remain available for rollback. The migration was applied in Supabase before the
  compatible worker commit `8a7984c` was deployed.
- Concurrent page pairs share an atomic evidence commit except at score boundaries.
  The claim hydrates scoring groups once; authoritative commit deltas update the
  cache. Canonical final scoring still rereads persisted aggregates.
- Quiet lease renewal does not change the public audit row or emit progress.
  Pending-frontier state comes back with commits, removing a separate slice-end read.
- HTML extraction is scope-aware; audited pages do not compute unused keyword
  n-grams. Unperformed evidence remains absent, not fabricated passing values.
- Compact live status omits checkpoints and private ownership fields. Internal
  evidence updates are immediate; visible Realtime updates coalesce per animation
  frame, with terminal updates flushed immediately.

## Focused verification

TypeScript and the production build passed. Targeted tests cover complete exports,
export preparation bounds and account isolation, scope/check parity, ownership,
subscription startup, visual emission, lease renewal, atomic retries, restart score
parity, and privileged RPC execution. Browser checks cover startup feedback, lazy
loading, direct report views, preserved filters, page drawers, theme contrast,
responsive widths, keyboard controls, and hidden/offscreen animation.

API schema 16 and processing version 2 are unchanged. Visible polling remains two
seconds; admission polling, host concurrency, quotas and heartbeat cadence are
unchanged. No test article was published or paid service added.

## Measurement limits

Browser observations in `artifacts/further-performance` separate fresh/repeat
requests, transferred bytes and CDN headers. They are unthrottled lab samples, not
field Core Web Vitals or counts of origin execution. Initial healthy visits made
four browser requests and no API requests before release. Pricing is measured on
the standalone pricing page, not the former homepage pricing section.

Before-release `/api/tools/version` HTTP samples were 894, 391 and 372 ms. These
include network time and are not proof of a cold or warm function invocation.
Production throughput, per-page database bytes and worker memory under sustained
load cannot be inferred from build sizes or a single small verification audit.
