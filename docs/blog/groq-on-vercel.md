# Groq on Vercel

Groq calls run only from trusted Vercel server modules. Structured work, section writing and revisions default to `openai/gpt-oss-120b`. Clients cannot select a model or provider URL. Groq retired `llama-3.3-70b-versatile` for free/developer use on August 16, 2026; existing Vercel writer overrides must also be updated. See [Groq model deprecations](https://console.groq.com/docs/deprecations).

The provider retries only timeouts, 429, and 500/502/503/504 responses, respects bounded `Retry-After`, limits output, and maps failures to safe `GROQ_*` codes. Start disabled. Never create `VITE_GROQ_API_KEY`, add Groq variables to Render, or persist raw responses.

Apply `030_blog_provider_pacing.sql` before deploying section-checkpoint generation. Writing and claim checks save bounded sections under the same job; retries retain completed work. Invalid structured stage output also retries durably, without an immediate enlarged repair request. Token-budget headers inform a shared, bounded cooldown recorded by the existing atomic checkpoint. Each dispatcher invocation has a time budget and a limited protected handoff chain, so exhausted provider quota can leave a job waiting for the next authorized dispatch rather than continuously retrying.

Generation availability and automatic publication permission are separate. Review-first drafts do not need Strict Autopilot approval, but unattended publication still requires the saved editorial policy and real approval threshold. Critical source, claim, originality, link and rendering checks remain enforced.
