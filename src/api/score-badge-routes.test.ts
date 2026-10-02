import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';
import express from 'express';
import { ApiError } from '../lib/api/errors';
import type { ScoreBadgeAudit } from '../lib/report/score-badge';
import { readScoreBadgeScores, registerScoreBadgeRoutes, supabaseScoreBadgeShares, type ScoreBadgeShare, type ScoreBadgeShareStore } from './score-badge-routes';

const AUDIT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_AUDIT_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const PRIVATE_ERROR = 'service_role=secret private.example.test raw-private-audit-id';
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

async function fixture(context: TestContext, defaults = false) {
  const token = randomBytes(32).toString('base64url');
  const audit: ScoreBadgeAudit = { id: AUDIT_ID, userId: OWNER, projectId: null, status: 'completed', completedAt: '2026-10-01T12:00:00Z' };
  const source: ScoreBadgeShare = { id: SOURCE_ID, audit_id: AUDIT_ID, project_id: null, user_id: OWNER,
    expires_at: '2026-10-12T00:00:00Z', revoked_at: null };
  const state = { audit: audit as ScoreBadgeAudit | null, scores: { overall: 81, scoringVersion: '2.2', coverage: { pagesAnalysed: 25 } } as Record<string, unknown> | null,
    time: Date.parse('2026-10-02T00:00:00Z'), failAt: '', afterScores: () => {}, calls: [] as string[],
    writes: [] as Array<Record<string, unknown>>, listInputs: [] as Array<{ auditId: string; userId: string; now: string }> };
  const rows = new Map<string, ScoreBadgeShare>([[hash(token), source]]);
  const record = (name: string) => {
    state.calls.push(name);
    if (state.failAt === name) throw new ApiError('PRIVATE_CODE', PRIVATE_ERROR, 418);
  };
  const store: ScoreBadgeShareStore = {
    async findByHash(value) { record('findByHash'); return structuredClone(rows.get(value) || null); },
    async findById(id) { record('findById'); return structuredClone([...rows.values()].find(row => row.id === id) || null); },
    async issue(input) {
      record('issue');
      state.writes.push({ ...input });
      const id = randomUUID();
      rows.set(input.token_hash, { id, audit_id: input.audit_id, project_id: input.project_id, user_id: input.user_id, expires_at: input.expires_at, revoked_at: null });
      return { id };
    },
    async revoke(input) {
      record('revoke');
      const row = [...rows.values()].find(row => row.id === input.id && row.audit_id === input.auditId && row.user_id === input.userId);
      if (!row) return false;
      row.revoked_at = input.revokedAt;
      state.writes.push({ ...input });
      return true;
    },
    async listActive(input) {
      record('listActive');
      state.listInputs.push(input);
      return [...rows.values()].filter(row => row.audit_id === input.auditId && row.user_id === input.userId
        && row.revoked_at === null && Date.parse(row.expires_at) > Date.parse(input.now))
        .slice(0, 50).map(({ id, expires_at, revoked_at }) => ({ id, expires_at, revoked_at }));
    },
  };
  const app = express();
  app.use(express.json({ strict: false }));
  // Isolate the existing shared limiter store across test servers, while preserving per-client aggregation.
  const client = randomUUID();
  app.use((req, _res, next) => { Object.defineProperty(req, 'ip', { value: client }); next(); });
  const router = express.Router();
  registerScoreBadgeRoutes(router, {
    async getRequester(req) {
      record('getRequester');
      return { userId: req.get('authorization') === 'Bearer owner' ? OWNER : req.get('authorization') ? 'other-user' : null };
    },
    async readAudit(id) { record('readAudit'); return state.audit?.id === id ? structuredClone(state.audit) : null; },
    ...(defaults ? {} : { shares: store, readScores: async (id: string) => {
      record('readScores'); assert.equal(id, AUDIT_ID); state.afterScores(); return structuredClone(state.scores);
    } }),
    now: () => state.time,
  });
  app.use('/api/tools', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  context.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (method: string, path: string, body?: unknown, authorization = 'Bearer owner', headers: Record<string, string> = {}) => fetch(`${base}${path}`, {
    method, headers: { ...(authorization ? { authorization } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const issue = () => request('POST', `/api/tools/audit/${AUDIT_ID}/badge`, { confirm: true, shareToken: token });
  return { state, token, source, rows, request, issue, store };
}

function noCache(response: Response) {
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  for (const name of ['cdn-cache-control', 'vercel-cdn-cache-control', 'surrogate-control']) assert.equal(response.headers.get(name), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
}

test('only explicit owner consent with an existing public share issues a separate hashed badge capability', async context => {
  const f = await fixture(context);
  for (const authorization of ['', 'Bearer guest', 'Bearer admin', 'Bearer other']) {
    const response = await f.request('POST', `/api/tools/audit/${AUDIT_ID}/badge`, { confirm: true, shareToken: f.token }, authorization);
    assert.equal(response.status, authorization ? 404 : 401);
    noCache(response);
  }
  assert.equal(f.state.calls.includes('findByHash'), false);
  assert.equal(f.state.calls.includes('readScores'), false);
  for (const body of [undefined, null, [], {}, { confirm: false, shareToken: f.token }, { confirm: 'true', shareToken: f.token },
    { confirm: 1, shareToken: f.token }, { confirm: true }, { confirm: true, shareToken: [f.token] },
    { confirm: true, shareToken: 'x'.repeat(81) }, { confirm: true, shareToken: `https://private.example.test/${f.token}` }]) {
    const response = await f.request('POST', `/api/tools/audit/${AUDIT_ID}/badge`, body);
    assert.equal(response.status, 400);
    noCache(response);
  }
  assert.equal(f.state.writes.length, 0);
  const issued = await f.issue();
  assert.equal(issued.status, 201);
  noCache(issued);
  const data = (await issued.json()).data;
  assert.equal(data.expiresAt, '2026-10-09T00:00:00.000Z');
  assert.match(data.badgeUrl, /^\/api\/tools\/score-badges\/sb1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}\.svg$/);
  for (const secret of [f.token, AUDIT_ID, OWNER, 'private.example.test']) assert.ok(!data.badgeUrl.includes(secret));
  const badgeToken = data.badgeUrl.split('/').at(-1)!.slice(0, -4);
  assert.ok(!/^[A-Za-z0-9_-]{40,80}$/.test(badgeToken), 'badge bearer must not pass the public report endpoint grammar');
  assert.notEqual(badgeToken, f.token);
  assert.equal(f.state.writes.length, 1);
  assert.deepEqual(f.state.writes[0], { audit_id: AUDIT_ID, project_id: null, user_id: OWNER, token_hash: hash(badgeToken), expires_at: data.expiresAt });
  assert.ok(!JSON.stringify(f.state.writes).includes(badgeToken));
  assert.equal((await f.request('POST', `/api/tools/audit/${AUDIT_ID}/badge`, { confirm: true, shareToken: badgeToken })).status, 400);
});

test('source share expiry, revocation and owner/audit/project mismatches prevent issuance before score reads', async context => {
  const f = await fixture(context);
  const original = { ...f.source };
  const cases: Partial<ScoreBadgeShare>[] = [
    { expires_at: new Date(f.state.time).toISOString() }, { expires_at: '2000-01-01T00:00:00Z' }, { expires_at: 'invalid' },
    { revoked_at: '2026-10-01T00:00:00Z' }, { user_id: 'other-owner' }, { audit_id: OTHER_AUDIT_ID }, { project_id: 'other-project' },
  ];
  for (const patch of cases) {
    Object.assign(f.source, original, patch);
    assert.equal((await f.issue()).status, 409);
    assert.equal(f.state.calls.includes('readScores'), false);
  }
  Object.assign(f.source, original);
  const wrongToken = await f.request('POST', `/api/tools/audit/${AUDIT_ID}/badge`, { confirm: true, shareToken: randomBytes(32).toString('base64url') });
  assert.equal(wrongToken.status, 409);
  assert.equal(f.state.writes.length, 0);
  f.source.expires_at = '2026-10-03T00:00:00Z';
  assert.equal((await (await f.issue()).json()).data.expiresAt, '2026-10-03T00:00:00.000Z');
});

test('failed/incomplete/deleted/scoreless audits cannot opt in, but a legitimate zero score can', async context => {
  const f = await fixture(context);
  for (const status of ['failed', 'cancelled', 'abandoned', 'running', 'queued'] as const) {
    f.state.audit!.status = status;
    assert.equal((await f.issue()).status, 409);
  }
  f.state.audit!.status = 'completed';
  for (const overall of [undefined, null, '81', -1, 101]) {
    f.state.scores!.overall = overall;
    assert.equal((await f.issue()).status, 409);
  }
  f.state.scores = null;
  assert.equal((await f.issue()).status, 409);
  f.state.scores = { overall: 0, scoringVersion: '2.2' };
  f.state.audit!.completedAt = null;
  assert.equal((await f.issue()).status, 409);
  f.state.audit!.completedAt = '2026-10-01T00:00:00Z';
  f.state.audit!.deletedAt = '2026-10-02T00:00:00Z';
  assert.equal((await f.issue()).status, 404);
  assert.equal(f.state.writes.length, 0);
  delete f.state.audit!.deletedAt;
  assert.equal((await f.issue()).status, 201);
});

test('ordinary/forged/malformed tokens do not opt in or reveal a score', async context => {
  const f = await fixture(context);
  for (const token of [f.token, 'bad', 'x'.repeat(300), `sb1.${SOURCE_ID}.${'x'.repeat(43)}`, `sb1.${OTHER_AUDIT_ID}.${f.token}`, '<script>']) {
    const response = await f.request('GET', `/api/tools/score-badges/${encodeURIComponent(token)}.svg`, undefined, '');
    assert.equal(response.status, 404);
    noCache(response);
    assert.deepEqual(await response.json(), { success: false, error: { code: 'BADGE_NOT_FOUND', message: 'Score badge not found.' } });
  }
  assert.equal(f.state.calls.includes('readAudit'), false);
  assert.equal(f.state.calls.includes('readScores'), false);
  assert.equal(f.state.writes.length, 0);
});

test('each public SVG view rereads both shares and final score without view writes, caching or conditional 304', async context => {
  const f = await fixture(context);
  const data = (await (await f.issue()).json()).data;
  const writes = f.state.writes.length;
  f.state.calls.length = 0;
  for (const headers of [{}, { 'if-none-match': '*', 'if-modified-since': 'Fri, 01 Jan 2100 00:00:00 GMT', 'cache-control': 'max-age=31536000' }]) {
    const response = await f.request('GET', data.badgeUrl, undefined, '', headers);
    assert.equal(response.status, 200);
    noCache(response);
    assert.equal(response.headers.get('content-type'), 'image/svg+xml; charset=utf-8');
    assert.equal(response.headers.get('etag'), null);
    assert.equal(response.headers.get('last-modified'), null);
    assert.match(response.headers.get('content-security-policy')!, /script-src 'none'/);
    assert.match(await response.text(), /Audit result: 81\/100/);
  }
  assert.deepEqual(f.state.calls, ['findByHash', 'findById', 'readAudit', 'readScores', 'findByHash', 'findById', 'readAudit', 'readScores']);
  assert.equal(f.state.writes.length, writes);
  f.state.scores!.overall = 70;
  assert.match(await (await f.request('GET', data.badgeUrl, undefined, '')).text(), /70\/100 \(C\)/);
  assert.equal(f.state.writes.length, writes);
});

test('every request rejects revoked/expired shares, changed ownership, missing/failed/deleted audits and missing scores', async context => {
  const f = await fixture(context);
  const data = (await (await f.issue()).json()).data;
  const badge = [...f.rows.values()].find(row => row.id === data.shareId)!;
  for (const row of [f.source, badge]) {
    const original = { ...row };
    for (const patch of [{ revoked_at: '2026-10-02T00:00:00Z' }, { expires_at: new Date(f.state.time).toISOString() },
      { expires_at: 'invalid' }, { user_id: 'other' }, { audit_id: OTHER_AUDIT_ID }, { project_id: 'other-project' }]) {
      Object.assign(row, original, patch);
      const response = await f.request('GET', data.badgeUrl, undefined, '');
      assert.equal(response.status, 404);
      noCache(response);
      assert.equal((await response.json()).error.message, 'Score badge not found.');
    }
    Object.assign(row, original);
  }
  const audit = f.state.audit!;
  for (const patch of [{ status: 'failed' as const }, { userId: 'changed-owner' }, { deletedAt: '2026-10-02T00:00:00Z' }, { completedAt: null }]) {
    f.state.audit = { ...audit, ...patch };
    assert.equal((await f.request('GET', data.badgeUrl, undefined, '')).status, 404);
  }
  f.state.audit = null;
  assert.equal((await f.request('GET', data.badgeUrl, undefined, '')).status, 404);
  f.state.audit = audit;
  f.state.scores = null;
  assert.equal((await f.request('GET', data.badgeUrl, undefined, '')).status, 404);
  assert.equal(f.state.writes.length, 1);
});

test('owner-scoped DELETE revokes badges and their prerequisite public shares immediately', async context => {
  const f = await fixture(context);
  const data = (await (await f.issue()).json()).data;
  const path = `/api/tools/audit/${AUDIT_ID}/shares/${data.shareId}`;
  for (const authorization of ['', 'Bearer other', 'Bearer admin']) {
    const response = await f.request('DELETE', path, undefined, authorization);
    assert.equal(response.status, authorization ? 404 : 401);
    noCache(response);
  }
  assert.equal(f.state.calls.includes('revoke'), false);
  assert.equal((await f.request('DELETE', `/api/tools/audit/${OTHER_AUDIT_ID}/shares/${data.shareId}`)).status, 404);
  const mismatchedShare = { ...f.source, id: randomUUID(), user_id: 'other-owner' };
  f.rows.set(hash('other'), mismatchedShare);
  assert.equal((await f.request('DELETE', `/api/tools/audit/${AUDIT_ID}/shares/${mismatchedShare.id}`)).status, 404);
  const deleted = await f.request('DELETE', path);
  assert.equal(deleted.status, 204);
  noCache(deleted);
  assert.equal((await f.request('GET', data.badgeUrl, undefined, '')).status, 404);
  assert.equal((await f.request('DELETE', path)).status, 204);
  const second = (await (await f.issue()).json()).data;
  assert.equal((await f.request('DELETE', `/api/tools/audit/${AUDIT_ID}/shares/${SOURCE_ID}`)).status, 204);
  assert.equal((await f.request('GET', second.badgeUrl, undefined, '')).status, 404);
  assert.equal((await f.issue()).status, 409);
});

test('owner-only permission listing rejects guests/admins/foreign audits before share reads', async context => {
  const f = await fixture(context);
  const path = `/api/tools/audit/${AUDIT_ID}/shares`;
  const unsigned = await f.request('GET', path, undefined, '');
  assert.equal(unsigned.status, 401);
  noCache(unsigned);
  assert.deepEqual(f.state.calls, ['getRequester']);
  for (const authorization of ['Bearer guest', 'Bearer admin', 'Bearer other']) {
    assert.equal((await f.request('GET', path, undefined, authorization)).status, 404);
  }
  assert.equal((await f.request('GET', `/api/tools/audit/${OTHER_AUDIT_ID}/shares`)).status, 404);
  assert.equal(f.state.calls.includes('listActive'), false);
  assert.equal(f.state.calls.includes('findByHash'), false);
  assert.equal(f.state.calls.includes('readScores'), false);
  assert.equal(f.state.listInputs.length, 0);
  assert.equal(f.state.writes.length, 0);
});

test('permission listing supports reload/revocation without tokens, hashes, kind claims or unbounded rows', async context => {
  const f = await fixture(context);
  const data = (await (await f.issue()).json()).data;
  const path = `/api/tools/audit/${AUDIT_ID}/shares`;
  f.rows.set(hash('foreign'), { ...f.source, id: randomUUID(), user_id: 'foreign-owner' });
  f.rows.set(hash('foreign-audit'), { ...f.source, id: randomUUID(), audit_id: OTHER_AUDIT_ID });
  f.rows.set(hash('revoked'), { ...f.source, id: randomUUID(), revoked_at: '2026-10-02T00:00:00Z' });
  f.rows.set(hash('expired'), { ...f.source, id: randomUUID(), expires_at: new Date(f.state.time).toISOString() });
  f.state.calls.length = 0;
  const response = await f.request('GET', path);
  assert.equal(response.status, 200);
  noCache(response);
  const body = await response.json();
  assert.equal(body.data.limit, 50);
  assert.deepEqual(body.data.shares.map((row: { id: string }) => row.id).sort(), [SOURCE_ID, data.shareId].sort());
  assert.deepEqual(f.state.listInputs, [{ auditId: AUDIT_ID, userId: OWNER, now: '2026-10-02T00:00:00.000Z' }]);
  assert.deepEqual(f.state.calls, ['getRequester', 'readAudit', 'listActive']);
  for (const row of body.data.shares) assert.deepEqual(Object.keys(row).sort(), ['expiresAt', 'id', 'revokedAt']);
  for (const secret of [f.token, AUDIT_ID, OWNER, 'token_hash', 'kind']) assert.ok(!JSON.stringify(body).includes(secret));
  assert.equal(f.state.writes.length, 1);
  assert.equal((await f.request('DELETE', `${path}/${data.shareId}`)).status, 204);
  assert.deepEqual((await (await f.request('GET', path)).json()).data.shares.map((row: { id: string }) => row.id), [SOURCE_ID]);

  const extra = Array.from({ length: 75 }, () => ({ ...f.source, id: randomUUID(), token_hash: 'do-not-expose', kind: 'unreliable' }));
  f.store.listActive = async () => [{ ...extra[0], revoked_at: '2026-10-02T00:00:00Z' },
    { ...extra[0], expires_at: new Date(f.state.time).toISOString() }, ...extra];
  const bounded = await f.request('GET', `${path}?limit=10000`);
  const boundedBody = await bounded.json();
  assert.equal(boundedBody.data.shares.length, 50);
  assert.ok(!JSON.stringify(boundedBody).includes('do-not-expose'));
  assert.ok(!JSON.stringify(boundedBody).includes('kind'));
  delete f.store.listActive;
  const unavailable = await f.request('GET', path);
  assert.equal(unavailable.status, 503);
  noCache(unavailable);
});

test('expiry crossing async score reads cannot produce a badge or new share', async context => {
  const f = await fixture(context);
  f.source.expires_at = new Date(f.state.time + 1).toISOString();
  f.state.afterScores = () => { f.state.time += 1; };
  assert.equal((await f.issue()).status, 409);
  assert.equal(f.state.writes.length, 0);
  f.state.afterScores = () => {};
  f.source.expires_at = new Date(f.state.time + 1).toISOString();
  const data = (await (await f.issue()).json()).data;
  f.state.afterScores = () => { f.state.time += 1; };
  assert.equal((await f.request('GET', data.badgeUrl, undefined, '')).status, 404);
});

test('injected auth/storage failures are sanitized, including errors marked as public by other APIs', async context => {
  const f = await fixture(context);
  const data = (await (await f.issue()).json()).data;
  for (const failAt of ['getRequester', 'readAudit', 'findByHash', 'readScores', 'issue']) {
    f.state.failAt = failAt;
    const response = await f.issue();
    assert.equal(response.status, 503);
    noCache(response);
    const body = await response.text();
    assert.ok(!body.includes(PRIVATE_ERROR));
    assert.ok(!body.includes(f.token));
    assert.ok(!body.includes(AUDIT_ID));
    assert.equal(JSON.parse(body).error.code, 'BADGE_UNAVAILABLE');
  }
  for (const failAt of ['findByHash', 'findById', 'readAudit', 'readScores']) {
    f.state.failAt = failAt;
    const response = await f.request('GET', data.badgeUrl, undefined, '');
    assert.equal(response.status, 503);
    noCache(response);
    assert.ok(!(await response.text()).includes(PRIVATE_ERROR));
  }
  f.state.failAt = 'revoke';
  assert.equal((await f.request('DELETE', `/api/tools/audit/${AUDIT_ID}/shares/${data.shareId}`)).status, 503);
  f.state.failAt = 'listActive';
  const list = await f.request('GET', `/api/tools/audit/${AUDIT_ID}/shares`);
  assert.equal(list.status, 503);
  noCache(list);
  assert.ok(!(await list.text()).includes(PRIVATE_ERROR));
});

test('bounded rate limits aggregate rotating tokens and audit/share IDs before any reads or writes', async context => {
  const f = await fixture(context);
  for (let index = 0; index < 120; index++) {
    assert.equal((await f.request('GET', `/api/tools/score-badges/unknown-${index}.svg`, undefined, '')).status, 404);
  }
  const limited = await f.request('GET', `/api/tools/score-badges/${f.token}.svg`, undefined, '');
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  noCache(limited);
  assert.equal(f.state.calls.length, 0);
  for (const method of ['POST', 'DELETE']) {
    for (let index = 0; index < 20; index++) {
      const path = `/api/tools/audit/${randomUUID()}/${method === 'POST' ? 'badge' : `shares/${randomUUID()}`}`;
      assert.equal((await f.request(method, path, method === 'POST' ? { confirm: true, shareToken: f.token } : undefined)).status, 404);
    }
    const count = f.state.calls.length;
    const path = `/api/tools/audit/${AUDIT_ID}/${method === 'POST' ? 'badge' : `shares/${SOURCE_ID}`}`;
    const response = await f.request(method, path, method === 'POST' ? { confirm: true, shareToken: f.token } : undefined);
    assert.equal(response.status, 429);
    noCache(response);
    assert.equal(f.state.calls.length, count);
  }
  assert.equal(f.state.writes.length, 0);
});

test('Supabase adapter reads only badge metadata/scalars and scopes revocation; SVG views issue no database writes', async context => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://badge-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  const f = await fixture(context, true);
  const issuedId = randomUUID();
  const issuedToken = `sb1.${SOURCE_ID}.${randomBytes(32).toString('base64url')}`;
  const badge = { ...f.source, id: issuedId };
  const requests: Array<{ url: URL; method: string; body: Record<string, unknown> | null }> = [];
  let durableAllowed = false;
  const realFetch = globalThis.fetch;
  context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === '127.0.0.1') return realFetch(input, init);
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ url, method, body });
    let rows: unknown = [];
    if (url.pathname === '/rest/v1/rpc/consume_api_rate_limit') rows = { allowed: durableAllowed, retry_after_seconds: 30 };
    if (url.pathname === '/rest/v1/audit_reports') rows = [f.state.scores];
    if (url.pathname === '/rest/v1/report_shares') {
      rows = method === 'GET' ? [url.searchParams.get('token_hash') === `eq.${hash(issuedToken)}` ? badge : f.source] : method === 'POST' ? { id: issuedId } : [{ id: issuedId }];
    }
    return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
  });
  try {
    const response = await f.request('GET', `/api/tools/score-badges/${issuedToken}.svg`, undefined, '');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /81\/100/);
    assert.equal(requests.length, 3);
    assert.ok(requests.every(request => request.method === 'GET'));
    assert.equal(requests[0].url.searchParams.get('token_hash'), `eq.${hash(issuedToken)}`);
    assert.equal(requests[1].url.searchParams.get('id'), `eq.${SOURCE_ID}`);
    assert.equal(requests[2].url.searchParams.get('audit_id'), `eq.${AUDIT_ID}`);
    assert.equal(requests[2].url.searchParams.get('select'), 'overall:scores->overall,scoringVersion:scores->scoringVersion,coverage:scores->coverage');
    for (const request of requests.slice(0, 2)) assert.equal(request.url.searchParams.get('select'), 'id,audit_id,project_id,user_id,expires_at,revoked_at');
    assert.ok(!JSON.stringify(requests).includes(issuedToken));
    const permissions = await f.request('GET', `/api/tools/audit/${AUDIT_ID}/shares`);
    assert.equal(permissions.status, 200);
    noCache(permissions);
    const listing = requests.at(-1)!;
    assert.equal(listing.url.pathname, '/rest/v1/report_shares');
    assert.equal(listing.method, 'GET');
    assert.equal(listing.url.searchParams.get('select'), 'id,expires_at,revoked_at');
    assert.equal(listing.url.searchParams.get('audit_id'), `eq.${AUDIT_ID}`);
    assert.equal(listing.url.searchParams.get('user_id'), `eq.${OWNER}`);
    assert.equal(listing.url.searchParams.get('revoked_at'), 'is.null');
    assert.equal(listing.url.searchParams.get('expires_at'), 'gt.2026-10-02T00:00:00.000Z');
    assert.equal(listing.url.searchParams.get('limit'), '50');
    assert.equal(listing.url.searchParams.get('token_hash'), null);
    assert.deepEqual(Object.keys((await permissions.json()).data.shares[0]).sort(), ['expiresAt', 'id', 'revokedAt']);
    const denied = await f.issue();
    assert.equal(denied.status, 429);
    noCache(denied);
    assert.equal(denied.headers.get('retry-after'), '3600');
    assert.equal(requests.filter(request => request.url.pathname === '/rest/v1/report_shares' && request.method === 'POST').length, 0);
    durableAllowed = true;
    assert.equal((await f.issue()).status, 201);
    const durable = requests.find(request => request.url.pathname === '/rest/v1/rpc/consume_api_rate_limit')!;
    assert.equal(durable.body!.p_namespace, 'score-badge-issue');
    assert.equal(durable.body!.p_limit, 20);
    assert.equal(durable.body!.p_window_seconds, 3600);
    assert.match(String(durable.body!.p_identifier_hash), /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(durable.body).includes(OWNER));
    assert.equal((await readScoreBadgeScores(AUDIT_ID))!.overall, 81);
    assert.equal((await supabaseScoreBadgeShares.findByHash(hash(f.token)))!.id, SOURCE_ID);
    assert.equal((await supabaseScoreBadgeShares.findById(SOURCE_ID))!.id, SOURCE_ID);
    await supabaseScoreBadgeShares.issue({ audit_id: AUDIT_ID, project_id: null, user_id: OWNER, token_hash: hash(issuedToken), expires_at: f.source.expires_at });
    assert.equal(await supabaseScoreBadgeShares.revoke({ id: issuedId, auditId: AUDIT_ID, userId: OWNER, revokedAt: '2026-10-02T00:00:00Z' }), true);
    const insert = requests.find(request => request.method === 'POST' && request.url.pathname === '/rest/v1/report_shares')!;
    assert.deepEqual(Object.keys(insert.body!).sort(), ['audit_id', 'expires_at', 'project_id', 'token_hash', 'user_id']);
    const revoke = requests.find(request => request.method === 'PATCH')!;
    assert.deepEqual(revoke.body, { revoked_at: '2026-10-02T00:00:00Z' });
    assert.equal(revoke.url.searchParams.get('id'), `eq.${issuedId}`);
    assert.equal(revoke.url.searchParams.get('audit_id'), `eq.${AUDIT_ID}`);
    assert.equal(revoke.url.searchParams.get('user_id'), `eq.${OWNER}`);
    assert.ok(requests.every(request => ['/rest/v1/report_shares', '/rest/v1/audit_reports', '/rest/v1/rpc/consume_api_rate_limit'].includes(request.url.pathname)));
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});
