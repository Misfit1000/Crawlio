# Privacy-safe Sentry monitoring

Crawlio uses the Sentry free Developer tier for low-volume error visibility across three runtime boundaries:

| Runtime | Service tag | Runtime tag | DSN variable |
| --- | --- | --- | --- |
| React/Vite browser | `crawlio-web` | `browser` | `VITE_SENTRY_DSN` |
| Vercel API | `crawlio-api` | `vercel-api` | `SENTRY_DSN` |
| Node audit worker | `crawlio-worker` | `audit-worker` | `SENTRY_DSN` |

One Sentry project and DSN can serve all three runtimes initially. Tags separate events, and each runtime already accepts its own environment variable so separate projects can be introduced later without code changes.

Sentry is inactive when its DSN is absent. Unit tests, Playwright, and local smoke tests do not send events. Development browser reporting also requires `VITE_SENTRY_ENABLE_DEVELOPMENT=true`; do not enable it against the production project.

## Manual setup

1. Create or sign in to a Sentry account and select the free Developer plan.
2. Create a JavaScript/React project for Crawlio using the current JavaScript SDK instructions.
3. Copy the project DSN. A browser DSN is a public event-routing identifier, not a private API credential.
4. Add `VITE_SENTRY_DSN` to Vercel Production and Preview.
5. Add `SENTRY_DSN` to Vercel Production and Preview.
6. Add `SENTRY_DSN` to the always-on audit worker provider.
7. In Sentry, create an organization auth token restricted to the project/release permissions required for source-map upload. Treat this token as a secret.
8. Copy the Sentry organization slug and project slug.
9. Add `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` to Vercel Production and Preview. These variables are build-only and must not be copied to the worker.
10. Redeploy Vercel so the browser bundle, API function, release identifier, and source maps use the same commit.
11. Redeploy the audit worker so it initializes with the same deployed commit and publishes `sentryConfigured=true` in its safe heartbeat.
12. Sign in as a Crawlio administrator, open **Admin > Diagnostics > Error monitoring**, and select **Send API test** once.
13. Confirm one event named `Crawlio administrator Sentry verification event` appears with `testEvent=true`, `service=crawlio-api`, and the expected environment/release.
14. Open the event and confirm the stack is readable. If it is minified, verify the three source-map variables, the release SHA, and the Vercel build log, then redeploy.

Do not create an unauthenticated throw-error route and do not schedule the test action.

## Environment placement

| Variable | Vercel Production | Vercel Preview | Worker | Sensitive? |
| --- | --- | --- | --- | --- |
| `VITE_SENTRY_DSN` | Yes | Yes | No | No |
| `SENTRY_DSN` | Yes | Yes | Yes | Treat as configuration |
| `SENTRY_AUTH_TOKEN` | Yes, build only | Yes, build only | No | Yes |
| `SENTRY_ORG` | Yes, build only | Yes, build only | No | No |
| `SENTRY_PROJECT` | Yes, build only | Yes, build only | No | No |
| `SENTRY_ENVIRONMENT` | Optional | Optional | Optional | No |
| `SENTRY_RELEASE` | Optional | Optional | Optional | No |
| `VITE_SENTRY_ENABLE_DEVELOPMENT` | No | No | No | No |

Vercel and the worker provider already expose Git commit identifiers. `SENTRY_RELEASE` is only a fallback override; avoid setting it unless the deployment platform cannot supply a commit.

## Event and quota controls

- Uncaught errors and unhandled promise rejections are captured when configured.
- Browser transaction sampling is 5% in Production and 2% in Preview.
- API transaction sampling is 2% in Production and 1% in Preview.
- Worker tracing is disabled to prevent customer crawl URLs from entering HTTP spans; worker monitoring is error-only.
- Error sampling is 100% after expected/noisy outcomes are filtered.
- Session Replay is disabled.
- Profiling is disabled.
- Sentry Logs are disabled.
- Individual page failures, blocked pages, robots restrictions, cancellations, expected authorization failures, expected rate limits, and plan limits are not error events.
- Worker system captures are locally deduplicated for one minute by stage/category.

## Privacy boundary

`sendDefaultPii` is false in every runtime. The shared `beforeSend` and `beforeBreadcrumb` policy removes:

- authorization, cookie, and set-cookie headers;
- Supabase access/refresh tokens, service-role keys, API keys, OAuth codes, and database URLs;
- request bodies and credential form data;
- user email, IP, username, name, and ID;
- URL credentials, query strings, and fragments;
- raw HTML, page bodies, extracted content, prompts/responses, reports, exports, sitemaps, robots contents, and crawl evidence;
- event attachments.

Customer URLs in structured context are reduced to a sanitized origin. The worker uses a one-way 16-character audit correlation ID and never attaches the raw audit ID or target URL. Safe worker context is limited to stage, failure category, mode, engine/scoring versions, attempt number, and release.

## Source maps

The official `@sentry/vite-plugin` runs only when `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, and a non-local release are all available. The Vite build then:

1. creates hidden source maps;
2. uploads them against the deployment commit release;
3. deletes `dist/**/*.map` after upload.

Without all credentials, the plugin is omitted and the normal production build succeeds with source maps disabled. `SENTRY_AUTH_TOKEN` is never defined in browser code. Run `npm run verify:sentry-assets` after building to confirm public assets contain no source maps or server-only secrets.

Official references:

- https://docs.sentry.io/platforms/javascript/
- https://docs.sentry.io/platforms/javascript/configuration/filtering/
- https://docs.sentry.io/platforms/javascript/sourcemaps/uploading/vite/
