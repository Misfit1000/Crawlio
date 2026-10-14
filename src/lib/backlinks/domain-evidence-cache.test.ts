import assert from 'node:assert/strict';
import test from 'node:test';
import { EVIDENCE_FRESH_MS, EVIDENCE_STALE_MS, makeEvidenceCacheRow, readEvidenceCacheRow, type DomainEvidenceCacheRow, type DomainEvidenceCacheStore } from './domain-evidence-cache';
import { parseOpenPageRankResponse, parseTrancoEvidence } from './provider-evidence';
import { createDomainEvidenceService } from './public-link-signals';

const initialTime = Date.parse('2026-10-14T00:00:00.000Z');

function fixture() {
  let time = initialTime;
  let key: string | undefined = 'fixture-key';
  let failOpr = false;
  let failTranco = false;
  let value = 0;
  const calls = { opr: 0, tranco: 0, reads: 0, writes: 0 };
  const rows = new Map<string, DomainEvidenceCacheRow>();
  const store: DomainEvidenceCacheStore = {
    async read(domain) { calls.reads++; return structuredClone(rows.get(domain) ?? null); },
    async write(row) { calls.writes++; rows.set(row.domain, structuredClone(row)); },
  };
  const options = {
    store, now: () => time, apiKey: () => key,
    majestic: async () => { throw new Error('fixture Majestic unavailable'); },
    openPageRank: async (domain: string) => {
      calls.opr++;
      if (failOpr) throw new Error('fixture provider error');
      return parseOpenPageRankResponse({ as_of: '2026-10-01', results: [{ domain, found: true, open_page_rank: value, referring_domains: 0, history: [] }] }, domain, new Date(time).toISOString());
    },
    tranco: async (domain: string) => {
      calls.tranco++;
      if (failTranco) throw new Error('fixture provider error');
      return parseTrancoEvidence({ domain, ranks: [{ date: '2026-10-01', rank: 100 }] }, domain, new Date(time).toISOString());
    },
  };
  return { rows, calls, options, get: createDomainEvidenceService(options),
    advance: (milliseconds: number) => { time += milliseconds; },
    failures: (opr: boolean, tranco: boolean) => { failOpr = opr; failTranco = tranco; },
    setKey: (next: string | undefined) => { key = next; }, setValue: (next: number) => { value = next; },
  };
}

test('bounded memory deduplicates normalized domains; a new instance reads durable fresh evidence', async () => {
  const f = fixture();
  const results = await Promise.all(Array.from({ length: 10 }, (_, index) => f.get(index % 2 ? 'https://www.example.com/page' : 'example.com')));
  assert.equal(f.calls.opr, 1);
  assert.equal(f.calls.tranco, 1);
  assert.equal(f.calls.reads, 1);
  assert.equal(f.calls.writes, 1);
  assert.equal(results[0].openPageRank?.score, 0);
  assert.equal(results[0].globalRank, null, 'Open PageRank must not overwrite legacy Majestic metrics');
  results[0].openPageRank!.score = 10;
  assert.equal((await f.get('example.com')).openPageRank?.score, 0, 'callers cannot mutate cached evidence');
  const restart = createDomainEvidenceService(f.options);
  assert.equal((await restart('example.com')).openPageRank?.score, 0);
  assert.equal(f.calls.opr, 1);
  assert.equal(f.calls.reads, 2);
  const row = f.rows.get('example.com')!;
  assert.equal(Date.parse(row.fresh_until) - Date.parse(row.fetched_at), EVIDENCE_FRESH_MS);
  assert.equal(Date.parse(row.stale_until) - Date.parse(row.fetched_at), EVIDENCE_STALE_MS);
});

test('24-hour expiration refreshes before returning; successful refresh never serves stale', async () => {
  const f = fixture();
  await f.get('example.com');
  f.advance(EVIDENCE_FRESH_MS - 1);
  assert.equal((await f.get('example.com')).openPageRank?.score, 0);
  f.setValue(5);
  f.advance(1);
  const refreshed = await f.get('example.com');
  assert.equal(refreshed.openPageRank?.score, 5);
  assert.equal(refreshed.openPageRank?.status, 'measured');
  assert.equal(f.calls.opr, 2);
  assert.equal(f.calls.writes, 2);
});

test('stale evidence is returned only on errors and never gets its age extended', async () => {
  const f = fixture();
  await f.get('example.com');
  const original = structuredClone(f.rows.get('example.com'));
  f.advance(EVIDENCE_FRESH_MS);
  f.failures(true, true);
  const stale = await f.get('example.com');
  assert.equal(stale.openPageRank?.status, 'stale');
  assert.equal(stale.sources?.tranco.status, 'stale');
  assert.equal(stale.openPageRank?.fetchedAt, original?.fetched_at);
  assert.deepEqual(f.rows.get('example.com'), original);
  assert.equal(f.calls.writes, 1);
  await f.get('example.com');
  assert.equal(f.calls.opr, 2, 'failures use bounded one-minute retry dedupe');
  f.advance(60_000);
  await f.get('example.com');
  assert.equal(f.calls.opr, 3);
  f.advance(EVIDENCE_STALE_MS - EVIDENCE_FRESH_MS - 60_000);
  const expired = await f.get('example.com');
  assert.equal(expired.openPageRank?.status, 'unavailable');
  assert.equal(expired.openPageRank?.score, null);
  assert.equal(expired.webRank, null);
  assert.equal(expired.webRankStatus, 'unavailable');
  assert.equal(expired.sources?.tranco.status, 'unavailable');
});

test('partial refresh retains each provider timestamp and retries only the failed source', async () => {
  const f = fixture();
  await f.get('example.com');
  f.advance(EVIDENCE_FRESH_MS);
  f.failures(true, false);
  const partial = await f.get('example.com');
  assert.equal(partial.openPageRank?.status, 'stale');
  assert.equal(partial.sources?.tranco.status, 'measured');
  assert.notEqual(partial.openPageRank?.fetchedAt, partial.sources?.tranco.fetchedAt);
  const stored = f.rows.get('example.com')!;
  assert.equal(stored.payload.openPageRank?.status, 'measured', 'stale is a response status, not renewed cached evidence');
  assert.equal(stored.payload.openPageRank?.fetchedAt, new Date(initialTime).toISOString());
  f.advance(60_000);
  f.failures(false, false);
  f.setValue(8);
  assert.equal((await f.get('example.com')).openPageRank?.score, 8);
  assert.equal(f.calls.opr, 3);
  assert.equal(f.calls.tranco, 2);
});

test('missing key is not_configured, makes no paid or scraping requests, and never uses stale evidence', async () => {
  const f = fixture();
  await f.get('example.com');
  f.setKey(undefined);
  const missing = await f.get('example.com');
  assert.equal(missing.openPageRank?.status, 'not_configured');
  assert.equal(missing.openPageRank?.score, null);
  assert.equal(f.calls.opr, 1);
  assert.equal(missing.sources?.majesticMillion.status, 'unavailable');
  assert.equal(missing.linkStatus, 'unavailable');
  f.setKey('fixture-key');
  assert.equal((await f.get('example.com')).openPageRank?.status, 'measured');
  assert.equal(f.calls.opr, 1);
});

test('durable JSON is allowlisted; poisoned sources, URLs and inflated lifetimes are rejected', async () => {
  const f = fixture();
  await f.get('example.com');
  const row = f.rows.get('example.com')!;
  const poisoned = { ...row, payload: { ...row.payload, secret: 'strip-me',
    openPageRank: { ...row.payload.openPageRank, sourceUrl: 'https://evil.test', raw: 'strip-me' },
    tranco: { ...row.payload.tranco, raw: 'strip-me' },
  } };
  const parsed = readEvidenceCacheRow(poisoned, 'example.com', initialTime)!;
  assert.doesNotMatch(JSON.stringify(parsed), /strip-me|evil\.test/);
  assert.equal(parsed.openPageRank?.sourceUrl, 'https://openpagerank.keywordseverywhere.com/docs');
  assert.equal(readEvidenceCacheRow({ ...row, stale_until: '2099-01-01T00:00:00.000Z' }, 'example.com', initialTime), null);
  assert.equal(readEvidenceCacheRow(row, 'other.com', initialTime), null);
  const invalid = readEvidenceCacheRow({ ...poisoned, payload: { ...poisoned.payload, openPageRank: { ...poisoned.payload.openPageRank, score: '0' } } }, 'example.com', initialTime)!;
  assert.equal(invalid.openPageRank, undefined);
  assert.equal(invalid.tranco?.history[0].rank, 100);
  const future = { ...row.payload, openPageRank: { ...row.payload.openPageRank!, fetchedAt: '2099-01-01T00:00:00.000Z' }, tranco: undefined };
  assert.equal(makeEvidenceCacheRow('example.com', future, initialTime), null);
});

test('cache outages degrade to bounded memory without suppressing successful providers', async () => {
  const f = fixture();
  const get = createDomainEvidenceService({ ...f.options, store: {
    async read() { throw new Error('cache unavailable'); }, async write() { throw new Error('cache unavailable'); },
  } });
  assert.equal((await get('example.com')).openPageRank?.status, 'measured');
  await get('example.com');
  assert.equal(f.calls.opr, 1);
});

test('memory and in-flight maps are bounded, with durable reuse after eviction', async () => {
  const f = fixture();
  const bounded = createDomainEvidenceService({ ...f.options, maxCacheEntries: 1 });
  await bounded('one.example');
  await bounded('two.example');
  await bounded('one.example');
  assert.equal(f.calls.reads, 3);
  assert.equal(f.calls.opr, 2);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const limited = createDomainEvidenceService({ ...f.options, maxInFlight: 1, openPageRank: async domain => { await gate; return f.options.openPageRank(domain); } });
  const first = limited('blocked.example');
  const duplicate = limited('blocked.example');
  await assert.rejects(limited('excess.example'), /capacity/);
  release();
  assert.deepEqual(await first, await duplicate);
});

test('errors are not persisted as absence or cached for 24 hours', async () => {
  const f = fixture();
  f.failures(true, true);
  const unavailable = await f.get('example.com');
  assert.equal(unavailable.openPageRank?.status, 'unavailable');
  assert.equal(unavailable.sources?.tranco.status, 'unavailable');
  assert.equal(f.calls.writes, 0);
  await f.get('example.com');
  assert.equal(f.calls.opr, 1);
  f.advance(60_000);
  await f.get('example.com');
  assert.equal(f.calls.opr, 2);
});
