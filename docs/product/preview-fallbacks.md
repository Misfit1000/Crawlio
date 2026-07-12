# Audited-Site Preview Fallbacks

SEOIntel does not embed an audited website in an iframe. Many production websites block embedding with `X-Frame-Options` or Content Security Policy, so an iframe would make the audit workspace look broken even when the audit succeeded.

## Preview source order

The shared desktop/mobile preview uses the first genuine source available:

1. A trusted screenshot URL, when a screenshot pipeline has supplied an actual capture.
2. The page's resolved Open Graph image with collected page metadata.
3. A compact composition made only from collected title, description, H1, site name, favicon, preferred URL, and theme color.
4. A clear preview-unavailable state with a link to open the real site.

Each state is labelled. An Open Graph image is never called a screenshot, and a metadata composition is never described as a live rendering of the website.

## Security and reliability

- Preview media must use `http` or `https` and cannot include embedded credentials.
- Obvious localhost and private-network media URLs are rejected in the browser.
- External preview images use a no-referrer policy.
- Image load failures fall back to metadata without affecting audit findings or report access.
- SEOIntel stores page summaries, not raw HTML.

## Database rollout

Migration `009_audit_page_preview_metadata.sql` adds the optional preview fields to `audit_pages`. Apply it before deploying the updated worker when possible. The repository retries legacy page writes when those columns are not yet available, so an out-of-order deployment does not stop audit processing; richer stored previews appear after the migration is applied and a new audit is run.

SEOIntel currently leaves `screenshot_url` empty unless a genuine trusted capture is supplied. It does not claim to take screenshots when no screenshot service exists.
