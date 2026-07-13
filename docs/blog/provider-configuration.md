# Provider configuration

Set `NVIDIA_API_KEY`, `NVIDIA_API_BASE_URL=https://integrate.api.nvidia.com/v1`, `NVIDIA_BLOG_MODEL=qwen/qwen3.5-122b-a10b`, and `NVIDIA_BLOG_ENABLED=false` on Render. Add the key, redeploy, test connectivity, then enable the provider deliberately.

Do not create `VITE_NVIDIA_*` variables or put the key in Vercel. The admin provider panel reports only safe status, model, host, duration, and error codes.
