import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { ResourceAuditDocument } from '../lib/audit/resource-types';
import { buildEvidenceSearchFilter, readEvidencePage } from '../lib/supabase/scalable-audit-repository';
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
  }
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
    for (const path of ['owned/evidence/pages', 'other/evidence/pages', 'owned/evidence/issues?query=title']) {
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
    assert.equal(firstBody.data.nextCursor, 'next_50');
    const search = 'title%_\\*",(audit_id.neq.owned)';
    const second = await fetch(`${base}/owned/evidence/issues?cursor=next_50&limit=200&severity=high&category=SEO&query=${encodeURIComponent(` ${search} `)}`, { headers: { 'x-test-guest': 'owner' } });
    const secondBody = await second.json();
    assert.equal(secondBody.data.nextCursor, null);
    assert.equal(secondBody.data.total, 900);
    assert.equal(secondBody.data.filteredTotal, null);
    assert.deepEqual(calls.at(-1), { id: 'owned', kind: 'issues', input: { cursor: 'next_50', limit: 100, severity: 'high', category: 'SEO', query: search } });
    const searchOnly = await fetch(`${base}/owned/evidence/issues?query=title`, { headers });
    const searchBody = await searchOnly.json();
    assert.equal(searchBody.data.total, 900);
    assert.equal(searchBody.data.filteredTotal, null);
    assert.equal(searchBody.data.nextCursor, 'next_50');
    const emptySearch = await fetch(`${base}/owned/evidence/issues?query=%20`, { headers });
    assert.equal((await emptySearch.json()).data.filteredTotal, 900);
    const beforeInvalid = calls.length;
    const totalsBeforeInvalid = totalCalls.length;
    for (const path of ['pages?cursor=bad%2Ccursor', 'issues?limit=0', 'unknown', 'pages?category=SEO', 'pages?query=title', 'events?query=title', 'issues?query=title&query=other', `issues?query=${'x'.repeat(161)}`, 'issues?query=title%00']) {
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
