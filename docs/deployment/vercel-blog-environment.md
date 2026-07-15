# Vercel blog environment

Required server variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, `GROQ_API_BASE_URL`, `GROQ_BLOG_STRUCTURED_MODEL`, `GROQ_BLOG_WRITER_MODEL`, `GROQ_BLOG_ENABLED`, `BLOG_AUTOMATION_ENABLED`, `BLOG_DISPATCH_SECRET`, and Vercel `CRON_SECRET`. Optional capacity controls are `GROQ_BLOG_MAX_CONCURRENCY=1`, `GROQ_BLOG_MIN_REQUEST_INTERVAL_MS=2000`, and `GROQ_BLOG_MAX_RETRIES=2`.

Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are browser-safe. Keep Groq and automation disabled on the first deploy, test the protected provider action, then enable Groq and redeploy. Keep review mode until a controlled unpublished workflow and publication test pass.

Apply migration `015_vercel_blog_workflow.sql` as one complete SQL Editor run. It safely creates `blog_provider_health` when an environment has the blog queue but missed that optional migration 013 table, then configures its RLS and Groq-compatible provider constraint.
