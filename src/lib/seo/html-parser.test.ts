import assert from 'node:assert/strict';
import { test } from 'node:test';
import './checks/all-checks';
import { parseHtml } from './html-parser';
import { run as checkImages } from './checks/images';
import { run as checkIndexability } from './checks/indexability';
import { run as checkPerformance } from './checks/performance';
import { run as checkSchema } from './checks/schema';
import { run as checkSecurity } from './checks/security';
import { buildSecurityIssues } from '../../workers/audit-worker';

test('HTML fixtures produce bounded parser and check evidence without fetching', () => {
  const url = 'https://example.com/docs/start';
  const html = `<!doctype html><html><head>
    <link rel="canonical" href="../canonical">
    <link rel="STYLESHEET" href="http://cdn.example.com/style.css">
    <script type="application/ld+json">{"@context":"https://schema.org"}</script>
  </head><body>
    <p>Visible page content only.</p>
    <style>invisible style words must not count</style>
    <script>invisible script words must not count</script>
    <script type="application/ld+json">{"broken":}</script>
    <script type="application/ld+json"></script>
    <template>inert template words must not count</template>
    <script src = HTTP://cdn.example.com/app.js></script>
    <img src="http://cdn.example.com/photo.jpg" alt="">
    <img src="/missing.jpg"><img src="/named.jpg" alt="A photograph"><img alt="   ">
    <a href="/inside">Root</a> <a href="../relative">Relative</a>
    <a href="//outside.example/path" rel="nofollow">External</a>
    <a href="HTTPS://example.com/upper">Uppercase</a>
    <a href="mailto:a@example.com">Mail</a> <a href="tel:123">Phone</a>
    <a href=" JAVASCRIPT:alert(1)">Script</a> <a href="data:text/plain,hello">Data</a>
    <a href="ftp://example.com/file">Ftp</a> <a href="http://[invalid">Invalid</a>
    <a href="http://example.com/navigation">Navigation</a>
    <form action = HTTP://example.com/submit method="get"></form>
    <form action="//example.com/secure"></form><form action=""></form><form></form>
    <form action="javascript:alert(1)"></form><form method="dialog" action="http://example.com/dialog"></form>
  </body></html>`;
  const parsed = parseHtml(html, url);
  assert.equal(parsed.wordCount, 15);
  assert.equal(parsed.imageCount, 4);
  assert.equal(parsed.imagesWithoutAlt, 1);
  assert.equal(parsed.imagesWithEmptyAlt, 2);
  assert.deepEqual(parsed.internalLinks.map((link) => link.href), [
    'https://example.com/inside', 'https://example.com/relative',
    'https://example.com/upper', 'http://example.com/navigation',
  ]);
  assert.equal(parsed.internalLinks[1].rawHref, '../relative');
  assert.deepEqual(parsed.externalLinks, [{
    href: 'https://outside.example/path', rawHref: '//outside.example/path', text: 'External', rel: 'nofollow',
  }]);
  assert.equal(parsed.canonical, 'https://example.com/canonical');
  assert.equal(parsed.canonicalRaw, '../canonical');
  assert.equal(checkIndexability(parsed)[0].id, 'relative-canonical');
  assert.equal(checkIndexability({ canonical: 'https://example.com/canonical' }).length, 0);
  assert.equal(checkImages(parsed)[0].id, 'missing-alt-text');
  assert.equal(checkImages(parseHtml('<img alt=""><img alt=" ">', url)).length, 0);
  const schemaIssues = checkSchema(parsed);
  assert.equal(schemaIssues.length, 1);
  assert.equal(schemaIssues[0].id, 'invalid-json-ld');
  assert.match(schemaIssues[0].evidence || '', /script\(s\): 2, 3/);
  assert.equal(checkSchema({ jsonLd: ['{}', '[]', 'null'] }).length, 0);
  assert.equal(checkSchema({ jsonLd: [] })[0].id, 'json-ld-missing');

  assert.deepEqual(parsed.insecureResourceUrls?.sort(), [
    'http://cdn.example.com/app.js', 'http://cdn.example.com/photo.jpg', 'http://cdn.example.com/style.css',
  ]);
  assert.deepEqual(parsed.insecureFormActionUrls, ['http://example.com/submit']);
  const page = { url, finalUrl: url, statusCode: 200, responseTimeMs: 100, pageSizeBytes: 1000, headers: {}, contentType: 'text/html', html, parsed };
  assert(buildSecurityIssues(page).some((issue) => issue.title === 'Mixed content references detected'));
  const formIssue = buildSecurityIssues(page).find((issue) => issue.title === 'Insecure form action detected');
  assert.match(formIssue?.evidence || '', /http:\/\/example\.com\/submit/);
  assert.doesNotMatch(formIssue?.evidence || '', /posts/);
  const navigationHtml = '<a href="http://outside.example/">Navigation</a><link rel="canonical" href="http://example.com/">';
  assert(!buildSecurityIssues({ ...page, html: navigationHtml, parsed: null }).some((issue) => issue.title === 'Mixed content references detected'));
  const withBase = parseHtml('<base href="http://assets.other.test/"><img src="photo.jpg"><a href="relative">Relative</a><form action="submit"></form><form action=""></form>', url);
  assert.deepEqual(withBase.insecureResourceUrls, ['http://assets.other.test/photo.jpg']);
  assert.deepEqual(withBase.insecureFormActionUrls, ['http://assets.other.test/submit']);
  assert.equal(withBase.internalLinks.length, 0);
  assert.equal(withBase.externalLinks[0].href, 'http://assets.other.test/relative');
  assert.equal(parseHtml(html, 'http://example.com/').insecureResourceUrls?.length, 0);
  assert.equal(parseHtml('<link rel="canonical" href="//example.com/page">', url).canonical, 'https://example.com/page');
  assert.equal(checkIndexability(parseHtml('<link rel="canonical" href="HTTPS://example.com/page">', url)).length, 0);
  assert.equal(parseHtml('<link rel="canonical" href="javascript:alert(1)">', url).canonical, '');
  assert.equal(parseHtml('<a href="https://example.com/about">About</a>', 'https://www.example.com/').internalLinks.length, 1, 'Link classification must match the crawler domain boundary.');

  assert.equal(checkPerformance({ loadTimeMs: 1500, pageSizeBytes: 1_000_000 }).length, 0);
  const performanceIssues = checkPerformance({ responseTimeMs: 1501, pageSizeBytes: 1_000_001 });
  assert.deepEqual(performanceIssues.map((issue) => issue.id), ['slow-server-response', 'large-page-size']);
  assert.match(performanceIssues[0].evidence || '', /full HTML request duration/);
  assert.doesNotMatch(performanceIssues[0].description, /TTFB is over 600ms/);
  assert.equal(checkPerformance({ loadTimeMs: 1501 })[0].id, 'slow-server-response');
  assert.equal(checkPerformance({ responseTimeMs: Infinity, pageSizeBytes: Infinity }).length, 0);
  assert.equal(checkSecurity({ url, headers: { 'Strict-Transport-Security': 'max-age=31536000' } }).length, 0);
  assert.equal(checkSecurity({ url: 'http://example.com/', headers: {} }).length, 0);
  assert.equal(checkSecurity({ url }).length, 0);
  assert.equal(checkSecurity({ url, headers: {} })[0].id, 'missing-hsts');
  assert.deepEqual(checkImages({ fakeCondition: true }), []);
  assert.deepEqual(checkPerformance({ fakeCondition: true }), []);
  assert.deepEqual(checkSchema({ fakeCondition: true }), []);
  assert.deepEqual(checkIndexability({ fakeCondition: true, canonical: url }), []);
  assert.deepEqual(checkSecurity({ fakeCondition: true, url }), []);
});
