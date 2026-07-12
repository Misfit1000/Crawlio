# Application Routing

SEOIntel uses React Router in declarative browser mode. Route definitions and tab mappings live in `src/app/routes.ts`; URLs, not component state, are the navigation source of truth.

Public routes include `/`, `/login`, `/register`, `/pricing`, `/reports/example`, `/blog`, `/blog/:slug`, and the guest-safe `/audit/live/:auditId` progress view. Authenticated product routes use `/app`. Audit evidence uses `/app/audits/:auditId/:section`, where section is `overview`, `seo`, `technical`, `crawlability`, `links`, `performance`, `security`, or `pages`.

`/app/*` requires an authenticated Supabase user. `/admin/*` additionally requires the server-provided `admin` role. Audit APIs independently enforce owner, guest-session, or admin access; client routing is not a security boundary.

Vercel must rewrite non-API browser routes to `index.html` so direct refresh and shared links reach the Vite application.
