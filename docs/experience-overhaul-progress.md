# Experience overhaul: foundation release

Branch: `feature/crawlio-experience-overhaul`.

## Implemented

- Shared light/graphite theme, page hierarchy, responsive spacing, restrained admin styling, and print wrapping rules.
- Dedicated projects route and separate customer/admin navigation.
- URL-persisted finding and administration filters.
- Independently loaded admin sections, paginated server-verified user/audit lists, active-job filtering, accessible reason dialogs, and account/audit detail drawers.
- Sequential guest polling with cancellation, bounded backoff, hidden-tab slowdown, and terminal shutdown. Authenticated Realtime subscription stops fallback polling when subscribed.
- Independent cron and internal-dispatch secret checks.
- Editor dependency isolation and compatible dependency-lock updates.

## Evidence

- TypeScript checking passed.
- Candidate production build, bundle budgets, and server-secret/source-map checks passed (1,906,450 bytes total JavaScript; 106,898 bytes CSS).
- Eight critical/experience browser tests passed: public navigation, themes, mobile overflow, automated accessibility excluding contrast, guest audit completion, terminal refresh, sign-in boundaries, and finding-filter persistence.
- Scheduler authentication, admin read boundary, plans/admin, SEO package, and security package checks passed.
- Dependency audit reported zero vulnerabilities after lockfile updates.
- Shared React vendor asset reduced from approximately 447 KB to 143 KB uncompressed; editor now has its own deferred chunk. This is an asset measurement, not a field performance claim.

## Remaining before production approval

- Authenticated end-to-end admin mutations, drawers, project selection, imports, publishing, and export verification.
- Complete migration of remaining privileged reads and route handlers to dedicated server modules; existing protected paths remain in place.
- Broader individual-screen/report/chart refinements beyond the shared system and navigation changes.
- Production canonical-host and deep-plan availability revalidation; do not silently change domain or enable deep mode.
- Request/database-write baseline comparison and field performance measurement.
- Preview deployment verification and Node 22 release validation. Local checks ran on Node 24 while production is configured for Node 22.

No migration, worker contract change, retention operation, or test-article publication is part of this foundation release. Do not treat this document as confirmation that the full overhaul or production rollout is complete.
