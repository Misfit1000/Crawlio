# Deployment Checklist

## Optional Sentry monitoring

- Create the Sentry project; do not invent a DSN or token.
- Add `VITE_SENTRY_DSN` and `SENTRY_DSN` to Vercel Production and Preview.
- Add build-only `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` to Vercel when readable production source maps are required.
- Add only `SENTRY_DSN` to the audit worker provider.
- Redeploy Vercel and the worker, then verify the safe status cards in **Admin > Diagnostics**.
- Send one administrator-authorized API test event and confirm release/environment tags and readable stack traces.
- Keep Replay, Profiling, Logs, and development reporting disabled.

See `docs/operations/sentry.md` for the ordered setup and privacy checks.

Apply migrations in numeric order through `019_finding_workflow_and_operations.sql`. Verify RLS, server-only audit admission, finding-workflow ownership, alert-state secrecy, the Vercel blog claim/complete/recovery RPCs, review thresholds, section revisions, image variants, approved sources, and fixture publication guards before deploying code.

## Pre-Deploy

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run smoke:url
npm run smoke:api-json
npm run smoke:api-hardening
npm run smoke:live-audit
npm run smoke:resource-light-audit
npm run smoke:supabase-schema
npm run smoke:blog
npm run e2e:local-audit
npm run verify:seo
npm run verify:security
npm run verify:audit-architecture
npm run e2e:critical
npm audit --audit-level=moderate
git diff --check
```

## Vercel

- Set `VITE_SUPABASE_URL`.
- Set `VITE_SUPABASE_ANON_KEY`.
- Set server-only `GROQ_*`, `BLOG_DISPATCH_SECRET`, `CRON_SECRET`, `RATE_LIMIT_HASH_SECRET`, and `APP_URL` values on Vercel.
- Confirm no `VITE_GROQ_*` environment variable exists.
- Do not set the Supabase service role key in public `VITE_*` variables.
- Deploy frontend, lightweight audit APIs, and bounded Vercel blog stages.
- Do not run audit workers or multi-page crawlers in Vercel serverless functions.
- Confirm response security headers are present on preview deployments.
- Configure Vercel Firewall for production:
  - Keep automatic DDoS protection enabled.
  - Enable Bot Protection in log mode first, then challenge mode after confirming legitimate traffic.
  - Add a rate limit rule for `/api/` traffic that matches expected usage.
  - Enable OWASP managed rules if available on the plan.

## Render Audit Worker

- Set `SUPABASE_URL`.
- Set `SUPABASE_SERVICE_ROLE_KEY`.
- Run `npm run worker:audit`.
- Verify worker logs show the worker started and can claim queued audits.
- Confirm Render has no `BLOG_*`, `GROQ_*`, scheduler, or provider variables.

## Supabase

- Apply every file in `supabase/migrations/` in numeric order through 019; never rewrite an earlier migration.
- Confirm Supabase Realtime is enabled for audit tables.
- Confirm the live audit page shows `WebSocket live` after opening an audit.
- Confirm RLS is enabled on audit tables.
- Confirm authenticated clients can read only their own audit rows through RLS. Guest audits use the identity-protected Vercel status endpoint and do not receive direct table-read policies.
- Confirm privileged writes use the service role key only from API/worker environments.
- Confirm `blog_posts` has RLS enabled and only published posts are publicly readable.
- Confirm `audit_finding_workflow` is owner-scoped and `operations_alert_state` has no browser policy.

## Post-Deploy

1. On the Vercel preview deployment, start a Quick Audit with `example.com`.
2. Confirm queued state appears immediately.
3. Confirm the worker picks it up.
4. Confirm current page URL updates.
5. Confirm current check updates.
6. Confirm the compact desktop/mobile preview is labelled as a screenshot, Open Graph preview, metadata preview, or unavailable state and does not attempt to embed the audited site.
6. Confirm the `Working now` panel updates phase, action, and target URL.
7. Confirm issue feed updates.
8. Confirm final report appears.
9. Confirm JSON/pages CSV/issues CSV exports work.
10. Confirm a completed Paid, Agency, or Admin audit downloads a valid PDF and a Free audit receives the expected upgrade message.
11. Confirm cancel works for a queued audit.
12. Publish a reviewed test article, verify complete initial HTML at `/blog/{slug}`, and confirm it appears in `/sitemap.xml` and `/rss.xml`.
13. Run the manual no-audit production release smoke, then one explicitly enabled Quick Audit against the controlled smoke target.
