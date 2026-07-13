# NVIDIA NIM provider

Blog drafting uses NVIDIA NIM through the OpenAI-compatible `/chat/completions` endpoint. The default model is `qwen/qwen3.5-122b-a10b`. The provider is disabled until `NVIDIA_BLOG_ENABLED=true` and a worker-only `NVIDIA_API_KEY` are configured.

Provider requests run in the Render worker. The browser and Vercel frontend never receive the key. There is no Gemini fallback. Safe errors preserve jobs for administrator review and retry.
