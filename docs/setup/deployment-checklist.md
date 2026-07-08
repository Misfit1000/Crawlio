# Deployment Checklist

## Pre-Deploy

```bash
npm run lint
npm run build
npm run smoke:url
npm run smoke:api-json
npm run smoke:api-hardening
npm run smoke:live-audit
npm run smoke:resource-light-audit
npm run smoke:supabase-schema
npm run e2e:local-audit
npm run verify:seo
npm run verify:security
npm audit --audit-level=moderate
git diff --check
```

## Vercel

- Set `VITE_SUPABASE_URL`.
- Set `VITE_SUPABASE_ANON_KEY`.
- Do not set the Supabase service role key in public `VITE_*` variables.
- Deploy frontend and lightweight API routes only.
- Do not run audit workers or multi-page crawlers in Vercel serverless functions.
- Confirm response security headers are present on preview deployments.
- Configure Vercel Firewall for production:
  - Keep automatic DDoS protection enabled.
  - Enable Bot Protection in log mode first, then challenge mode after confirming legitimate traffic.
  - Add a rate limit rule for `/api/` traffic that matches expected usage.
  - Enable OWASP managed rules if available on the plan.

## Worker

- Set `SUPABASE_URL`.
- Set `SUPABASE_SERVICE_ROLE_KEY`.
- Run `npm run worker:audit`.
- Verify worker logs show the worker started and can claim queued audits.

## Supabase

- Apply `supabase/migrations/001_resource_light_audit.sql`.
- Confirm Supabase Realtime is enabled for audit tables.
- Confirm the live audit page shows `WebSocket live` after opening an audit.
- Confirm RLS is enabled on audit tables.
- Confirm anon clients can read audit progress and enqueue audits only.
- Confirm privileged writes use the service role key only from API/worker environments.

## Post-Deploy

1. On the Vercel preview deployment, start a Quick Audit with `example.com`.
2. Confirm queued state appears immediately.
3. Confirm the worker picks it up.
4. Confirm current page URL updates.
5. Confirm current check updates.
6. Confirm the `Working now` panel updates phase, action, and target URL.
7. Confirm issue feed updates.
8. Confirm final report appears.
9. Confirm JSON/pages CSV/issues CSV exports work.
10. Confirm cancel works for a queued audit.
