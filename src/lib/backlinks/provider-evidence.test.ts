import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fetchOpenPageRank, OPEN_PAGE_RANK_ENDPOINT } from './open-page-rank';
import { boundedResponseText } from './provider-http';
import { normalizeEvidenceDomain, parseOpenPageRankResponse, parseTrancoEvidence } from './provider-evidence';
import { parseMajesticMillionPage } from './public-link-signals';

const fetchedAt = '2026-10-14T00:00:00.000Z';
const row = { domain: 'example.com', found: true, open_page_rank: 4.92, rank: 100, referring_domains: 123, history: [
  { date: '2026-09-01', open_page_rank: 4.8, estimated: true },
  { date: '2026-10-01', open_page_rank: 4.92, estimated: false },
] };
const response = (value: unknown = row) => ({ as_of: '2026-10-01', results: [value] });

test('native scores, weighted counts, dates and estimated history are allowlisted without zero coercion', () => {
  const parsed = parseOpenPageRankResponse({ ...response({ ...row, secret: 'do-not-store' }), api_key: 'do-not-store', invalid: ['<script>'] }, 'www.example.com', fetchedAt);
  assert.equal(parsed.score, 4.92);
  assert.equal(parsed.scale, 10);
  assert.equal(parsed.referringDomains, 123);
  assert.equal(parsed.referringCountDefinition, 'authority_weighted_domains');
  assert.equal(parsed.estimated, false);
  assert.deepEqual(parsed.history, [{ date: '2026-09-01', score: 4.8, estimated: true }, { date: '2026-10-01', score: 4.92, estimated: false }]);
  assert.doesNotMatch(JSON.stringify(parsed), /do-not-store|<script>|api_key/);
  const zero = parseOpenPageRankResponse(response({ ...row, open_page_rank: 0, referring_domains: 0, history: [] }), 'example.com', fetchedAt);
  assert.equal(zero.status, 'measured');
  assert.equal(zero.score, 0);
  assert.equal(zero.referringDomains, 0);
  assert.equal(zero.estimated, null);
  assert.equal(parseOpenPageRankResponse(response({ ...row, open_page_rank: 10 }), 'example.com', fetchedAt).score, 10);
});

test('only explicit provider absence becomes not_listed', () => {
  const absent = parseOpenPageRankResponse(response({ domain: 'example.com', found: false, open_page_rank: null }), 'example.com', fetchedAt);
  assert.equal(absent.status, 'not_listed');
  assert.equal(absent.score, null);
  assert.throws(() => parseOpenPageRankResponse({ as_of: '2026-10-01', results: [] }, 'example.com'), /no exact/);
  assert.throws(() => parseOpenPageRankResponse(response({ ...row, found: false }), 'example.com'), /conflicted/);
  assert.throws(() => parseOpenPageRankResponse(response({ ...row, domain: 'other.com' }), 'example.com'), /no exact/);
});

test('hosted tenants and arbitrary subdomains never inherit parent authority', () => {
  for (const parent of ['github.io', 'blogspot.com', 'vercel.app', 'pages.dev', 'netlify.app', 'wordpress.com', 'example.co.uk']) {
    const domain = `tenant.${parent}`;
    assert.throws(() => parseOpenPageRankResponse(response({ ...row, domain: parent, open_page_rank: 10 }), domain), /no exact/);
    const host = { host: domain, found: true, open_page_rank: 0, rank: 200, referring_hosts: 0, history: [] };
    const evidence = parseOpenPageRankResponse(response({ ...row, domain: parent, hosts: [host] }), domain, fetchedAt);
    assert.equal(evidence.scope, 'host');
    assert.equal(evidence.score, 0);
    assert.equal(evidence.referringDomains, null);
    assert.equal(evidence.referringHosts, 0);
    assert.equal(evidence.referringCountDefinition, 'authority_filtered_hosts');
    const tenantRow = parseOpenPageRankResponse(response({ domain, found: false, hosts: [host] }), domain, fetchedAt);
    assert.equal(tenantRow.status, 'measured', 'an exact host overrides a not-found private-suffix domain row');
  }
});

test('malformed numeric, date, host and history data fail validation', () => {
  for (const patch of [
    { open_page_rank: -1 }, { open_page_rank: 10.01 }, { open_page_rank: '4.9' }, { open_page_rank: null },
    { rank: 0 }, { referring_domains: -1 }, { referring_domains: '123' }, { found: 'true' },
    { history: [{ date: '2026-02-30', open_page_rank: 1, estimated: false }] },
    { history: [{ date: '2026-10-01', open_page_rank: 1, estimated: 'false' }] },
    { history: [{ date: '2026-11-01', open_page_rank: 1, estimated: false }] },
    { history: [row.history[0], row.history[0]] }, { hosts: {} },
  ]) assert.throws(() => parseOpenPageRankResponse(response({ ...row, ...patch }), 'example.com'));
  assert.throws(() => parseOpenPageRankResponse({ ...response(), as_of: '<script>' }, 'example.com'));
  for (const input of ['localhost', '127.0.0.1', '8.8.8.8', 'https://user:secret@example.com', 'ftp://example.com']) {
    assert.throws(() => normalizeEvidenceDomain(input));
  }
  assert.equal(normalizeEvidenceDomain('https://WWW.Example.com/page?q=x'), 'example.com');
});

test('new API uses a server Bearer key and includes history without returning extra fields', async context => {
  context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(input, OPEN_PAGE_RANK_ENDPOINT);
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture-key');
    assert.equal(init?.redirect, 'error');
    assert.deepEqual(JSON.parse(String(init?.body)), { domains: ['example.com'], include_history: true });
    return new Response(JSON.stringify(response()), { headers: { 'content-type': 'application/json' } });
  });
  const evidence = await fetchOpenPageRank('www.example.com', 'fixture-key');
  assert.equal(evidence.score, 4.92);
  assert.doesNotMatch(JSON.stringify(evidence), /fixture-key|Authorization/);
});

test('HTTP failures, wrong content types and oversized streams cannot become evidence', async context => {
  const stub = context.mock.method(globalThis, 'fetch', async () => new Response('secret-provider-error', { status: 401 }));
  await assert.rejects(fetchOpenPageRank('example.com', 'fixture-key'), error => {
    assert.match(String(error), /HTTP 401/);
    assert.doesNotMatch(String(error), /secret-provider-error|fixture-key/);
    return true;
  });
  stub.mock.mockImplementation(async () => new Response('<html>Not JSON</html>', { headers: { 'content-type': 'text/html' } }));
  await assert.rejects(fetchOpenPageRank('example.com', 'fixture-key'), /content type/);
  await assert.rejects(boundedResponseText(new Response('12345'), 4), /too large/);
  await assert.rejects(boundedResponseText(new Response('x', { headers: { 'content-length': '999' } }), 4), /too large/);
});

test('Majestic no matching row is unknown unless absence explicitly names this domain', () => {
  const table = '<h1>Majestic Million</h1><table><thead><tr><th>Referring Subnets</th></tr></thead><tbody><tr><td>1</td><td>0</td><td><a class="domainname">other.com</a></td><td>com</td><td>1</td><td>0</td><td>0</td></tr></tbody></table>';
  assert.throws(() => parseMajesticMillionPage(table, 'example.com'), /absence was not established/);
  assert.throws(() => parseMajesticMillionPage(`${table}<p>other.com is not in the Majestic Million</p>`, 'example.com'), /absence was not established/);
  assert.throws(() => parseMajesticMillionPage(`${table}<p>notexample.com is not in the Majestic Million</p>`, 'example.com'), /absence was not established/);
  const absent = parseMajesticMillionPage('<h1>Majestic Million</h1><p>example.com is not in the Majestic Million.</p>', 'example.com');
  assert.equal(absent.found, false);
  assert.equal(absent.globalRank, null);
  const measured = parseMajesticMillionPage(table.replace('other.com', 'example.com'), 'example.com');
  assert.equal(measured.referringSubnets, 0);
  assert.equal(measured.referringIps, 0);
});

test('Tranco validates exact-domain ranks and dates without treating malformed data as absence', () => {
  assert.equal(parseTrancoEvidence({ ranks: [] }, 'example.com').status, 'not_listed');
  assert.throws(() => parseTrancoEvidence({ domain: 'example.com', ranks: [{ date: '2026-02-30', rank: 1 }] }, 'example.com'));
  assert.throws(() => parseTrancoEvidence({ domain: 'example.com', ranks: [{ date: '2026-10-01', rank: '1' }] }, 'example.com'));
  assert.throws(() => parseTrancoEvidence({ domain: 'github.io', ranks: [{ date: '2026-10-01', rank: 1 }] }, 'tenant.github.io'), /different domain/);
});

test('provider modules reject browser execution', () => {
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    "globalThis.window = {}; await import('./src/lib/backlinks/open-page-rank.ts');"], { encoding: 'utf8' });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /server-only/);
});
