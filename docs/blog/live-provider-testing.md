# Live provider testing

Normal CI uses mocked NVIDIA responses. `npm run smoke:nvidia-live` requires the NVIDIA key and enabled flag, sends one minimal request, and prints only safe status, model, duration, and error code.

`ALLOW_LIVE_BLOG_TEST=true npm run smoke:nvidia-live-draft` creates an isolated unpublished provider record, validates structured output, and removes the record. Missing credentials produce an explicit skipped result.
