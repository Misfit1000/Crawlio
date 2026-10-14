# Spacious Crawlio redesign

Local implementation and validation, 14 October 2026. This follows the approved spacious homepage reference and extends its typography, whitespace, controls, and white/cobalt/true-black palette across the application.

## Presentation coverage

| Screens | Changes and review |
| --- | --- |
| Homepage and public audit launchers | Centered working URL form; visible Focus, Coverage, and Depth; conceptual discovery/check/fix scene; labeled sample report; concise capabilities and navigation. Responsive browser checks passed. |
| Dashboard and Projects | Selected website, latest result, next action, schedule, unboxed metrics, and project table. Both themes reviewed at 390, 768, and 1440 pixels. Mobile metric text remains visible. |
| Live audits | Unified status/coverage/time/score strip, observed-page map, measured categories, findings, and visible recent activity. Preliminary values and terminal behavior remain evidence-driven. |
| Report workspaces, history, and shared reports | Larger score graphic, scope/coverage/priority summary, category factors, full-width findings, expandable evidence, clear tabs and status filters. Comparisons, JSON export, drawers, and terminal states checked with fixtures. |
| Admin | Open activity, queue, executor, health, failure, and action sections; contextual navigation; consistent tables, plan controls, drawers, and guarded dialogs. Mobile title compression corrected. |
| Blog Studio | Three creation paths; concise library/jobs; Write/Review/Publish editor and advanced functions retained. Readiness, source validation, provider errors, unsaved settings, and manual access checked with fixtures. |
| Public blog and articles | Editorial layouts, text-led articles without fabricated image placeholders, readable content width, shared navigation, and persistent light/black theme. Server-rendered metadata, source records, publication restrictions, and structured data remain intact. |
| Pricing, tools, imports, Search Data, rankings, settings, auth, help, and legal | Shared controls/shell/typography migrated; dedicated styles simplified. Direct public routes and tool layouts checked. Provider integrations and account-creation behavior were not changed or live-tested. |

No crawler, scoring, entitlement, API schema, worker, or database changes were introduced by this redesign. Pre-existing cleanup changes in this checkout were preserved.

## Build measurements

These are local build sizes, not production loading times or field Web Vitals. Comparison uses the previous recorded UI release in `docs/ui-redesign-validation.md`.

| Metric | Previous recorded release | Current candidate | Difference |
| --- | ---: | ---: | ---: |
| Initial JavaScript, gzip | 80,362 B | 80,904 B | +542 B (+0.67%) |
| Initial CSS | 96,039 B | 98,333 B | +2,294 B (+2.39%) |
| Total CSS | 111,022 B | 114,962 B | +3,940 B (+3.55%) |

Existing build budgets pass: 90,220 B initial compressed JavaScript, 111,659 B initial CSS, and 115,000 B total CSS. The strict zero-growth aspiration against the previous release was not achieved; the small increases above are reported rather than hidden. No budget was raised.

The initial dependency graph contains the entry and React vendor chunks only. The healthy-homepage browser check observed zero API requests and no Supabase, Sentry, editor, PDF, or administrator script requests before interaction. Illustration animation creates no requests or writes and pauses offscreen, when hidden, or manually; reduced motion is honored.

## Verification

- TypeScript passed on the final source candidate.
- Production build, 24 public HTML shells, tool shells, bundle limits, and Sentry asset verification passed.
- Nine focused Playwright tests passed across homepage/navigation/accessibility, server-rendered blog, and customer audit workspaces. The changed tool route check was rerun successfully after stylesheet consolidation.
- Audit fixture suite passed: filters, detail drawers/focus restoration, comparisons, JSON download, scoped results, allowance display, evidence arrivals, and completed/warning/failure states.
- Admin fixture suite passed: request coordination, stale recovery, refresh cadence, lazy details, retry linking, reasons/confirmations, worker wake, retention confirmation, plan preview, and mobile overflow.
- Blog fixture suite passed: readiness, one-click/source/manual access, queued semantics, HTTPS source validation, provider failures, settings recovery, and no implicit policy writes.
- Six major screens passed at 390/768/1440 pixels in both themes. Dashboard/admin WCAG A/AA checks found no serious/critical violations. All administrator route layouts, mobile metric visibility, persistent server-blog theme, and illustration pause were checked.
- `git diff --check` passed. Intentional fixture 401/503 responses exercised unavailable-service states; no production writes, account creation, audits, or article publication occurred.

This is focused UI validation, not a claim that every provider-connected workflow or publication combination was exercised with live production data.

## Evidence and release state

Screenshots: `test-results/spacious-final/`. Homepage, dashboard, projects, live audit, and report images include width and theme in their filenames; administrator section images and server-blog theme images are also included. Motion evidence is under `test-results/spacious-final/motion/`. Private-screen screenshots use synthetic fixtures, not customer data.

Local app: `http://127.0.0.1:5178/` while the development server is running.

This document records local validation before publication. The production candidate is isolated on the existing UI release checkout from `origin/main`; unrelated cleanup and executor edits are excluded from its commit. Deployment status is reported separately after publication. No worker release or migration is required. The normal production build regenerates `api-runtime` outputs.
