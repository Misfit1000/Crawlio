import assert from 'node:assert/strict';
import { test } from 'node:test';
import { load } from 'cheerio';
import type { ResourceAuditPage } from '../audit/resource-types';
import { sitemapEntry } from '../tools/audit-tools';
import {
  EXPORT_CHUNK_SIZE, exportDisposition, exportManifest, exportSitemapHeader, exportSitemapOrigin,
  formatExportChunk, isScalableExportFormat, publicExportEvidence, type ExportJob,
} from './scalable-exports';

const origin = 'https://example.com';
const initial = { format: 'sitemap.xml', section: 'pages', cursor: null, part: 0 } as const;

function page(index = 0): ResourceAuditPage {
  return {
    id: `p${String(index).padStart(4, '0')}`, url: `${origin}/${index}`, statusCode: 200,
    responseTimeMs: 100, pageSizeBytes: 1000, title: 'Page', metaDescription: '', h1: '',
    wordCount: 50, crawlDepth: 1, issueCount: 0, crawledAt: '2020-01-01T00:00:00.000Z',
    toolEvidence: { version: 1, contentType: 'text/html; charset=utf-8', metaRobots: '',
      xRobotsTag: '', robotsAllowed: true, redirected: false, securityHeaders: {} },
  };
}

test('sitemap chunks use shared XML-safe entries and known lastmod, including epoch zero', () => {
  const escaped = { ...page(), url: `${origin}/?q=<tag>&quote="'` };
  const epoch = page(1);
  epoch.toolEvidence!.lastModified = 'Thu, 01 Jan 1970 00:00:00 GMT';
  const unknown = page(2);
  unknown.toolEvidence!.lastModified = 'not a date';
  const chunk = formatExportChunk(initial, { items: [escaped, epoch, unknown], nextCursor: null }, '', origin);
  assert.equal(chunk.text, exportSitemapHeader() + [escaped, epoch, unknown].map(item => sitemapEntry(item, origin)).join('') + '</urlset>\n');
  assert.match(chunk.text, /&lt;tag&gt;&amp;quote=&quot;&apos;/);
  const xml = load(chunk.text, { xmlMode: true });
  assert.equal(xml('urlset').attr('xmlns'), 'http://www.sitemaps.org/schemas/sitemap/0.9');
  assert.deepEqual(xml('loc').toArray().map(element => xml(element).text()), [escaped.url, epoch.url, unknown.url]);
  assert.deepEqual(xml('lastmod').toArray().map(element => xml(element).text()), ['1970-01-01T00:00:00.000Z']);
  assert.equal(xml('priority, changefreq').length, 0);
  assert.equal(chunk.text.includes(unknown.crawledAt), false, 'crawl time is not modification time');
  assert.deepEqual({ ...chunk, text: undefined }, { text: undefined, cursor: null, section: 'done', part: 1, ready: true });
});

test('sitemap rejects non-indexable evidence and every other origin', () => {
  const valid = page();
  const evidence = valid.toolEvidence!;
  const rejected: ResourceAuditPage[] = [
    { ...valid, statusCode: 404 }, { ...valid, statusCode: 302 },
    { ...valid, fetchStatus: 'failed' }, { ...valid, fetchStatus: 'blocked' },
    { ...valid, toolEvidence: undefined },
    { ...valid, toolEvidence: { ...evidence, contentType: 'application/pdf' } },
    { ...valid, toolEvidence: { ...evidence, metaRobots: 'index, noindex' } },
    { ...valid, toolEvidence: { ...evidence, xRobotsTag: 'googlebot: noindex' } },
    { ...valid, toolEvidence: { ...evidence, robotsAllowed: false } },
    { ...valid, toolEvidence: { ...evidence, robotsAllowed: null } },
    { ...valid, toolEvidence: { ...evidence, redirected: true } },
    { ...valid, canonicalUrl: `${origin}/other` },
    ...['http://example.com/0', 'https://www.example.com/0', 'https://example.com:8443/0',
      'https://other.example/0', 'https://user:password@example.com/0', `${origin}/0#fragment`, 'invalid URL']
      .map(url => ({ ...valid, url })),
  ];
  const chunk = formatExportChunk(initial, { items: [valid, ...rejected], nextCursor: null }, exportSitemapHeader(), origin);
  const xml = load(chunk.text, { xmlMode: true });
  assert.deepEqual(xml('loc').toArray().map(element => xml(element).text()), [valid.url]);
});

test('sitemap advances raw evidence cursors through rejected chunks and closes only once', () => {
  const pages = Array.from({ length: 137 }, (_, index) => ({ ...page(index), statusCode: index < 100 ? 404 : 200 }));
  let job: Pick<ExportJob, 'format' | 'section' | 'cursor' | 'part'> = { ...initial };
  const parts: string[] = [];
  for (let start = 0; start < pages.length; start += EXPORT_CHUNK_SIZE) {
    const items = pages.slice(start, start + EXPORT_CHUNK_SIZE);
    const nextCursor = start + EXPORT_CHUNK_SIZE < pages.length ? items.at(-1)!.id : null;
    const chunk = formatExportChunk(job, { items, nextCursor }, exportSitemapHeader(), origin);
    assert.deepEqual(chunk, formatExportChunk(job, { items, nextCursor }, exportSitemapHeader(), origin));
    assert.equal(chunk.ready, nextCursor === null);
    parts.push(chunk.text);
    job = { ...job, ...chunk };
  }
  assert.equal(parts.length, 3);
  assert.equal(parts[0], exportSitemapHeader());
  assert.equal(parts[1], '');
  assert.equal(parts[2].startsWith('<url>'), true);
  const text = parts.join('');
  assert.equal(text.split('<?xml').length - 1, 1);
  assert.equal(text.split('</urlset>').length - 1, 1);
  const xml = load(text, { xmlMode: true });
  assert.deepEqual(xml('loc').toArray().map(element => xml(element).text()), pages.slice(100).map(item => item.url));
  assert.equal(job.section, 'done');
  assert.equal(job.part, 3);
});

test('empty and exact-boundary sitemaps stay valid', () => {
  const empty = formatExportChunk(initial, { items: [], nextCursor: null }, '', origin);
  assert.equal(empty.text, exportSitemapHeader() + '</urlset>\n');
  assert.equal(empty.ready, true);
  const full = formatExportChunk(initial, { items: Array.from({ length: 50 }, (_, index) => page(index)), nextCursor: null }, '', origin);
  assert.equal(load(full.text, { xmlMode: true })('url').length, 50);
  assert.equal(full.ready, true);
  assert.equal(full.part, 1);
});

test('sitemap requires a selected HTTP origin, pages-only chunks, and bounded advancing cursors', () => {
  assert.equal(exportSitemapOrigin({ normalizedUrl: 'https://example.com:8443/path?q=1' }), 'https://example.com:8443');
  assert.equal(exportSitemapOrigin({ normalizedUrl: 'http://example.com/path' }), 'http://example.com');
  for (const normalizedUrl of ['', 'invalid', 'file:///example.com', 'https://user:password@example.com/']) {
    assert.throws(() => exportSitemapOrigin({ normalizedUrl }), /EXPORT_SITEMAP_ORIGIN_INVALID/);
  }
  assert.throws(() => formatExportChunk(initial, { items: [], nextCursor: null }), /requires an origin/);
  for (const section of ['issues', 'events', 'done'] as const) {
    assert.throws(() => formatExportChunk({ ...initial, section }, { items: [], nextCursor: null }, '', origin));
  }
  assert.throws(() => formatExportChunk(initial, { items: Array.from({ length: 51 }, () => page()), nextCursor: null }, '', origin), /Invalid export chunk/);
  assert.throws(() => formatExportChunk({ ...initial, cursor: 'p0000' }, { items: [page()], nextCursor: 'p0000' }, '', origin), /cursor did not advance/);
  assert.throws(() => formatExportChunk(initial, { items: [], nextCursor: 'p0000' }, '', origin), /cursor did not advance/);
});

test('sitemap manifest and download filename advertise XML without changing existing formats', () => {
  assert.equal(isScalableExportFormat('sitemap.xml'), true);
  assert.equal(isScalableExportFormat('sitemap'), false);
  assert.equal(isScalableExportFormat('xml'), false);
  const job = { ...initial, state: 'ready', section: 'done', part: 3,
    object_prefix: 'd6c53cd0-24bc-48a1-9521-5ba82cbb5706' } as ExportJob;
  assert.equal(exportManifest(job).contentType, 'application/xml; charset=utf-8');
  assert.equal(exportManifest(job).parts, 3);
  assert.equal(exportDisposition('example.com', 'sitemap.xml'), 'attachment; filename="crawlio-example.com-audit.sitemap.xml"');
  assert.equal(exportManifest({ ...job, format: 'json' }).contentType, 'application/json; charset=utf-8');
  assert.equal(exportManifest({ ...job, format: 'pages.csv' }).contentType, 'text/csv; charset=utf-8');
});

test('JSON pages include only bounded allowlisted tool evidence, never arbitrary nested metadata', () => {
  const item = {
    ...page(), secret: 'SECRET', metadata: { secret: 'SECRET' },
    toolEvidence: {
      ...page().toolEvidence!, contentType: 'a'.repeat(1000), metaRobots: 'b'.repeat(1000),
      xRobotsTag: 'c'.repeat(1000), lastModified: 'd'.repeat(1000), ogTitle: 'e'.repeat(1000),
      ogDescription: 'f'.repeat(1000), outgoingInternalLinks: 4,
      secret: 'SECRET', headers: { authorization: 'SECRET' },
      securityHeaders: { 'strict-transport-security': true, 'content-security-policy': false,
        'x-frame-options': 'SECRET', arbitrary: true, authorization: 'SECRET' },
    },
  };
  const exported = publicExportEvidence('pages', item);
  assert.deepEqual(exported.toolEvidence, {
    version: 1, contentType: 'a'.repeat(120), metaRobots: 'b'.repeat(512), xRobotsTag: 'c'.repeat(512),
    lastModified: undefined, ogTitle: 'e'.repeat(300), ogDescription: 'f'.repeat(600),
    robotsAllowed: true, redirected: false, outgoingInternalLinks: 4,
    securityHeaders: { 'strict-transport-security': true, 'content-security-policy': false },
  });
  assert.equal(JSON.stringify(exported).includes('SECRET'), false);
  const chunk = formatExportChunk({ format: 'json', section: 'pages', cursor: null, part: 0 },
    { items: [item], nextCursor: null }, '{"pages":[');
  assert.equal(JSON.parse(chunk.text + '],"events":[]}').pages[0].toolEvidence.outgoingInternalLinks, 4);
  assert.equal(publicExportEvidence('issues', item).toolEvidence, undefined);
  assert.equal(publicExportEvidence('events', item).toolEvidence, undefined);
  for (const toolEvidence of [undefined, null, [], { version: 2 }, 'SECRET']) {
    assert.equal(publicExportEvidence('pages', { ...page(), toolEvidence }).toolEvidence, undefined);
  }
  assert.equal((publicExportEvidence('pages', { ...page(), toolEvidence: { ...page().toolEvidence!, robotsAllowed: null } }).toolEvidence as Record<string, unknown>).robotsAllowed, null);
});
