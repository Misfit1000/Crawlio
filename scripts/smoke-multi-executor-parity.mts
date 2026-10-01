import assert from 'node:assert/strict';
import { extractWithRender } from '../src/audit-core/extractors/render-html-extractor';
import { buildSecurityIssues, mapAuditIssue, runAllChecksSafely } from '../src/audit-core/checks';
import { calculateTransparentAuditScore, toReportScoreRecord } from '../src/audit-core/scoring';
import { normalizeCrawlUrl, isSameDomain } from '../src/audit-core/url';
import { parseRobotsTxt, isBlockedByRobots } from '../src/audit-core/robots';
import { parseSitemapXml } from '../src/audit-core/sitemap';
import { parsePublicHttpUrl, isPrivateOrReservedAddress, isIP } from '../src/audit-core/adapters/ssrf-shared';

console.log('🧪 Starting Crawlio Multi-Executor Parity Smoke Test...\n');

// 1. SSRF Security Parity
console.log('1. Testing SSRF protection parity...');
assert.equal(isPrivateOrReservedAddress('127.0.0.1'), true, 'Loopback IPv4 must be blocked');
assert.equal(isPrivateOrReservedAddress('10.0.0.1'), true, 'Private 10.x must be blocked');
assert.equal(isPrivateOrReservedAddress('192.168.1.1'), true, 'Private 192.168.x must be blocked');
assert.equal(isPrivateOrReservedAddress('169.254.169.254'), true, 'AWS/Cloud metadata IP must be blocked');
assert.equal(isPrivateOrReservedAddress('::1'), true, 'IPv6 loopback must be blocked');
assert.equal(isPrivateOrReservedAddress('93.184.216.34'), false, 'Public IP must be allowed');
assert.equal(isIP('93.184.216.34'), 4, 'IPv4 detection');
assert.equal(isIP('2606:4700:4700::1111'), 6, 'IPv6 detection');

const parsedUrl = parsePublicHttpUrl('https://example.com/page?ref=abc#section');
assert.equal(parsedUrl.hostname, 'example.com');
assert.equal(parsedUrl.protocol, 'https:');
console.log('   ✅ SSRF parity assertions passed.\n');

// 2. URL Normalization Parity
console.log('2. Testing URL normalization parity...');
assert.equal(
  normalizeCrawlUrl('https://example.com/blog/?utm_source=twitter&utm_medium=social#comments'),
  'https://example.com/blog/',
  'Tracking parameters and hash fragments must be stripped'
);
assert.equal(
  normalizeCrawlUrl('/about', 'https://example.com/pricing'),
  'https://example.com/about',
  'Relative URLs must resolve against base URL'
);
assert.equal(isSameDomain('https://sub.example.com', 'https://example.com'), true);
assert.equal(isSameDomain('https://other.org', 'https://example.com'), false);
console.log('   ✅ URL normalization assertions passed.\n');

// 3. Robots.txt Parity
console.log('3. Testing robots.txt parsing parity...');
const sampleRobots = `
User-agent: *
Disallow: /admin/
Disallow: /private
Allow: /admin/public
Sitemap: https://example.com/sitemap.xml
`;
const rules = parseRobotsTxt(sampleRobots);
assert.equal(rules.sitemaps[0], 'https://example.com/sitemap.xml');
assert.equal(isBlockedByRobots('https://example.com/admin/dashboard', rules), true);
assert.equal(isBlockedByRobots('https://example.com/admin/public', rules), false);
assert.equal(isBlockedByRobots('https://example.com/blog', rules), false);
console.log('   ✅ Robots.txt rules assertions passed.\n');

// 4. Sitemap XML Parity
console.log('4. Testing Sitemap XML parsing parity...');
const sampleSitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
  <url><loc>https://example.com/about</loc></url>
  <url><loc>https://example.com/contact</loc></url>
</urlset>`;
const sitemapDoc = parseSitemapXml(sampleSitemapXml);
assert.equal(sitemapDoc.urls.length, 3);
assert.deepEqual(sitemapDoc.urls, [
  'https://example.com/',
  'https://example.com/about',
  'https://example.com/contact',
]);
console.log('   ✅ Sitemap parsing assertions passed.\n');

// 5. HTML Evidence Extraction Parity Fixture
console.log('5. Testing PageEvidence extraction parity...');
const fixtureHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Crawlio — Automated SEO Audits</title>
  <meta name="description" content="Discover technical and on-page SEO issues automatically with Crawlio audit engine." />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="https://crawlio.com/audit" />
  <link rel="icon" href="/favicon.ico" />
  <meta property="og:title" content="Crawlio SEO" />
  <meta property="og:description" content="Crawlio Audit Platform" />
  <meta property="og:image" content="https://crawlio.com/og.png" />
  <meta property="og:site_name" content="Crawlio" />
  <meta name="twitter:card" content="summary_large_image" />
  <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"WebSite","name":"Crawlio"}
  </script>
</head>
<body>
  <main>
    <h1>Modern SEO Audits</h1>
    <h2>Fast Crawling</h2>
    <h2>Comprehensive Checks</h2>
    <h3>Technical Signals</h3>
    <p>Crawlio helps teams monitor web vitals, crawlability, security, and structured data with dual executors.</p>
    <a href="/pricing">View Plans</a>
    <a href="https://external.example.com" rel="nofollow">External Reference</a>
    <img src="/logo.png" alt="Crawlio Logo" />
    <img src="/decorative.png" alt="" />
    <img src="/missing-alt.png" />
  </main>
</body>
</html>`;

const mockResponse = new Response(fixtureHtml, {
  status: 200,
  headers: {
    'content-type': 'text/html; charset=utf-8',
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'content-security-policy': "default-src 'self'",
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
  },
});

const extractionInput = {
  url: 'https://crawlio.com/audit',
  finalUrl: 'https://crawlio.com/audit',
  statusCode: 200,
  responseTimeMs: 145,
  pageSizeBytes: fixtureHtml.length,
  contentType: 'text/html; charset=utf-8',
  headers: {
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'content-security-policy': "default-src 'self'",
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
  },
  depth: 0,
  source: 'root',
};

const evidence = await extractWithRender(mockResponse, extractionInput);

assert.equal(evidence.title, 'Crawlio — Automated SEO Audits');
assert.equal(evidence.metaDescription, 'Discover technical and on-page SEO issues automatically with Crawlio audit engine.');
assert.equal(evidence.lang, 'en');
assert.equal(evidence.canonical, 'https://crawlio.com/audit');
assert.deepEqual(evidence.h1, ['Modern SEO Audits']);
assert.deepEqual(evidence.h2, ['Fast Crawling', 'Comprehensive Checks']);
assert.deepEqual(evidence.h3, ['Technical Signals']);
assert.equal(evidence.internalLinks.length, 1);
assert.equal(evidence.internalLinks[0].href, 'https://crawlio.com/pricing');
assert.equal(evidence.externalLinks.length, 1);
assert.equal(evidence.externalLinks[0].href, 'https://external.example.com/');
assert.equal(evidence.imageCount, 3);
assert.equal(evidence.imagesWithoutAlt, 1);
assert.equal(evidence.imagesWithEmptyAlt, 1);
assert.equal(evidence.ogTitle, 'Crawlio SEO');
assert.equal(evidence.twitterCard, 'summary_large_image');
assert.equal(evidence.jsonLd.length, 1);
assert(evidence.wordCount > 10, 'Body text word count must be measured');
console.log('   ✅ Evidence extraction assertions passed.\n');

// 6. Security Checks Parity
console.log('6. Testing Security Checks evaluation...');
const securityIssues = buildSecurityIssues({
  finalUrl: evidence.finalUrl,
  headers: evidence.headers,
  parsed: evidence,
});
// Since HTTPS, HSTS, CSP, X-Frame-Options, X-Content-Type-Options are present, missing items are referrer-policy & permissions-policy
assert(securityIssues.length <= 2, 'Compliant security headers should yield minimal issues');
assert(securityIssues.some(i => i.title.includes('Referrer-Policy')), 'Missing Referrer-Policy should be flagged');
console.log('   ✅ Security check assertions passed.\n');

// 7. SEO Checks Engine Parity
console.log('7. Testing SEO Checks Runner on extracted PageEvidence...');
const checkResult = runAllChecksSafely(evidence);
assert(checkResult.completedChecks > 10, 'All standard checks should run safely');
const seoIssues = checkResult.issues.map(i => mapAuditIssue(i, evidence.finalUrl));
console.log(`   ✅ Check runner completed ${checkResult.completedChecks} checks, found ${seoIssues.length} issues.\n`);

// 8. Canonical Scoring Parity
console.log('8. Testing Canonical Scoring Engine...');
const allIssues = [
  ...seoIssues,
  ...securityIssues.map(i => ({ ...i, id: `sec-${i.title}`, detectedAt: new Date().toISOString() })),
];
const scoreResult = calculateTransparentAuditScore({
  issues: allIssues as any,
  pages: [{
    id: 'page-1',
    url: evidence.finalUrl,
    statusCode: evidence.statusCode,
    responseTimeMs: evidence.responseTimeMs,
    pageSizeBytes: evidence.pageSizeBytes,
    title: evidence.title,
    metaDescription: evidence.metaDescription,
    h1: evidence.h1[0] || '',
    wordCount: evidence.wordCount,
    crawlDepth: 0,
    issueCount: allIssues.length,
    crawledAt: new Date().toISOString(),
  }],
});

assert(scoreResult.overall !== null && scoreResult.overall >= 0 && scoreResult.overall <= 100);
const reportScores = toReportScoreRecord(scoreResult);
assert.equal(reportScores.overall, scoreResult.overall);
console.log(`   ✅ Scoring calculated successfully: Overall = ${scoreResult.overall} (${scoreResult.grade})\n`);

// 9. Canonical Audit Runner End-to-End Test
console.log('9. Testing Canonical Audit Runner end-to-end orchestration...');
const { runCanonicalAudit } = await import('../src/audit-core/engine');
const { getCanonicalProfile } = await import('../src/audit-core/contracts');

const mockPagesMap = new Map<string, string>([
  [
    'https://crawlio.test/robots.txt',
    'User-agent: *\nAllow: /\nSitemap: https://crawlio.test/sitemap.xml',
  ],
  [
    'https://crawlio.test/sitemap.xml',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://crawlio.test/</loc></url><url><loc>https://crawlio.test/pricing</loc></url></urlset>',
  ],
  [
    'https://crawlio.test/',
    '<!DOCTYPE html><html><head><title>Home</title><meta name="description" content="Home page description."></head><body><main><h1>Welcome</h1><a href="/pricing">Pricing</a></main></body></html>',
  ],
  [
    'https://crawlio.test/pricing',
    '<!DOCTYPE html><html><head><title>Pricing</title><meta name="description" content="Pricing plans."></head><body><main><h1>Plans</h1><a href="/">Home</a></main></body></html>',
  ],
]);

const mockNetworkAdapter = {
  async fetchSafe(targetUrl: string) {
    const body = mockPagesMap.get(targetUrl) || '<html><head><title>404</title></head><body>Not Found</body></html>';
    const status = mockPagesMap.has(targetUrl) ? 200 : 404;
    return {
      finalUrl: targetUrl,
      status,
      durationMs: 40,
      bodyBytes: body.length,
      contentType: targetUrl.endsWith('.xml') ? 'application/xml' : targetUrl.endsWith('.txt') ? 'text/plain' : 'text/html',
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'strict-transport-security': 'max-age=31536000',
      },
      body,
    };
  },
  resolveUrl(inputUrl: string, base?: string) {
    return normalizeCrawlUrl(inputUrl, base);
  },
};

const writtenPages: any[] = [];
const writtenIssues: any[] = [];
let writtenReport: any = null;

const report = await runCanonicalAudit({
  auditId: 'test-audit-123',
  normalizedUrl: 'https://crawlio.test/',
  workerId: 'parity-runner-1',
  executorType: 'cloudflare',
  profile: getCanonicalProfile('quick'),
  network: mockNetworkAdapter,
  extractor: extractWithRender,
  writer: {
    async addPage(page) {
      const saved = { ...page, id: `p-${writtenPages.length + 1}` };
      writtenPages.push(saved);
      return saved;
    },
    async addIssue(issue) {
      writtenIssues.push(issue);
    },
    async addEvent() {},
    async writeProgress() {},
    async setFinalReport(r) {
      writtenReport = r;
    },
  },
});

assert(report !== null, 'Canonical audit runner must return a complete report');
assert.equal(report.scores.executor, 'cloudflare');
assert.equal(writtenPages.length, 2, 'Must have discovered and crawled 2 pages via sitemap and links');
assert(writtenPages.some(p => p.url === 'https://crawlio.test/'));
assert(writtenPages.some(p => p.url === 'https://crawlio.test/pricing'));
assert(report.scores.overall !== null);
console.log(`   ✅ End-to-end runner crawled ${writtenPages.length} pages, scored ${report.scores.overall}, stopReason: ${(report.scores.coverage as any)?.stopReason}\n`);

console.log('🎉 ALL MULTI-EXECUTOR PARITY CHECKS PASSED DETERMINISTICALLY!');
