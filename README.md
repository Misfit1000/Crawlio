# SEOIntel

SEOIntel is a resource-aware SEO, technical SEO, and passive security audit platform. Vercel serves the Vite application and lightweight API; Supabase stores jobs and results; a separate Render worker performs public-site analysis.

## Features

- **Deterministic Audit Engine**: Technical, on-page, crawlability, content, and passive browser-protection checks.
- **Safe Worker Crawling**: SSRF controls, pinned DNS, redirect revalidation, response limits, per-host scheduling, and bounded audit duration.
- **Technical SEO**: Find broken links, redirect chains, missing schemas, and more.
- **Search Data Imports**: Import real performance data from Google Search Console and Bing Webmaster Tools.
- **Public Web Discovery**: Discover mentions and backlinks via Common Crawl.
- **Transparent Scores**: Measured deductions are stored with limitations; unavailable provider data does not affect scores.
- **Account History And Comparison**: Owner-scoped Supabase history with new, resolved, and persistent issue comparison.
- **No Paid APIs**: Operates using free data and local analysis rules.

## Getting Started

1. Clone the repository.
2. Run `npm install` to install dependencies.
3. Run `npm run dev` to start the local development server.
4. Open the app in your browser and start an audit.

## Deployment

Deploy the frontend and lightweight API to Vercel, apply Supabase migrations, and deploy the audit worker separately to Render. Never run the crawl loop inside a Vercel function. See `docs/setup/deployment-checklist.md`.

## License

MIT
