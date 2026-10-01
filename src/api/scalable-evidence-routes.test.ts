import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { AuditPresentationSummary, ResourceAuditDocument } from '../lib/audit/resource-types';
import { buildEvidenceSearchFilter, readEvidencePage, validateEvidenceAffectedUrl } from '../lib/supabase/scalable-audit-repository';
import { evidenceTotal, parseEvidenceQuery, registerScalableEvidenceRoutes } from './scalable-evidence-routes';

test('query bounds and validation', () => {
  assert.equal(parseEvidenceQuery({}, 'pages').limit, 50);
  assert.equal(parseEvidenceQuery({ limit: '500' }, 'pages').limit, 100);
  assert.equal(parseEvidenceQuery({ limit: '1' }, 'pages').limit, 1);
  for (const limit of ['0', '-1', '1.5', 'NaN', 'Infinity', '', '9007199254740992']) {
    assert.throws(() => parseEvidenceQuery({ limit }, 'issues'));
  }
  for (const cursor of ['', 'a,b', 'a'.repeat(101), ['a'], { gt: 'a' }]) {
    assert.throws(() => parseEvidenceQuery({ cursor }, 'pages'));
  }
  assert.throws(() => parseEvidenceQuery({ severity: 'urgent' }, 'issues'));
  assert.throws(() => parseEvidenceQuery({ category: 'x'.repeat(101) }, 'issues'));
  assert.throws(() => parseEvidenceQuery({ severity: 'high' }, 'events'));
  assert.throws(() => parseEvidenceQuery({ limit: ['10', '20'] }, 'pages'));
  assert.equal(parseEvidenceQuery({ query: ` ${'x'.repeat(158)} ` }, 'issues').query, 'x'.repeat(158));
  assert.equal(parseEvidenceQuery({ query: 'x'.repeat(160) }, 'issues').query?.length, 160);
  assert.equal(parseEvidenceQuery({ query: '   ' }, 'issues').query, undefined);
  for (const query of ['x'.repeat(161), ['title'], { ilike: 'title' }, 'title\u0000', 'title\n']) {
    assert.throws(() => parseEvidenceQuery({ query }, 'issues'));
  }
  for (const kind of ['pages', 'events'] as const) {
    assert.throws(() => parseEvidenceQuery({ query: 'title' }, kind));
    assert.throws(() => parseEvidenceQuery({ query: '' }, kind));
    assert.throws(() => parseEvidenceQuery({ section: 'on-page' }, kind));
    assert.throws(() => parseEvidenceQuery({ affectedUrl: 'https://example.com/' }, kind));
  }
  assert.equal(parseEvidenceQuery({ section: 'security', affectedUrl: 'https://example.com/page?key=a,b' }, 'issues').section, 'security');
  for (const section of ['', 'seo', 'onPage', 'technical,security', ['security'], { eq: 'security' }]) {
    assert.throws(() => parseEvidenceQuery({ section }, 'issues'));
  }
  for (const affectedUrl of ['', '/page', 'https:example.com', 'javascript:alert(1)', 'ftp://example.com/', 'https://user:pass@example.com/', 'https://example.com/#fragment', 'https://example.com/a b', 'https://example.com/\n', `https://example.com/${'x'.repeat(2048)}`, ['https://example.com/'], { eq: 'https://example.com/' }]) {
    assert.throws(() => parseEvidenceQuery({ affectedUrl }, 'issues'));
  }
  assert.equal(validateEvidenceAffectedUrl('https://example.com/path?x=",audit_id.neq.other'), 'https://example.com/path?x=",audit_id.neq.other');
});

test('search builder quotes syntax and escapes literal wildcard patterns', () => {
  assert.equal(buildEvidenceSearchFilter(), undefined);
  assert.equal(buildEvidenceSearchFilter('   '), undefined);
  assert.throws(() => buildEvidenceSearchFilter('x'.repeat(161)));
  assert.throws(() => buildEvidenceSearchFilter('title\u0000'));
  const cases = [
    { query: ' Missing title ', operator: 'ilike', pattern: '%Missing title%' },
    { query: '100%_\\', operator: 'ilike', pattern: '%100\\%\\_\\\\%' },
    { query: 'x"),audit_id.neq.owned,("', operator: 'ilike', pattern: '%x"),audit\\_id.neq.owned,("%' },
    { query: '*', operator: 'imatch', pattern: '\\*' },
    { query: 'a.*(b)[c]+?^${}|\\100%_', operator: 'imatch', pattern: 'a\\.\\*\\(b\\)\\[c\\]\\+\\?\\^\\$\\{\\}\\|\\\\100%_' },
  ];
  for (const { query, operator, pattern } of cases) {
    assert.equal(buildEvidenceSearchFilter(query), ['title', 'description', 'affected_url'].map(column => `${column}.${operator}.${JSON.stringify(pattern)}`).join(','));
  }
});

test('repository sends search alongside audit filters and bounded ordered cursors', async context => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://evidence-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  const requests: URL[] = [];
  const rows = Array.from({ length: 101 }, (_, index) => ({
    id: `issue_${String(index + 80).padStart(3, '0')}`, audit_id: 'owned', severity: 'high', category: 'SEO',
    title: 'Missing title', description: 'Missing title description', affected_url: 'https://example.com/missing-title',
  }));
  context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(url);
    const cursor = url.searchParams.get('id')?.slice(3);
    const data = rows.filter(row => !cursor || row.id > cursor).slice(0, Number(url.searchParams.get('limit')));
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  });
  try {
    const input = { severity: 'high', category: 'SEO', query: 'Missing title' };
    const first = await readEvidencePage('owned', 'issues', input);
    assert.equal(first.items.length, 50);
    assert.equal(first.items[0].id, 'issue_080');
    assert.equal(first.nextCursor, 'issue_129');
    const second = await readEvidencePage('owned', 'issues', { ...input, cursor: first.nextCursor!, limit: 200 });
    assert.equal(second.limit, 100);
    assert.equal(second.items[0].id, 'issue_130');
    assert.equal(second.nextCursor, null);
    for (const request of requests) {
      assert.equal(request.pathname, '/rest/v1/audit_issues');
      assert.equal(request.searchParams.get('audit_id'), 'eq.owned');
      assert.equal(request.searchParams.get('severity'), 'eq.high');
      assert.equal(request.searchParams.get('category'), 'eq.SEO');
      assert.equal(request.searchParams.get('order'), 'id.asc');
      assert.equal(request.searchParams.get('or'), '(title.ilike."%Missing title%",description.ilike."%Missing title%",affected_url.ilike."%Missing title%")');
    }
    assert.equal(requests[0].searchParams.get('limit'), '51');
    assert.equal(requests[1].searchParams.get('limit'), '101');
    assert.equal(requests[1].searchParams.get('id'), 'gt.issue_129');
    const beforeInvalid = requests.length;
    await assert.rejects(readEvidencePage('owned', 'issues', { query: 'x'.repeat(161) }));
    await assert.rejects(readEvidencePage('owned', 'pages', { query: 'Missing title' }));
    assert.equal(requests.length, beforeInvalid);
    const filtered = await readEvidencePage('owned', 'issues', { section: 'security', affectedUrl: 'https://example.com/page?key=a,b', cursor: 'issue_080', limit: 1 });
    assert.equal(filtered.limit, 1);
    assert.equal(requests.at(-1)!.searchParams.get('audit_report_section'), 'eq.security');
    assert.equal(requests.at(-1)!.searchParams.get('affected_url'), 'eq.https://example.com/page?key=a,b');
    assert.equal(requests.at(-1)!.searchParams.get('id'), 'gt.issue_080');
    const beforeBadFilters = requests.length;
    await assert.rejects(readEvidencePage('owned', 'issues', { section: 'seo' }));
    await assert.rejects(readEvidencePage('owned', 'issues', { affectedUrl: 'javascript:alert(1)' }));
    await assert.rejects(readEvidencePage('owned', 'events', { section: 'security' }));
    assert.equal(requests.length, beforeBadFilters);
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test('authorized cursor route, summary totals and error handling', async () => {
  const audit = { id: 'owned', pagesCrawled: 501, issuesFound: 900 } as ResourceAuditDocument;
  assert.equal(await evidenceTotal(audit, 'events'), null);
  const calls: Array<{ id: string; kind: string; input: unknown }> = [];
  const totalCalls: string[] = [];
  let accessAllowed = false;
  const app = express();
  const router = express.Router();
  registerScalableEvidenceRoutes(router, {
    requireAccess: async (req, id) => {
      accessAllowed = id === audit.id && (req.get('authorization') === 'Bearer owner' || req.get('x-test-guest') === 'owner');
      return accessAllowed ? audit : null;
    },
    readPage: async (id, kind, input) => {
      assert.equal(accessAllowed, true);
      calls.push({ id, kind, input });
      if (input?.cursor === 'failure') throw new Error('database failure');
      return { items: [], limit: input?.limit || 50, nextCursor: input?.cursor ? null : 'next_50' };
    },
    readTotal: async (document, kind) => {
      assert.equal(accessAllowed, true);
      totalCalls.push(document.id);
      return evidenceTotal(document, kind);
    },
  });
  app.use('/api/tools', router);
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(500).json({ success: false }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/tools/audit`;
  try {
    for (const path of ['owned/evidence/pages', 'other/evidence/pages', 'owned/evidence/issues?query=title', 'owned/evidence/issues?section=security&affectedUrl=https%3A%2F%2Fexample.com%2F']) {
      const response = await fetch(`${base}/${path}`);
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
    }
    assert.equal(calls.length, 0);
    assert.equal(totalCalls.length, 0);
    const headers = { authorization: 'Bearer owner' };
    const denied = await fetch(`${base}/other/evidence/issues?query=title`, { headers });
    assert.equal(denied.status, 404);
    assert.equal(calls.length, 0);
    assert.equal(totalCalls.length, 0);
    const first = await fetch(`${base}/owned/evidence/pages`, { headers });
    const firstBody = await first.json();
    assert.equal(firstBody.data.total, 501);
    assert.equal(firstBody.data.totalScope, 'audit');
    assert.equal(firstBody.data.matchingCount, 501);
    assert.equal(firstBody.data.nextCursor, 'next_50');
    const search = 'title%_\\*",(audit_id.neq.owned)';
    const second = await fetch(`${base}/owned/evidence/issues?cursor=next_50&limit=200&severity=high&category=SEO&query=${encodeURIComponent(` ${search} `)}`, { headers: { 'x-test-guest': 'owner' } });
    const secondBody = await second.json();
    assert.equal(secondBody.data.nextCursor, null);
    assert.equal(secondBody.data.total, 900);
    assert.equal(secondBody.data.filteredTotal, null);
    assert.deepEqual(calls.at(-1), { id: 'owned', kind: 'issues', input: { cursor: 'next_50', limit: 100, severity: 'high', category: 'SEO', query: search, section: undefined, affectedUrl: undefined } });
    const searchOnly = await fetch(`${base}/owned/evidence/issues?query=title`, { headers });
    const searchBody = await searchOnly.json();
    assert.equal(searchBody.data.total, 900);
    assert.equal(searchBody.data.filteredTotal, null);
    assert.equal(searchBody.data.nextCursor, 'next_50');
    const emptySearch = await fetch(`${base}/owned/evidence/issues?query=%20`, { headers });
    assert.equal((await emptySearch.json()).data.filteredTotal, 900);
    const oldSection = await fetch(`${base}/owned/evidence/issues?section=security`, { headers });
    assert.equal((await oldSection.json()).data.matchingCount, null);
    audit.presentationSummary = { version: 1, scope: 'complete', analysedPages: 0, attemptedPages: 0,
      responseOutcomes: { success: 0, redirect: 0, clientError: 0, serverError: 0, unavailable: 0 },
      delivery: { count: 0, totalResponseMs: 0, totalBytes: 0, averageResponseMs: null, averagePageBytes: null },
      pagesWithFindings: 0, depthCounts: {}, findingsBySection: { security: 612 }, topRecommendations: [], updatedAt: new Date().toISOString() } satisfies AuditPresentationSummary;
    const sectionOnly = await fetch(`${base}/owned/evidence/issues?section=security&cursor=next_50`, { headers });
    const sectionBody = await sectionOnly.json();
    assert.equal(sectionBody.data.matchingCount, 612);
    assert.equal(sectionBody.data.filteredTotal, 612);
    assert.equal(sectionBody.data.total, 900);
    const noMatches = await fetch(`${base}/owned/evidence/issues?section=mobile`, { headers });
    assert.equal((await noMatches.json()).data.matchingCount, 0);
    for (const filter of ['section=security&severity=high', 'section=security&category=SEO', 'section=security&query=title', 'section=security&affectedUrl=https%3A%2F%2Fexample.com%2F', 'affectedUrl=https%3A%2F%2Fexample.com%2F']) {
      const response = await fetch(`${base}/owned/evidence/issues?${filter}`, { headers });
      assert.equal((await response.json()).data.matchingCount, null);
    }
    const beforeInvalid = calls.length;
    const totalsBeforeInvalid = totalCalls.length;
    for (const path of ['pages?cursor=bad%2Ccursor', 'issues?limit=0', 'unknown', 'pages?category=SEO', 'pages?query=title', 'events?query=title', 'issues?query=title&query=other', `issues?query=${'x'.repeat(161)}`, 'issues?query=title%00', 'issues?section=seo', 'issues?section=security&section=technical', 'issues?affectedUrl=javascript%3Aalert(1)', 'pages?section=technical', 'events?affectedUrl=https%3A%2F%2Fexample.com%2F']) {
      assert.equal((await fetch(`${base}/owned/evidence/${path}`, { headers })).status, 400);
    }
    assert.equal(calls.length, beforeInvalid);
    assert.equal(totalCalls.length, totalsBeforeInvalid);
    const failed = await fetch(`${base}/owned/evidence/pages?cursor=failure`, { headers });
    assert.equal(failed.status, 500);
    assert.equal(failed.headers.get('cache-control'), 'private, no-store');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
