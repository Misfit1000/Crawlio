# Production Architecture

This document is the deployment source of truth. Supporting setup documents should link here instead of redefining runtime ownership.

## Runtime ownership

| Runtime | Owns | Must not own |
| --- | --- | --- |
| Vercel | Vite frontend, auth-aware bounded API handlers, audit admission/status/cancel/export, public blog rendering, bounded blog job stages and cron dispatch | Multi-page crawling, audit worker loops, permanent background processes |
| Supabase | Auth, Postgres, RLS, Realtime, audit/blog state, durable limits, leases, reports and operational records | Public service-role credentials |
| Render/Railway/Docker | Long-running Node audit worker, queue claims, public-site crawling, checks, progress and final reports | Blog generation, Groq secrets, browser assets |

The audit API validates and authorizes a target, performs durable admission, inserts a queued job, and returns. Supabase Realtime updates authenticated owners; guest audits and disconnected clients use bounded authorized polling. `/api/tools/audit/events/:id` is a bounded event snapshot, not a serverless SSE stream.

Blog generation is Vercel-only and resumes through finite leased stages stored in Supabase. Render is audit-only.

## Required deployment settings

- Node.js 22 for CI, Vercel, and worker images.
- Vercel install: `npm ci --legacy-peer-deps`; build: `npm run build`; output: `dist`.
- Render build: `npm ci --legacy-peer-deps`; start: `npm run worker:audit`.
- Worker health: `https://seointel-audit-worker.onrender.com/health`.
- Worker health exposes only safe status, audit contract versions, and the deployment commit so Vercel and Render releases can be compared.
- Canonical app origin: `https://keywordsintel.vercel.app` until a custom domain is attached.
- Apply Supabase migrations 001 through 019 in numeric order. Migration 016 makes Vercel's durable admission path the only audit-job creator; migration 019 persists owner-scoped finding workflow and alert deduplication state.

The retired in-process audit store, event emitter, crawler, and local audit runners are intentionally absent. `src/workers/audit-worker.ts` is the only production crawl/check orchestrator. `npm run verify:audit-architecture` prevents a crawler import from entering the Vercel API boundary.

See `environment-variables.md` for ownership of each variable and `../setup/deployment-checklist.md` for release verification.
