# Controlled Free Beta Launch Checklist

## Required before deployment

- Back up the Supabase database and record the restore point.
- Apply migrations 001 through 019 in numeric order; never edit an applied migration.
- Configure Vercel browser variables and server-only Supabase variables in their correct scopes.
- Configure the Render audit engine with the same release commit and server-only variables.
- Set a random `RATE_LIMIT_HASH_SECRET`; never expose it through a `VITE_` variable.
- Confirm `/api/version`, the protected admin compatibility panel, and the audit-engine `/health` endpoint agree.
- Keep `captchaRequired` off until a matching browser Turnstile widget and secret are configured.
- Complete the legal owner name, monitored support contact, address, jurisdiction, and formal notice details before promoting beyond a controlled beta.

## Release verification

1. Run CI and the repository validation suite.
2. Deploy the frontend/API and audit engine from the same commit.
3. Open the manual production release-smoke workflow without audit creation.
4. Confirm version compatibility and queue polling.
5. Enable one Quick Audit only with the controlled `PRODUCTION_SMOKE_TARGET_URL` and confirm claim, page bound, terminal state, report, and cleanup.
6. Verify account export, audit deletion, and a test-account deletion.
7. Check CSP, browser console, mobile widths, keyboard navigation, and dark/light themes.

## Scope deliberately postponed

Oracle deployment, paid-worker routing, multi-worker infrastructure, Stripe Checkout, Stripe webhooks, billing portal, and payment processing remain future work. Do not configure or advertise them as active.

## Public blog delivery

Published article routes return complete initial HTML through the bounded Vercel API renderer, while `/blog` remains the Vite index experience. Verify article canonical metadata, JSON-LD, sitemap, RSS, and anonymous rendering during release checks.
