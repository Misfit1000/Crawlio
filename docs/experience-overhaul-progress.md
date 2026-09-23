# Experience overhaul: foundation release

Branch: `feature/crawlio-experience-overhaul`.

## Implemented

- Shared light/graphite theme, page hierarchy, responsive spacing, restrained admin styling, and print wrapping rules.
- Dedicated projects route and separate customer/admin navigation.
- URL-persisted finding and administration filters.
- Independently loaded admin sections, paginated server-verified user/audit lists, active-job filtering, accessible reason dialogs, and account/audit detail drawers.
- Remaining administrator overview, worker, action, plan, and platform-setting reads are served by bounded admin APIs. Role changes reject self-demotion and migration 022 protects the last active administrator under concurrent updates.
- Sequential guest polling with cancellation, bounded backoff, hidden-tab slowdown, and terminal shutdown. Authenticated Realtime subscription stops fallback polling when subscribed.
- Independent cron and internal-dispatch secret checks.
- Editor dependency isolation and compatible dependency-lock updates.
- Authenticated profile reads no longer write unchanged rows or reactivate past-due subscriptions; disabled accounts are rejected.

## Evidence

- TypeScript checking passed.
- Candidate production build, bundle budgets, and server-secret/source-map checks passed after the admin read follow-up (1,906,024 bytes total JavaScript; 106,898 bytes CSS).
- Eight critical/experience browser tests passed: public navigation, themes, mobile overflow, automated accessibility excluding contrast, guest audit completion, terminal refresh, sign-in boundaries, and finding-filter persistence.
- Scheduler authentication, admin read boundary, plans/admin, SEO package, and security package checks passed.
- Follow-up checks passed: administrator operations, blog source management, and local schema smoke. Migration 022 has not been applied to production or exercised against a live database.
- Profile-read regression test passed against a local fake Supabase response: unchanged profile caused zero writes, and a changed email preserved `past_due`.
- Migration 022 was applied manually to production Supabase project `finiiohiulbznlxyazzl`. A read-only verification returned `function_installed=true`, `trigger_installed=true`, and one active administrator. Supabase Free provides no project backups, so there was no provider backup to create.
- Vercel built feature commit `9599ad6` as a Ready preview. The public homepage loaded; the example-report action reached the sign-in-protected report route; mobile navigation and pricing worked at 390px in light and dark themes, with no document-level horizontal overflow. Production remains on `main`.
- Dependency audit reported zero vulnerabilities after lockfile updates.
- Shared React vendor asset reduced from approximately 447 KB to 143 KB uncompressed; editor now has its own deferred chunk. This is an asset measurement, not a field performance claim.

## Remaining before production approval

- Authenticated end-to-end admin mutations, drawers, project selection, imports, publishing, and export verification.
- Complete migration of the remaining admin write handlers and blog routes to dedicated server modules; existing protected paths remain in place.
- Broader individual-screen/report/chart refinements beyond the shared system and navigation changes.
- Production canonical-host and deep-plan availability revalidation; do not silently change domain or enable deep mode.
- Request/database-write baseline comparison and field performance measurement.
- Verify the final-admin rule with a live transaction after a backup becomes available. The migration itself has been applied and its function/trigger presence checked.
- Authenticated preview verification and explicit Node 22 release validation. Local checks ran on Node 24; a Ready Vercel preview alone does not prove every server route or audit flow works on Node 22.

No worker contract change, retention operation, or test-article publication is part of this work. Migration 022 is additive but required for the database-side administrator guard. Do not treat this document as confirmation that the full overhaul or production rollout is complete.
