# Core reliability fixes - 2026-10-03

## Changes

- Blog sources and links now use one bounded, server-only database transaction. Duplicate link identities are removed, related-link classification is preserved, failed replacements retain prior evidence, and replays do not duplicate editorial history.
- Manual edits, workflow actions, section approvals, and AI publication use exact-version write guards instead of relying only on an earlier read.
- An interrupted AI save resumes the existing article through evidence persistence and publication checks. Changed or held articles require editorial review; retry does not create another article or repeat completed provider work.
- Temporary database and transport failures use the existing bounded job retry policy. Permanent validation, permission, and schema errors still require intervention.
- Scalable audit lease renewal is single-flight. Completion drains pending writes, rejects lost ownership, avoids a second lease release, and keeps health-reporting failures from replacing durable outcomes.
- Worker shutdown starts no new page requests after the stop signal. Temporary sitemap transport failures receive the existing bounded retries; robots and SSRF policies are unchanged.
- Public release verification exposed stale homepage and robots hostnames. Build-time metadata now uses the configured canonical origin consistently, including structured data and social URLs. The default origin is Crawlio's current production hostname.
- Release smoke checks accept explicitly configured blog enablement instead of assuming every release must keep generation disabled. Capability types and optional expected values remain validated.
- Blog notification deep links now open the selected article when the query changes within the same screen, without requiring a page reload.

## Validation

- TypeScript: passed.
- Focused blog persistence, interrupted-save recovery, public article SEO, host scheduling, and scalable worker tests: 39 passed.
- Existing complete-summary/finalization and robots regression tests: 20 passed in the worker validation run.
- Canonical build metadata tests: 2 passed; existing public article SEO tests passed again after the fallback update.
- Production build and browser asset secret/source-map verification: passed.
- Homepage initial gzip JavaScript: 98,771 bytes (5 bytes above the previous release after lazy-admin chunk references changed; no additional homepage dependency).
- Total built CSS: 111,659 bytes, unchanged. Core API entry: 2,852 bytes, unchanged.
- Migration `032_blog_editorial_reliability.sql` applied to Supabase before application deployment.
- `scripts/check-blog-editorial-transaction.sql` passed against the production database: source/link deduplication, related-link priority, idempotent history, failed-write rollback, stale-version rejection, and server-only execution. The transaction never published or retained its private fixture.
- Release `d2a6de4` reached both Vercel and Render with schema 15 and healthy database/queue status. The existing failed AI article recovered to a private, ready-for-review draft at 100%, with no additional article generated. One editorial publication requirement remains; it was not bypassed.

## Limits

- This release does not establish a production 5,000-page throughput or memory benchmark, field Core Web Vitals, or guarantees of target-site availability.
- Existing editorial review and source/claim/originality gates remain required. Strict Autopilot is not unlocked by fabricated approvals.
