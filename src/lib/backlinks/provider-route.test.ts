import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response } from 'express';
import { ApiError } from '../api/errors';
import { apiRouter } from '../../api/providers-router';

test('public route preserves its envelope, exposes source statuses and never enables HTTP stale-while-revalidate', async context => {
  const saved = ['OPEN_PAGE_RANK_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].map(key => [key, process.env[key]] as const);
  process.env.OPEN_PAGE_RANK_API_KEY = 'fixture-route-key';
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const called: string[] = [];
  context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    called.push(url);
    if (url === 'https://openpagerank.keywordseverywhere.com/v1/domains/bulk') {
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture-route-key');
      return new Response(JSON.stringify({ as_of: '2026-10-01', results: [{ domain: 'github.io', found: true, open_page_rank: 10,
        hosts: [{ host: 'route-fixture.github.io', found: true, open_page_rank: 0, referring_hosts: 0, history: [] }] }], raw_secret: 'strip-me' }),
      { headers: { 'content-type': 'application/json' } });
    }
    if (new URL(url).origin === 'https://majestic.com') return new Response('Unavailable', { status: 503 });
    assert.equal(new URL(url).origin, 'https://tranco-list.eu', 'only official source domains are called');
    return new Response(JSON.stringify({ domain: 'route-fixture.github.io', ranks: [] }), { headers: { 'content-type': 'application/json' } });
  });
  const route = apiRouter.stack.find(layer => layer.route?.path === '/domain/link-signals');
  assert.ok(route);
  const request = async (domain: unknown) => {
    const headers = new Headers();
    let status = 200;
    let body: any;
    await route.route.stack[0].handle({ query: { domain: domain as string } } as unknown as Request, {
      setHeader: (name: string, value: string) => headers.set(name, value),
      json: (value: unknown) => { body = value; },
    } as unknown as Response, (error: unknown) => {
      assert.ok(error instanceof ApiError);
      status = error.status;
      body = { success: false, code: error.code };
    });
    return { status, headers, body };
  };
  try {
    const response = await request('route-fixture.github.io');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = response.body;
    assert.equal(body.success, true);
    assert.equal(body.data.domain, 'route-fixture.github.io');
    assert.equal(body.data.openPageRank.score, 0);
    assert.equal(body.data.openPageRank.scope, 'host');
    assert.equal(body.data.openPageRank.referringDomains, null);
    assert.equal(body.data.sources.tranco.status, 'not_listed');
    assert.equal(body.data.webRankStatus, 'not_ranked');
    assert.equal(body.data.linkStatus, 'unavailable');
    assert.doesNotMatch(JSON.stringify(body), /fixture-route-key|strip-me|raw_secret/);
    await request('route-fixture.github.io');
    assert.equal(called.length, 3, 'the second HTTP call reuses in-process provider evidence');
    for (const domain of ['', 'localhost', '127.0.0.1', '8.8.8.8', 'ftp://example.com', ['example.com', 'other.com'], {}]) {
      const invalid = await request(domain);
      assert.equal(invalid.status, 400);
    }
  } finally {
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
