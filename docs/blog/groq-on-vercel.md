# Groq on Vercel

Groq calls run only from trusted Vercel server modules. Structured work, section writing and revisions default to `openai/gpt-oss-120b`. Clients cannot select a model or provider URL. Groq retired `llama-3.3-70b-versatile` for free/developer use on August 16, 2026; existing Vercel writer overrides must also be updated. See [Groq model deprecations](https://console.groq.com/docs/deprecations).

The provider retries only timeouts, 429, and 500/502/503/504 responses, respects bounded `Retry-After`, limits output, and maps failures to safe `GROQ_*` codes. Start disabled. Never create `VITE_GROQ_API_KEY`, add Groq variables to Render, or persist raw responses.
