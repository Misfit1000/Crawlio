# Provider-disabled mode

The safe initial state is Groq on Vercel with structured and writer model `openai/gpt-oss-120b`, `GROQ_BLOG_ENABLED=false`, and automatic generation disabled. Manual writing, sources, calendar, image import, editorial review, static publishing, and explicitly protected fixtures remain available.

Live draft and revision controls explain that configuration is required. Jobs retain durable stage state and a safe error instead of repeatedly retrying or publishing partial content. Enable Groq only after migration 015, Vercel secrets, a protected provider test, and one controlled unpublished workflow are verified.
