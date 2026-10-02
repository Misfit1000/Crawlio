import assert from 'node:assert/strict';
import { test } from 'node:test';
import { load } from 'cheerio';
import type { ResourceAuditPage } from '../lib/audit/resource-types';
import { exportPartPath, exportSitemapHeader, exportSitemapOrigin, type ExportJob } from '../lib/report/scalable-exports';
import { processExportChunk, type ExportChunkDependencies } from './scalable-export-worker';

const origin = 'https://example.com';
const initial: ExportJob = {
  id: 'export-job', audit_id: 'audit', format: 'sitemap.xml', state: 'running', owner: 'claim-one',
  lease_until: '2024-01-01T00:02:00.000Z', cursor: null, section: 'pages', part: 0,
  object_prefix: 'd6c53cd0-24bc-48a1-9521-5ba82cbb5706', error: null,
  created_at: '2024-01-01T00:00:00.000Z', expires_at: '2024-01-02T00:00:00.000Z',
};

function page(index: number): ResourceAuditPage {
  return {
    id: `p${String(index).padStart(4, '0')}`, url: `${origin}/${index}`, statusCode: 200,
    responseTimeMs: 100, pageSizeBytes: 1000, title: 'Page', metaDescription: '', h1: '',
    wordCount: 50, crawlDepth: 1, issueCount: 0, crawledAt: '2020-01-01T00:00:00.000Z',
    toolEvidence: { version: 1, contentType: 'text/html', metaRobots: '', xRobotsTag: '',
      robotsAllowed: true, redirected: false, securityHeaders: {},
      lastModified: index === 0 ? '1970-01-01T00:00:00.000Z' : undefined },
  };
}

function paginate(items: ResourceAuditPage[], cursor: string | null) {
  const start = cursor ? items.findIndex(item => item.id === cursor) + 1 : 0;
  const batch = items.slice(start, start + 50);
  return { items: batch, nextCursor: start + 50 < items.length ? batch.at(-1)!.id : null };
}

test('sitemap worker reads one bounded pages chunk and one audit origin per invocation', async () => {
  const pages = Array.from({ length: 137 }, (_, index) => page(index));
  let job = { ...initial };
  let reads = 0, headers = 0, audits = 0, checks = 0, commits = 0;
  const objects = new Map<string, string>();
  const dependencies: ExportChunkDependencies = {
    header: async item => { headers++; assert.equal(item.part, 0); return exportSitemapHeader(); },
    origin: async () => {
      audits++;
      const audit = { normalizedUrl: `${origin}/selected-path`, finalUrl: 'https://www.example.com/', hostname: 'www.example.com' };
      return exportSitemapOrigin(audit);
    },
    check: async item => { checks++; assert.equal(item.owner, job.owner); },
    read: async item => {
      reads++;
      assert.equal(item.section, 'pages');
      const batch = paginate(pages, item.cursor);
      assert.ok(batch.items.length <= 50);
      return batch;
    },
    upload: async (item, text) => { objects.set(exportPartPath(item.object_prefix, item.part), text); },
    commit: async (item, chunk) => {
      commits++;
      assert.equal(item.part, job.part);
      job = { ...job, part: chunk.part, cursor: chunk.cursor, section: chunk.section, state: chunk.ready ? 'ready' : 'running' };
    },
  };
  const first = await processExportChunk(job, dependencies);
  assert.equal(reads, 1);
  assert.equal(commits, 1);
  assert.equal(first.ready, false);
  assert.equal(job.cursor, 'p0049');
  await processExportChunk(job, dependencies);
  assert.equal(job.cursor, 'p0099');
  const last = await processExportChunk(job, dependencies);
  assert.equal(last.ready, true);
  assert.equal(job.section, 'done');
  assert.deepEqual({ reads, headers, audits, checks, commits }, { reads: 3, headers: 1, audits: 3, checks: 6, commits: 3 });
  assert.deepEqual([...objects.keys()], [0, 1, 2].map(part => exportPartPath(initial.object_prefix, part)));
  const xml = load([...objects.values()].join(''), { xmlMode: true });
  assert.deepEqual(xml('loc').toArray().map(element => xml(element).text()), pages.map(item => item.url));
  assert.equal(xml('lastmod').text(), '1970-01-01T00:00:00.000Z');
});

test('crash after upload reuses the same deterministic sitemap part across a new lease claim', async () => {
  const pages = Array.from({ length: 51 }, (_, index) => page(index));
  let checkpoint = { ...initial };
  let failCommit = true, uploads = 0, reads = 0;
  const objects = new Map<string, string>();
  const dependencies: ExportChunkDependencies = {
    header: async () => exportSitemapHeader(), origin: async () => origin,
    check: async item => {
      assert.equal(item.owner, checkpoint.owner);
      assert.equal(item.lease_until, checkpoint.lease_until);
      assert.equal(item.part, checkpoint.part);
    },
    read: async item => { reads++; return paginate(pages, item.cursor); },
    upload: async (item, text) => {
      uploads++;
      const path = exportPartPath(item.object_prefix, item.part);
      if (objects.has(path)) assert.equal(objects.get(path), text, 'immutable retry must be byte-identical');
      else objects.set(path, text);
    },
    commit: async (_item, chunk) => {
      if (failCommit) throw new Error('crash after upload');
      checkpoint = { ...checkpoint, part: chunk.part, section: chunk.section, cursor: chunk.cursor };
    },
  };
  await assert.rejects(processExportChunk(checkpoint, dependencies), /crash after upload/);
  assert.equal(checkpoint.part, 0);
  assert.equal(checkpoint.cursor, null);
  assert.equal(objects.size, 1);
  const stale = { ...checkpoint };
  checkpoint = { ...checkpoint, owner: 'claim-two', lease_until: '2024-01-01T00:04:00.000Z' };
  failCommit = false;
  await processExportChunk(checkpoint, dependencies);
  assert.equal(checkpoint.part, 1);
  assert.equal(objects.size, 1);
  await assert.rejects(processExportChunk(stale, dependencies));
  assert.equal(uploads, 2);
  assert.equal(reads, 2);
  await processExportChunk(checkpoint, dependencies);
  assert.equal(checkpoint.part, 2);
  assert.equal(checkpoint.section, 'done');
  assert.equal(objects.size, 2);
  assert.equal(load([...objects.values()].join(''), { xmlMode: true })('url').length, 51);
});

test('rejected-only sitemap chunks still commit their raw cursor and empty parts', async () => {
  const pages = Array.from({ length: 101 }, (_, index) => ({ ...page(index), statusCode: 404 }));
  let checkpoint = { ...initial };
  const parts: string[] = [];
  const dependencies: ExportChunkDependencies = {
    header: async () => exportSitemapHeader(), origin: async () => origin, check: async () => {},
    read: async item => paginate(pages, item.cursor),
    upload: async (_item, text) => { parts.push(text); },
    commit: async (_item, chunk) => { checkpoint = { ...checkpoint, part: chunk.part, section: chunk.section, cursor: chunk.cursor }; },
  };
  await processExportChunk(checkpoint, dependencies);
  assert.equal(checkpoint.cursor, 'p0049');
  await processExportChunk(checkpoint, dependencies);
  assert.equal(checkpoint.cursor, 'p0099');
  const last = await processExportChunk(checkpoint, dependencies);
  assert.deepEqual(parts, [exportSitemapHeader(), '', '</urlset>\n']);
  assert.equal(last.ready, true);
  assert.equal(checkpoint.part, 3);
});

test('lease loss before upload prevents sitemap writes and checkpoint advancement', async () => {
  let checks = 0, reads = 0, uploads = 0, commits = 0;
  const dependencies: ExportChunkDependencies = {
    header: async () => exportSitemapHeader(), origin: async () => origin,
    check: async () => { if (++checks === 2) throw new Error('EXPORT_LEASE_LOST'); },
    read: async () => { reads++; return { items: [page(0)], nextCursor: null }; },
    upload: async () => { uploads++; }, commit: async () => { commits++; },
  };
  await assert.rejects(processExportChunk(initial, dependencies), /EXPORT_LEASE_LOST/);
  assert.deepEqual({ checks, reads, uploads, commits }, { checks: 2, reads: 1, uploads: 0, commits: 0 });
});

test('failed upload does not commit a sitemap checkpoint', async () => {
  let commits = 0;
  await assert.rejects(processExportChunk(initial, {
    header: async () => exportSitemapHeader(), origin: async () => origin, check: async () => {},
    read: async () => ({ items: [page(0)], nextCursor: null }),
    upload: async () => { throw new Error('storage unavailable'); }, commit: async () => { commits++; },
  }), /storage unavailable/);
  assert.equal(commits, 0);
});

test('sitemap worker refuses other evidence sections or missing origin context', async () => {
  let reads = 0, writes = 0;
  const dependencies: ExportChunkDependencies = {
    header: async () => exportSitemapHeader(), check: async () => {},
    read: async () => { reads++; return { items: [], nextCursor: null }; },
    upload: async () => { writes++; }, commit: async () => { writes++; },
  };
  await assert.rejects(processExportChunk({ ...initial, section: 'issues' }, dependencies), /requires pages/);
  assert.equal(reads, 0);
  await assert.rejects(processExportChunk(initial, dependencies), /requires an origin/);
  assert.equal(writes, 0);
});

test('existing JSON and CSV dependency contracts need no origin and preserve header calls', async () => {
  let headers = 0;
  const dependencies: ExportChunkDependencies = {
    header: async () => { headers++; return '{"pages":['; },
    origin: async () => { throw new Error('must not fetch sitemap origin'); },
    check: async () => {}, read: async () => ({ items: [], nextCursor: null }),
    upload: async () => {}, commit: async () => {},
  };
  const first = await processExportChunk({ ...initial, format: 'json' }, dependencies);
  assert.equal(first.text, '{"pages":[],"issues":[');
  assert.equal(headers, 1);
  await processExportChunk({ ...initial, format: 'json', part: 1, section: 'issues' }, dependencies);
  await processExportChunk({ ...initial, format: 'pages.csv' }, dependencies);
  await processExportChunk({ ...initial, format: 'issues.csv', section: 'issues' }, dependencies);
  assert.equal(headers, 1);
});
