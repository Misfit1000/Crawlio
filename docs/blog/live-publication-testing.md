# Live publication testing

`ALLOW_LIVE_BLOG_PUBLICATION_TEST=true npm run smoke:blog-live-publication` creates a uniquely labelled `noindex` article, checks initial HTML, canonical, robots, structured data and feed exclusion, then archives it.

Run only against a controlled deployment with Supabase service credentials and `APP_URL`. The test must not leave indexable content behind.
