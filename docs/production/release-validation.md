# Release Validation

Use three separate test layers. Do not substitute one layer for another.

## Pull Request And Main CI

`npm test`, lint, build, package verification, architecture verification, and deterministic smoke scripts validate modules without production credentials. `npm run e2e:critical` starts the real local Vite/Express application and runs Chromium with mocked API boundaries. It covers public/mobile navigation, pricing limits, theme persistence, duplicate audit submission, queued/running/terminal integration, refresh/history navigation, safe sign-in failure, anonymous admin rejection, overflow, and a serious/critical accessibility scan.

Routine E2E does not use the production worker or a personal account. Successful member/admin tests may be added only with an isolated seeded test environment.

## Production Release Smoke

Configure GitHub production environment variables:

- `PRODUCTION_APP_URL`
- `PRODUCTION_WORKER_HEALTH_URL`
- optional `PRODUCTION_SMOKE_TARGET_URL`

Run the **Production release smoke** workflow manually. The default run does not create an audit. It verifies homepage, blog, sitemap, robots, version fields, disabled blog provider, engine/database health, release compatibility, anonymous admin rejection, protected report/export JSON errors, and absence of platform error pages.

Enable the Quick Audit input only when the smoke target is controlled and stable. The runner enforces a five-page limit, bounded polling, terminal state, worker-claim evidence, final score/unavailable state, inactive terminal language, and best-effort cleanup. Never schedule this audit-producing mode as uptime monitoring.

The runner emits one JSON object to stdout, a readable summary to stderr, and a non-zero exit code on failure.

## Ownership

- Product engineers own deterministic local smoke and Playwright fixtures.
- Release operators own production environment variables and manual release smoke.
- Database operators own migration/restore verification.
- Audit-engine operators own heartbeat, queue, stale lease, and worker deployment response.
- Security owners review alert payload fields, RLS, secret scope, and anonymous rejection tests.
