import assert from 'node:assert/strict';
import test from 'node:test';
import { makeEvidenceCacheRow, supabaseDomainEvidenceCache } from './domain-evidence-cache';
import { parseOpenPageRankResponse } from './provider-evidence';

test('durable adapter reads and upserts only public.domain_evidence_cache with service credentials', async context => {
  const saved = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].map(key => [key, process.env[key]] as const);
  process.env.SUPABASE_URL = 'https://domain-cache-fixture.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service-key';
  const now = Date.parse('2026-10-14T00:00:00.000Z');
  const evidence = parseOpenPageRankResponse({ as_of: '2026-10-01', results: [{ domain: 'example.com', found: true, open_page_rank: 0 }] }, 'example.com', new Date(now).toISOString());
  const row = makeEvidenceCacheRow('example.com', { version: 1, openPageRank: evidence }, now)!;
  const methods: string[] = [];
  context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://domain-cache-fixture.supabase.co');
    assert.equal(url.pathname, '/rest/v1/domain_evidence_cache');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('apikey'), 'fixture-service-key');
    methods.push(init?.method ?? 'GET');
    if (init?.method === 'POST') {
      assert.equal(headers.get('content-profile'), 'public');
      assert.equal(url.searchParams.get('on_conflict'), 'domain');
      assert.deepEqual(JSON.parse(String(init.body)), row);
      return new Response(null, { status: 201 });
    }
    assert.equal(headers.get('accept-profile'), 'public');
    assert.equal(url.searchParams.get('domain'), 'eq.example.com');
    assert.equal(url.searchParams.get('select'), 'domain,payload,fetched_at,fresh_until,stale_until');
    return new Response(JSON.stringify(row), { headers: { 'content-type': 'application/json' } });
  });
  try {
    assert.deepEqual(await supabaseDomainEvidenceCache.read('example.com'), row);
    await supabaseDomainEvidenceCache.write(row);
    assert.deepEqual(methods, ['GET', 'POST']);
  } finally {
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
