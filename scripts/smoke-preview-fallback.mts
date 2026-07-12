import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseHtml } from '../src/lib/seo/html-parser';
import { resolveAuditPreviewState, safePreviewMediaUrl, safePreviewThemeColor } from '../src/lib/audit/preview-model';

const screenshot = resolveAuditPreviewState({
  url: 'https://example.com/',
  screenshotUrl: 'https://cdn.example.com/capture.webp',
  openGraphImage: 'https://example.com/social.jpg',
});
assert.equal(screenshot.kind, 'screenshot');
assert.equal(screenshot.mediaUrl, 'https://cdn.example.com/capture.webp');

const openGraph = resolveAuditPreviewState({
  url: 'https://example.com/',
  openGraphImage: 'https://example.com/social.jpg',
});
assert.equal(openGraph.kind, 'open_graph');

const metadata = resolveAuditPreviewState({ title: 'A collected page title' });
assert.equal(metadata.kind, 'metadata');
assert.equal(resolveAuditPreviewState({}).kind, 'unavailable');
assert.equal(resolveAuditPreviewState({ url: 'https://example.com/', hostname: 'example.com' }).kind, 'unavailable');

for (const unsafeUrl of [
  'javascript:alert(1)',
  'data:image/png;base64,abc',
  'http://localhost/image.png',
  'http://127.0.0.1/image.png',
  'http://10.0.0.4/image.png',
  'https://intranet/image.png',
  'https://printer.local/image.png',
  'http://100.64.0.1/image.png',
  'http://[fe80::1]/image.png',
  'http://[fd00::1]/image.png',
  'https://user:password@example.com/image.png',
]) {
  assert.equal(safePreviewMediaUrl(unsafeUrl), null, `${unsafeUrl} must not be rendered as preview media`);
}
assert.equal(safePreviewThemeColor('#2563eb'), '#2563eb');
assert.equal(safePreviewThemeColor('url(javascript:alert(1))'), null);

const parsed = parseHtml(`<!doctype html><html><head>
  <title>Collected title</title>
  <meta name="description" content="Collected description">
  <meta name="theme-color" content="#123456">
  <meta property="og:site_name" content="Collected Site">
  <meta property="og:image" content="/assets/social.png">
  <link rel="canonical" href="/preferred">
  <link rel="icon" href="/favicon.ico">
</head><body><h1>Collected heading</h1></body></html>`, 'https://example.com/source');

assert.equal(parsed.ogImage, 'https://example.com/assets/social.png');
assert.equal(parsed.faviconUrl, 'https://example.com/favicon.ico');
assert.equal(parsed.canonical, 'https://example.com/preferred');
assert.equal(parsed.siteName, 'Collected Site');
assert.equal(parsed.themeColor, '#123456');

const previewSources = [
  resolve('src/components/ui/visual-system.tsx'),
  resolve('src/components/ui/compact-site-preview.tsx'),
].map((file) => readFileSync(file, 'utf8'));
for (const source of previewSources) {
  assert.equal(/<iframe\b/i.test(source), false, 'audited-site preview must not render an iframe');
}
assert.match(previewSources[0], /CompactWebsitePreview/, 'shared visual system must use the compact preview');

console.log('Preview fallback smoke test passed.');
