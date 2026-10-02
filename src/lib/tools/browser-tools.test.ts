import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ResourceAuditPage } from '../audit/resource-types';
import {
  buildHeaderRemediation, buildMetadataPreview, buildStructuredData, HEADER_TARGETS,
  headerFindingsFromPage, normalizePreviewMetadata, OBSERVED_HEADER_NAMES,
  PREVIEW_FIELD_LIMITS, previewMetadataFromPage, safeHttpUrl, SCHEMA_TYPES,
  structuredDataTemplate, TOOL_LIMITS, type ObservedHeaderFinding,
} from './browser-tools';

const page = (overrides: Partial<ResourceAuditPage> = {}): ResourceAuditPage => ({
  id: 'page-1', url: 'https://example.com/Article?sort=Latest&lang=en', statusCode: 200,
  responseTimeMs: 100, pageSizeBytes: 500, title: 'Real title', metaDescription: 'Real description',
  h1: '', wordCount: 100, crawlDepth: 1, issueCount: 0, crawledAt: '2026-10-02T00:00:00Z', ...overrides,
});
const evidence = (securityHeaders: Record<string, boolean> = {}) => ({
  version: 1 as const, contentType: 'text/html', metaRobots: '', xRobotsTag: '', robotsAllowed: null,
  redirected: false, securityHeaders,
});
const article = (extra: Record<string, unknown> = {}) => JSON.stringify({
  '@context': 'https://schema.org', '@type': 'Article', headline: 'An actual headline', ...extra,
});
const absent = (...headers: ObservedHeaderFinding['header'][]): ObservedHeaderFinding[] => headers.map(header => ({ header, state: 'absent' }));
const valid = (input: string) => {
  const result = buildStructuredData(input);
  if (result.ok === false) assert.fail(result.error);
  assert.equal(result.ok, true);
  return result;
};
const invalid = (input: string, pattern?: RegExp) => {
  const result = buildStructuredData(input);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('Unexpected valid schema');
  if (pattern) assert.match(result.error, pattern);
};

test('page projection never fabricates missing OG values or uses canonical/screenshot fallbacks', () => {
  const original = page({ canonicalUrl: 'https://example.com/canonical', screenshotUrl: 'https://images.example.com/screenshot.jpg' });
  const before = JSON.stringify(original);
  const metadata = previewMetadataFromPage(original);
  assert.equal(metadata.url, original.url);
  assert.equal(metadata.title, original.title);
  assert.equal(metadata.description, original.metaDescription);
  assert.equal(metadata.ogTitle, '');
  assert.equal(metadata.ogDescription, '');
  assert.equal(metadata.ogUrl, '');
  assert.equal(metadata.ogImage, '');
  const preview = buildMetadataPreview(metadata);
  assert.equal(preview.social.title, '');
  assert.equal(preview.social.url, null);
  assert.equal(preview.social.siteName, '');
  assert.equal(JSON.stringify(original), before);
});

test('versioned retained OG metadata and images are projected as data only', () => {
  const original = page({ siteName: 'Actual site', openGraphImage: 'https://example.com/og.png',
    toolEvidence: { ...evidence(), ogTitle: 'Actual OG title', ogDescription: 'Actual OG description' } });
  const metadata = previewMetadataFromPage(original);
  assert.equal(metadata.ogTitle, 'Actual OG title');
  assert.equal(metadata.ogDescription, 'Actual OG description');
  assert.equal(metadata.ogImage, original.openGraphImage);
  assert.equal(buildMetadataPreview(metadata).social.imageUrl, original.openGraphImage);
  assert.equal(previewMetadataFromPage(page({ toolEvidence: { ...original.toolEvidence, version: 2 } as never })).ogTitle, '');
});

test('preview normalization is bounded, idempotent, immutable, and never truncates a URL into different evidence', () => {
  const input = { title: 'x'.repeat(1000), description: 'd'.repeat(10000), siteName: 'n'.repeat(1000),
    url: `https://example.com/${'a'.repeat(3000)}`, ogTitle: ' OG title ', ogDescription: ' Desc ' };
  const metadata = normalizePreviewMetadata(input);
  for (const [key, limit] of Object.entries(PREVIEW_FIELD_LIMITS)) assert.ok(metadata[key].length <= limit);
  assert.equal(metadata.url, '');
  assert.deepEqual(normalizePreviewMetadata(metadata), metadata);
  assert.deepEqual(buildMetadataPreview(metadata), buildMetadataPreview(metadata));
  assert.equal(input.ogTitle, ' OG title ');
  assert.equal(buildMetadataPreview(input).warnings.length, 1);
});

test('HTTP URL validation preserves meaningful query/path casing and rejects unsafe schemes', () => {
  assert.equal(safeHttpUrl('https://example.com/Path?Order=DESC&lang=en#section'), 'https://example.com/Path?Order=DESC&lang=en#section');
  assert.equal(safeHttpUrl('http://localhost:8080/page'), 'http://localhost:8080/page');
  for (const value of ['javascript:alert(1)', 'data:image/png,x', 'ftp://example.com/a', '//example.com/a',
    '/relative', 'https:example.com', 'https://user:secret@example.com', 'https://example.com/a b',
    'https://example.com/\npath', 'https://example.com\\path', '\nhttps://example.com/', '', `https://example.com/${'x'.repeat(2048)}`]) {
    assert.equal(safeHttpUrl(value), null, value);
  }
  assert.equal(buildMetadataPreview({ url: 'javascript:alert(1)', ogImage: 'data:image/png,x' }).warnings.length, 2);
});

test('blank schema templates supply structure but never invent facts', () => {
  for (const type of SCHEMA_TYPES) {
    const input = structuredDataTemplate(type);
    const schema = JSON.parse(input);
    assert.equal(schema['@type'], type);
    invalid(input, /real facts/);
    assert.doesNotMatch(input, /datePublished|price|rating|author|publisher/);
  }
  assert.throws(() => structuredDataTemplate('Product' as never), /Unsupported/);
});

test('Article preserves real author, publisher, dates, image URLs and page URL without inventing optional facts', () => {
  const input = article({
    author: [{ '@type': 'Person', name: 'Real author', url: 'https://example.com/author' }],
    publisher: { '@type': 'Organization', name: 'Real publisher', logo: 'https://example.com/logo.png' },
    image: ['https://example.com/image.jpg'], url: 'https://example.com/Article?lang=en',
    mainEntityOfPage: 'https://example.com/Article?lang=en', datePublished: '2024-02-29',
    dateModified: '2026-10-02T10:20:30+05:45',
  });
  assert.deepEqual(JSON.parse(valid(input).json), JSON.parse(input));
  assert.deepEqual(Object.keys(JSON.parse(valid(article()).json)).sort(), ['@context', '@type', 'headline']);
});

test('Organization and FAQ use only supplied real facts', () => {
  const organization = { '@context': 'https://schema.org', '@type': 'Organization', name: 'Actual organization',
    url: 'https://example.com', sameAs: ['https://example.org/about'], logo: 'https://example.com/logo.png' };
  assert.deepEqual(JSON.parse(valid(JSON.stringify(organization)).json), organization);
  const faq = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [
    { '@type': 'Question', name: 'Actual question?', acceptedAnswer: { '@type': 'Answer', text: 'Actual answer.' } },
  ] };
  assert.deepEqual(JSON.parse(valid(JSON.stringify(faq)).json), faq);
  invalid(JSON.stringify({ ...faq, mainEntity: [] }), /1-20/);
  invalid(JSON.stringify({ ...faq, mainEntity: Array(21).fill(faq.mainEntity[0]) }), /1-20/);
  invalid(JSON.stringify({ ...faq, mainEntity: [{ ...faq.mainEntity[0], acceptedAnswer: { '@type': 'Answer', text: ' ' } }] }), /real facts/);
});

test('JSON-only parsing rejects JavaScript, HTML, graphs, arrays, unsupported types and custom contexts', () => {
  for (const input of ['({headline:"x"})', '<script type="application/ld+json">{}</script>', '{"headline": "x",}',
    'null', '[]', 'true', '{}', JSON.stringify({ '@context': 'https://evil.example/context', '@type': 'Article', headline: 'x' }),
    JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: 'x' }),
    JSON.stringify({ '@context': { custom: 'https://schema.org' }, '@type': 'Article', headline: 'x' })]) invalid(input);
  invalid(article({ '@graph': [] }), /unsupported field/);
});

test('JSON-LD serialization escapes script termination and is idempotent with unchanged facts', () => {
  const headline = '</script><img src=x onerror=alert(1)><!--\u2028\u2029';
  const first = valid(article({ headline }));
  assert.doesNotMatch(first.json, /<|\u2028|\u2029/);
  assert.equal(JSON.parse(first.json).headline, headline);
  assert.equal((first.embed.match(/<script/g) || []).length, 1);
  assert.equal((first.embed.match(/<\/script>/g) || []).length, 1);
  assert.match(first.json, /\\u003c/);
  assert.deepEqual(valid(first.json), first);
  assert.equal(valid(article({ headline: 'A', description: 'B' })).json, valid(JSON.stringify({ description: 'B', headline: 'A', '@type': 'Article', '@context': 'https://schema.org' })).json);
});

test('unsupported prices, ratings, review fields and malformed nested structures are rejected', () => {
  for (const extra of [{ price: '1' }, { aggregateRating: { ratingValue: 5 } }, { offers: [] }, { review: [] },
    { author: { '@type': 'Person', name: '' } }, { author: [] }, { publisher: { '@type': 'Organization' } },
    { publisher: { '@type': 'Organization', name: 'Real', rating: 5 } }, { image: [] }]) invalid(article(extra));
});

test('all supported root and nested URL fields reject non-HTTP schemes and credentials', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,<b>', '//example.com/', 'https://user:password@example.com/']) {
    for (const key of ['url', '@id', 'mainEntityOfPage']) invalid(article({ [key]: value }), /HTTP\/HTTPS/);
    invalid(article({ image: ['https://example.com/valid.png', value] }), /HTTP\/HTTPS/);
    invalid(article({ author: { '@type': 'Person', name: 'Actual', url: value } }), /HTTP\/HTTPS/);
    invalid(article({ publisher: { '@type': 'Organization', name: 'Actual', logo: value } }), /HTTP\/HTTPS/);
    invalid(JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Actual', sameAs: [value] }), /HTTP\/HTTPS/);
  }
});

test('date validation rejects invalid calendar/time values and does not inject current dates', () => {
  for (const value of ['2023-02-29', '2026-04-31', '2026-13-01', 'now', '2026-10-02T10:00:00', '2026-10-02T24:00:00Z', '2026-10-02T10:61:00Z']) {
    invalid(article({ datePublished: value }));
  }
  valid(article({ datePublished: '2024-02-29T12:00:00Z' }));
  assert.equal(Object.hasOwn(JSON.parse(valid(article()).json), 'datePublished'), false);
});

test('input bytes, strings, depth, arrays, fields, node count and finite numbers are bounded', () => {
  invalid(' '.repeat(TOOL_LIMITS.jsonBytes + 1), /bytes/);
  invalid(article({ headline: 'a'.repeat(TOOL_LIMITS.jsonString + 1) }), /characters/);
  invalid(article({ headline: '\u4e00'.repeat(6000), description: '\u4e00'.repeat(6000) }), /bytes/);
  invalid(article({ author: Array(TOOL_LIMITS.jsonArray + 1).fill(null) }), /arrays/);
  let deep: unknown = 'leaf';
  for (let index = 0; index < TOOL_LIMITS.jsonDepth; index++) deep = { child: deep };
  invalid(article({ extra: deep }), /depth/);
  invalid(article(Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`field${index}`, index]))), /fields/);
  invalid(article({ extra: Array.from({ length: 50 }, () => Array(50).fill(0)) }), /values/);
  invalid('{"@context":"https://schema.org","@type":"Article","headline":"x","number":1e400}', /finite/);
});

test('safe serialization output is bounded after escaping expansion', () => {
  invalid(article({ headline: '<'.repeat(8000), description: '<'.repeat(8000), author: { '@type': 'Person', name: '<'.repeat(8000) } }), /Output exceeds/);
  const output = valid(article({ headline: '<'.repeat(8000) }));
  assert.ok(new TextEncoder().encode(output.embed).length <= TOOL_LIMITS.outputBytes);
});

test('prototype-related keys are rejected anywhere without polluting objects', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    invalid(`{"@context":"https://schema.org","@type":"Article","headline":"Real","author":{"${key}":{"polluted":true}}}`, /Unsafe/);
  }
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('retained header projection distinguishes absent, present and unmeasured, with case-insensitive names', () => {
  assert.deepEqual(headerFindingsFromPage(page()), []);
  const original = page({ toolEvidence: evidence({ 'strict-transport-security': false, 'X-Content-Type-Options': true }) });
  const before = JSON.stringify(original);
  assert.deepEqual(headerFindingsFromPage(original), [
    { header: 'Strict-Transport-Security', state: 'absent' }, { header: 'X-Content-Type-Options', state: 'present' },
  ]);
  assert.equal(headerFindingsFromPage(original).some(item => item.header === 'Content-Security-Policy'), false);
  assert.equal(JSON.stringify(original), before);
});

test('unknown, present and unselected headers never produce recommendations on any target', () => {
  for (const target of HEADER_TARGETS) {
    assert.equal(buildHeaderRemediation(target, []).snippet, '');
    assert.equal(buildHeaderRemediation(target, OBSERVED_HEADER_NAMES.map(header => ({ header, state: 'unknown' }))).snippet, '');
    assert.equal(buildHeaderRemediation(target, OBSERVED_HEADER_NAMES.map(header => ({ header, state: 'present' }))).snippet, '');
  }
});

test('HSTS needs explicit HTTPS confirmation and has neither includeSubDomains nor preload', () => {
  for (const target of HEADER_TARGETS) {
    assert.equal(buildHeaderRemediation(target, absent('Strict-Transport-Security')).snippet, '');
    const result = buildHeaderRemediation(target, absent('Strict-Transport-Security'), { httpsConfirmed: true });
    assert.equal(result.headers[0].value, 'max-age=300');
    assert.doesNotMatch(result.snippet, /includeSubDomains|preload/);
    assert.equal(result.headers.length, 1);
  }
});

test('CSP remains report-only and requires both policy headers to be observed absent', () => {
  for (const target of HEADER_TARGETS) {
    assert.equal(buildHeaderRemediation(target, absent('Content-Security-Policy')).snippet, '');
    for (const state of ['present', 'unknown'] as const) {
      assert.equal(buildHeaderRemediation(target, [...absent('Content-Security-Policy'), { header: 'Content-Security-Policy-Report-Only', state }]).snippet, '');
      assert.equal(buildHeaderRemediation(target, [...absent('Content-Security-Policy-Report-Only'), { header: 'Content-Security-Policy', state }]).snippet, '');
    }
    const result = buildHeaderRemediation(target, absent('Content-Security-Policy', 'Content-Security-Policy-Report-Only'));
    assert.equal(result.headers.length, 1);
    assert.equal(result.headers[0].key, 'Content-Security-Policy-Report-Only');
    assert.doesNotMatch(result.snippet, /Content-Security-Policy(?:\s|"|:)/);
  }
});

test('conflicts fail closed, duplicates are deduplicated, and generation is deterministic and immutable', () => {
  const observations = absent('Referrer-Policy', 'X-Content-Type-Options', 'Referrer-Policy');
  const before = JSON.stringify(observations);
  for (const target of HEADER_TARGETS) {
    const first = buildHeaderRemediation(target, observations);
    assert.equal(first.headers.length, 2);
    assert.deepEqual(buildHeaderRemediation(target, [...observations].reverse()), first);
    assert.deepEqual(buildHeaderRemediation(target, observations), first);
    const conflicted = buildHeaderRemediation(target, [...observations, { header: 'Referrer-Policy', state: 'present' }]);
    assert.equal(conflicted.headers.length, 1);
    assert.equal(conflicted.headers[0].key, 'X-Content-Type-Options');
    assert.match(conflicted.warnings.join(' '), /conflicting/);
    assert.equal(buildHeaderRemediation(target, [...absent('Strict-Transport-Security'), { header: 'Strict-Transport-Security', state: 'unknown' }], { httpsConfirmed: true }).snippet, '');
  }
  assert.equal(JSON.stringify(observations), before);
});

test('deployment output matches each target surface and never includes arbitrary finding text', () => {
  const observations = absent('X-Content-Type-Options');
  assert.match(buildHeaderRemediation('Nginx', observations).snippet, /add_header X-Content-Type-Options "nosniff" always;/);
  assert.match(buildHeaderRemediation('Apache', observations).snippet, /Header always setifempty X-Content-Type-Options "nosniff"/);
  assert.match(buildHeaderRemediation('Caddy', observations).snippet, /header \?X-Content-Type-Options "nosniff"/);
  const vercel = JSON.parse(buildHeaderRemediation('Vercel', observations).snippet);
  assert.deepEqual(vercel.headers, [{ source: '/(.*)', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }] }]);
  assert.throws(() => buildHeaderRemediation('Other' as never, observations), /Unsupported/);
  assert.throws(() => buildHeaderRemediation('Nginx', [{ header: 'X-Evil\r\nInjected' as never, state: 'absent' }]), /Invalid/);
  assert.throws(() => buildHeaderRemediation('Nginx', [{ header: 'Referrer-Policy', state: 'missing' as never }]), /Invalid/);
  assert.throws(() => buildHeaderRemediation('Nginx', Array(33).fill(observations[0])), /at most/);
  assert.throws(() => headerFindingsFromPage(page({ toolEvidence: evidence(Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`header${index}`, false]))) })), /at most/);
});
