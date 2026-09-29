import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { ResourceAuditDocument } from '../lib/audit/resource-types';
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
});

test('authorized cursor route, summary totals and error handling', async () => {
  const audit = { id: 'owned', pagesCrawled: 501, issuesFound: 900 } as ResourceAuditDocument;
  assert.equal(await evidenceTotal(audit, 'events'), null);
  const calls: Array<{ id: string; kind: string; input: unknown }> = [];
  const app = express();
  const router = express.Router();
  registerScalableEvidenceRoutes(router, {
    requireAccess: async (req, id) => id === audit.id && (req.get('authorization') === 'Bearer owner' || req.get('x-test-guest') === 'owner') ? audit : null,
    readPage: async (id, kind, input) => {
      calls.push({ id, kind, input });
      if (input?.cursor === 'failure') throw new Error('database failure');
      return { items: [], limit: input?.limit || 50, nextCursor: input?.cursor ? null : 'next_50' };
    },
  });
  app.use('/api/tools', router);
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(500).json({ success: false }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/tools/audit`;
  try {
    for (const path of ['owned/evidence/pages', 'other/evidence/pages']) {
      const response = await fetch(`${base}/${path}`);
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
    }
    assert.equal(calls.length, 0);
    const headers = { authorization: 'Bearer owner' };
    const first = await fetch(`${base}/owned/evidence/pages`, { headers });
    const firstBody = await first.json();
    assert.equal(firstBody.data.total, 501);
    assert.equal(firstBody.data.totalScope, 'audit');
    assert.equal(firstBody.data.nextCursor, 'next_50');
    const second = await fetch(`${base}/owned/evidence/issues?cursor=next_50&limit=200&severity=high&category=SEO`, { headers: { 'x-test-guest': 'owner' } });
    const secondBody = await second.json();
    assert.equal(secondBody.data.nextCursor, null);
    assert.equal(secondBody.data.total, 900);
    assert.equal(secondBody.data.filteredTotal, null);
    assert.deepEqual(calls.at(-1), { id: 'owned', kind: 'issues', input: { cursor: 'next_50', limit: 100, severity: 'high', category: 'SEO' } });
    const beforeInvalid = calls.length;
    for (const path of ['pages?cursor=bad%2Ccursor', 'issues?limit=0', 'unknown', 'pages?category=SEO']) {
      assert.equal((await fetch(`${base}/owned/evidence/${path}`, { headers })).status, 400);
    }
    assert.equal(calls.length, beforeInvalid);
    const failed = await fetch(`${base}/owned/evidence/pages?cursor=failure`, { headers });
    assert.equal(failed.status, 500);
    assert.equal(failed.headers.get('cache-control'), 'private, no-store');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
