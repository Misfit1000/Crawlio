# Premium experience release record

## Customer and admin changes

- Rebuilt the public homepage around a conceptual, controllable audit scene rather than demonstration scores. It pauses when hidden or offscreen and respects reduced motion.
- Consolidated live audit status, coverage, provisional scores, findings, and observed-page visualization. The page map groups actual pages by crawl depth; selection opens recorded evidence.
- Made completed findings full-width, presented measured score factors as readable bars, and kept unavailable measurements distinct from zero.
- Centered the signed-in dashboard and projects on the latest audit and next action. Clarified imports, ranking CSV, and search-data states without fabricating provider data.
- Aligned server-rendered blog listings and articles with the customer light/dark visual system while keeping HTML crawlable and script-free.
- Clarified admin sections and error/empty states; preserved all existing role checks and operations.
- Tightened responsive navigation, focus handling, contained scrolling, button feedback, and light/dark contrast.

## Request and resource changes

- An active audit snapshot now makes four repository reads instead of five. It authorizes the audit first, reads evidence concurrently, and does not query the report table until terminal state.
- The initial audit snapshot is reused when subscribing. Guest startup no longer makes an immediate duplicate poll or opens an unnecessary Realtime channel. Polling remains the intended guest-access path; it resumes on tab focus and stops on permanent access errors.
- Concurrent identical reads are deduplicated only within one authenticated session and are not cached after settlement. History lists request bounded summaries; full evidence remains available when a report opens.
- Editor, PDF, admin, and report-heavy code remains lazy. Motion uses local state and CSS; it creates no network requests or database writes.
- Anonymous marketing visits no longer initialize Supabase. Existing sessions and protected entry points hydrate on demand, while sign-in and registration activate authentication directly.
- Browser monitoring uses a privacy-scrubbed 20-event facade and loads Sentry only after an error or when an operational workspace is entered.
- Homepage pricing renders a bundled fallback immediately and requests the administrator-configured public plan projection only when pricing approaches the viewport. The projection excludes administrator and operational limits and is cached for at most 60 seconds at the edge.
- Unchanged guest audit polls read only the authorized audit row. Evidence collections are fetched concurrently only when counters advance, and the final report is fetched once on terminal transition.
- Hidden tabs perform no guest polling or elapsed-clock wakeups. Returning to the tab triggers an immediate status refresh.
- Worker queue claims remain on a four-second interval. Serialized heartbeats are immediate on lifecycle transitions and at most once every 30 seconds otherwise, reducing idle heartbeat writes to no more than two per minute.
- The Vercel function is emitted as a stable entry with hashed chunks. The version endpoint no longer waits for the tools router to load, and heavyweight PDF, image, research, and link-signal handlers remain request-loaded.

## Validation and evidence

- TypeScript check, production build, SEO/security verification, dependency audit, selected smoke suites, and critical/experience browser tests passed.
- Browser captures cover 390, 768, and 1440 px in light and dark themes with no horizontal overflow. Focused SSR blog tests cover both listing and article at those widths.
- The feature branch was deployed to a protected Vercel preview and the signed-in browser verified the homepage interactions and crawlable blog route. Anonymous performance tools reach Vercel authentication instead of the preview app, so those results were discarded.
- Pre-release public production baseline at `https://crawlio1.vercel.app/` on 2026-09-24: 9 homepage browser requests and 323,947 transferred JavaScript bytes cold; 9 browser requests and 0 transferred JavaScript bytes on a cache-warm repeat.
- Final same-host production check on 2026-09-24, commit `256b094`: 9 requests and 323,884 transferred JavaScript bytes cold; 9 requests and 0 transferred JavaScript bytes on a cache-warm repeat. Decoded JavaScript fell from 1,037,392 to 1,036,637 bytes. The 63-byte transfer reduction is small but clears the no-increase gate. These are browser-network measurements, not Vercel billing or database telemetry.
- Current local release candidate: 91,344 compressed bytes across the initial JavaScript dependency set, 71.8% below the 323,884-byte production baseline. CSS is 109,108 bytes. A headless 1440 px anonymous homepage check requested no Sentry runtime, Sentry vendor, Supabase vendor, or public-plan API before scrolling; approaching pricing produced exactly one plan request.
- The Sentry-enabled Vercel build also passed the bundle budgets at 93,220 compressed initial JavaScript bytes and 110,028 CSS bytes. An initial preview packaging attempt exposed Vercel's Hobby 12-function limit because split chunks were emitted below `api/`; the build now keeps those chunks in `api-runtime/`, leaving only the single API entry under `api/`.
- The generated Vercel API entry is 2,816 bytes and its static startup closure is 1,328,676 bytes, 69.4% below the previous 4,340,996-byte monolith. The tools router is loaded only when a tools route is requested.
- Local and production latency are not directly comparable. Same-host cold load elapsed time varied between runs, so no latency improvement is claimed.
- Vercel reports the final `main` deployment Ready. Public `/`, `/blog`, and `/sitemap.xml` returned HTTP 200; the blog delivered server-rendered content and a canonical link. Final production captures at 390, 768, and 1440 px showed no horizontal overflow in either theme.

## Known limits

- No field LCP, CLS, INP, worker memory, database-read/write, or CDN cache-hit measurements are available. Do not infer billing savings from request counts alone.
- Live authenticated admin and audit completion journeys require accounts and active audit infrastructure; automated checks cover representative route, state, role, and export behavior but cannot substitute for a production operator test.
- Site preview compositions are labeled metadata reconstructions when a genuine screenshot is unavailable. Search rankings, traffic, and backlinks are never invented.
- No schema migration, worker contract change, paid integration, or new monitoring service is part of this release.
