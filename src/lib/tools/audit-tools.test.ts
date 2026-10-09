import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ResourceAuditPage } from '../audit/resource-types';
import { analyzeCrawlClutter, collectToolEvidence, generateSitemap, readToolEvidence, redactToolUrl, sitemapEligibility } from './audit-tools';

function page(url = 'https://example.com/a'): ResourceAuditPage {
  return { id: url, url, statusCode: 200, responseTimeMs: 10, pageSizeBytes: 100, title: 'A', metaDescription: '', h1: '',
    wordCount: 30, crawlDepth: 1, issueCount: 0, crawledAt: '2026-10-01T00:00:00Z',
    toolEvidence: { version: 1, contentType: 'text/html', metaRobots: '', xRobotsTag: '', robotsAllowed: true, redirected: false, securityHeaders: {} } };
}

test('sitemap requires retained facts, preserves query semantics, and never invents lastmod', () => {
  const first = page('https://example.com/A?sort=asc&lang=en');
  const result = generateSitemap([first, first, page('https://example.com/A?sort=desc&lang=en'), { ...page(), toolEvidence: undefined }], 'https://example.com');
  assert.equal(result.included, 2); assert.equal(result.excluded.length, 1);
  assert.match(result.xml, /sort=asc&amp;lang=en/); assert.doesNotMatch(result.xml, /lastmod|priority|changefreq/);
  for (const key of ['token', 'session', 'api_key']) assert.equal(sitemapEligibility(page(`https://example.com/?${key}=secret`), 'https://example.com').included, false);
  assert.throws(() => generateSitemap(Array.from({ length: 101 }, () => first), 'https://example.com'), /authorized complete export/);
});

test('page evidence is bounded and does not retain credentials, full headers or HTML', () => {
  const evidence = collectToolEvidence({ contentType: 'text/html', requestedUrl: 'https://example.com/a', finalUrl: 'https://example.com/a',
    robotsAllowed: true, headers: { 'set-cookie': 'secret', authorization: 'Bearer secret', 'x-robots-tag': '', 'last-modified': 'invalid' },
    parsed: { metaRobots: 'a'.repeat(5000), ogDescription: 'd'.repeat(10000), internalLinks: [{ href: '/b' }, { href: '/b#part' }] } });
  assert.ok(Buffer.byteLength(JSON.stringify(evidence)) < 4096);
  assert.equal(evidence.outgoingInternalLinks, 1); assert.equal(evidence.lastModified, undefined);
  assert.doesNotMatch(JSON.stringify(evidence), /secret|set-cookie|authorization/);
  assert.equal(readToolEvidence({ ...evidence, version: 9 }), undefined);
  assert.equal(readToolEvidence({ ...evidence, robotsAllowed: undefined }), undefined);
  for (const value of ['\u0000'.repeat(2000), '\u{1f600}'.repeat(2000), '\\"'.repeat(2000)]) {
    const multilingual = collectToolEvidence({ contentType: value, requestedUrl: 'https://example.com/', finalUrl: 'https://example.com/', robotsAllowed: true,
      headers: { 'x-robots-tag': value, 'content-security-policy-report-only': 'default-src self' },
      parsed: { metaRobots: value, ogTitle: value, ogDescription: value } });
    assert.ok(Buffer.byteLength(JSON.stringify(multilingual)) < 4096);
    assert.equal(multilingual.securityHeaders['content-security-policy-report-only'], true);
  }
});

test('clutter candidates do not equate filters, case or graph relationships', () => {
  const result = analyzeCrawlClutter([page('https://example.com/a?utm_source=x&session=private&sort=asc'), page('https://example.com/a?sort=desc'), page('https://example.com/A'), page('https://example.com/a/')]);
  assert.equal(result.trackingGroups.length, 1); assert.match(result.trackingGroups[0].url, /sort=asc/);
  assert.doesNotMatch(JSON.stringify(result), /private/); assert.equal(result.possiblePathVariants.length, 1);
  assert.equal(result.depth['1'], 4); assert.equal(result.sitemapDiscovery, 0);
  assert.doesNotMatch(redactToolUrl('https://user:pass@example.com/?email=a@b.com&sort=desc'), /user|pass|a@b/);
});
