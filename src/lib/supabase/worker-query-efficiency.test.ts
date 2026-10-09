import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test, type TestContext } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { auditRepository } from './audit-repository';
import { frontierItem, readFrontier, type FrontierItem } from './scalable-audit-repository';

const auditId = '00000000-0000-0000-0000-000000000001';
const otherAuditId = '00000000-0000-0000-0000-000000000002';
const now = Date.parse('2026-10-03T00:00:00Z');
const due = new Date(now - 60_000).toISOString();
const later = new Date(now + 60_000).toISOString();
type Row = FrontierItem & { audit_id: string; state: string };
const row = (name: string, kind: FrontierItem['kind'], depth = 0, retryAt = due): Row => ({
  ...frontierItem(`https://example.com/${name}`, kind, depth, 'https://example.com/', 'Fixture'),
  audit_id: auditId, state: 'pending', attempts: 1, discovery_offset: 100, next_attempt_at: retryAt,
});
const json = (data: unknown, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', ...headers },
});
function setup(context: TestContext) {
  const saved = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].map(key => [key, process.env[key]] as const);
  process.env.SUPABASE_URL = 'https://worker-query-fixture.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only';
  context.after(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}
function oldFrontier(rows: Row[], limit: number, timestamp: number) {
  let calls = 0;
  for (const kind of ['robots', 'root', 'sitemap', 'page']) {
    calls++;
    const data = rows.filter(item => item.audit_id === auditId && item.state === 'pending'
      && item.kind === (kind === 'root' ? 'page' : kind) && (kind !== 'root' || item.depth === 0)
      && (kind === 'robots' || Date.parse(item.next_attempt_at!) <= timestamp))
      .sort((a, b) => a.depth - b.depth || a.key.localeCompare(b.key)).slice(0, Math.min(2, limit));
    const ready = data.filter(item => Date.parse(item.next_attempt_at!) <= timestamp);
    if (ready.length) return { items: ready, calls };
    if (kind === 'robots' && data.length) return { items: [], calls };
  }
  return { items: [], calls };
}
const compact = (items: FrontierItem[]) => items.map(item => ({
  key: item.key, url: item.url, kind: item.kind, depth: item.depth, source_url: item.source_url,
  anchor: item.anchor, attempts: item.attempts, discovery_offset: item.discovery_offset,
  next_attempt_at: new Date(item.next_attempt_at!).toISOString(),
}));

test('migration 033 matches old bounded frontier selection with one read-only service RPC', async context => {
  setup(context);
  context.mock.method(Date, 'now', () => now);
  const db = new PGlite();
  context.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.audit_crawl_frontier (
      audit_id uuid, key text, url text, kind text, depth int, source_url text, anchor text,
      attempts int, next_attempt_at timestamptz, discovery_offset int, state text,
      primary key(audit_id,key)
    );
    create index audit_crawl_frontier_pending on audit_crawl_frontier(audit_id,kind,depth,key) where state='pending';
    grant select on public.audit_crawl_frontier to service_role;
  `);
  await db.exec(await readFile(new URL('../../../supabase/migrations/033_performance_optimization.sql', import.meta.url), 'utf8'));
  await db.exec('begin');
  const databaseNow = Math.floor(Number((await db.query<{ ms: string }>('select extract(epoch from now())*1000 as ms')).rows[0].ms));
  let rpcCalls = 0;
  context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(url.hostname, 'worker-query-fixture.supabase.co');
    assert.equal(url.pathname, '/rest/v1/rpc/read_scalable_audit_frontier');
    rpcCalls++;
    const args = JSON.parse(await request.text());
    const result = await db.query<{ batch: FrontierItem[] }>(
      'select public.read_scalable_audit_frontier($1,$2) as batch', [args.p_audit, args.p_limit]);
    return json(result.rows[0].batch);
  });
  const cases: Array<{ name: string; rows: Row[]; limit?: number }> = [
    { name: 'ready robots first', rows: [row('robots', 'robots'), row('root', 'page'), row('map', 'sitemap')] },
    { name: 'robots backoff gates root and sitemap', rows: [row('robots', 'robots', 0, later), row('root', 'page'), row('map', 'sitemap')] },
    { name: 'root before sitemap', rows: [row('root', 'page'), row('map', 'sitemap'), row('child', 'page', 1)] },
    { name: 'root backoff allows sitemap', rows: [row('root', 'page', 0, later), row('map', 'sitemap')] },
    { name: 'sitemap before shallower page', rows: [row('map', 'sitemap', 5), row('child', 'page', 1)] },
    { name: 'sitemap backoff allows page', rows: [row('map', 'sitemap', 0, later), row('child', 'page', 1)] },
    { name: 'depth then stable key, not retry time', rows: [row('deep', 'page', 3), row('one', 'page', 1), row('two', 'page', 1, new Date(now - 120_000).toISOString())] },
    { name: 'only future pages', rows: [row('root', 'page', 0, later), row('child', 'page', 1, later)] },
    { name: 'empty', rows: [] },
    { name: 'other audits and done rows ignored', rows: [{ ...row('robots', 'robots'), state: 'done' }, { ...row('other', 'robots'), audit_id: otherAuditId }, row('child', 'page', 1)] },
    { name: 'first-page limit one', rows: [row('one', 'page', 0), row('two', 'page', 0)], limit: 1 },
    { name: 'batch ceiling two', rows: [row('one', 'page', 1), row('two', 'page', 1), row('three', 'page', 1)], limit: 100 },
  ];
  const robots = ['one', 'two', 'three'].map(name => row(name, 'robots')).sort((a, b) => a.key.localeCompare(b.key));
  cases.push({ name: 'later ready robots do not bypass first-two backoff', rows: robots.map((item, i) => ({ ...item, next_attempt_at: i < 2 ? later : due })) });
  cases.push({ name: 'ready subset of first robots batch', rows: robots.map((item, i) => ({ ...item, next_attempt_at: i === 0 ? later : due })) });
  for (const fixture of cases) {
    await db.exec('delete from public.audit_crawl_frontier');
    for (const item of fixture.rows) {
      const retryAt = new Date(databaseNow + Date.parse(item.next_attempt_at!) - now).toISOString();
      await db.query(`insert into audit_crawl_frontier values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [item.audit_id, item.key, item.url, item.kind, item.depth, item.source_url, item.anchor, item.attempts, retryAt, item.discovery_offset, item.state]);
    }
    const before = await db.query('select * from audit_crawl_frontier order by audit_id,key');
    const expected = oldFrontier(fixture.rows, fixture.limit || 2, now);
    const start = rpcCalls;
    const actual = await readFrontier(auditId, fixture.limit || 2);
    const normalized = actual.map(item => ({ ...item, next_attempt_at: new Date(Date.parse(item.next_attempt_at!) - databaseNow + now).toISOString() }));
    assert.deepEqual(compact(normalized), compact(expected.items), fixture.name);
    assert.equal(rpcCalls - start, 1);
    assert.deepEqual(await db.query('select * from audit_crawl_frontier order by audit_id,key'), before, 'read RPC must not mutate frontier');
    context.diagnostic(`${fixture.name}: ${expected.calls} legacy calls -> 1 RPC`);
  }
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set local role ${role}`);
    await assert.rejects(db.query('select public.read_scalable_audit_frontier($1,2)', [auditId]), /permission denied/);
    // Rollback also resets the transaction-local role after denial.
    await db.exec('rollback');
    await db.exec('begin');
  }
  await db.exec('set local role service_role');
  await db.query('select public.read_scalable_audit_frontier($1,2)', [auditId]);
  await db.exec('rollback');
});

test('only the named missing RPC falls back, with a bounded rollback probe cache', async context => {
  setup(context);
  let timestamp = now + 120_000;
  context.mock.method(Date, 'now', () => timestamp);
  let failure = { code: 'PGRST202', message: 'Could not find public.read_scalable_audit_frontier in the schema cache' };
  let calls: string[] = [];
  const fixtures = [row('map', 'sitemap')];
  context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(new Request(input, init).url);
    assert.equal(url.hostname, 'worker-query-fixture.supabase.co');
    if (url.pathname.endsWith('/rpc/read_scalable_audit_frontier')) {
      calls.push('rpc');
      return json(failure, 404);
    }
    assert.equal(url.pathname, '/rest/v1/audit_crawl_frontier');
    const kind = url.searchParams.get('kind');
    calls.push(kind!);
    return json(fixtures.filter(item => kind === `eq.${item.kind}`));
  });
  assert.deepEqual(compact(await readFrontier(auditId)), compact(fixtures));
  assert.deepEqual(calls, ['rpc', 'eq.robots', 'eq.page', 'eq.sitemap']);
  calls = [];
  await readFrontier(auditId);
  assert.deepEqual(calls, ['eq.robots', 'eq.page', 'eq.sitemap']);
  for (const error of [
    { code: '42501', message: 'read_scalable_audit_frontier permission denied' },
    { code: '57014', message: 'statement timeout' },
    { code: '42883', message: 'internal helper does not exist' },
    { code: 'PGRST202', message: 'Could not find a_different_function' },
    { code: '503', message: 'database unavailable' },
  ]) {
    timestamp += 60_001;
    failure = error;
    calls = [];
    await assert.rejects(readFrontier(auditId), (thrown: { code?: string }) => thrown.code === error.code);
    assert.deepEqual(calls, ['rpc'], 'generic errors must not cause more database reads');
  }
});

test('history summary selects compact fields and retains pagination, counts, status and UI data', async context => {
  setup(context);
  const full = {
    id: auditId, user_id: 'user', project_id: 'project', processing_version: 2, submitted_input: 'example.com',
    normalized_url: 'https://example.com/', hostname: 'example.com', mode: 'standard', effective_mode: 'standard',
    status: 'completed_with_warnings', pages_crawled: 42, pages_discovered: 60, page_limit: 50,
    issues_found: 12, critical_count: 1, high_count: 2, medium_count: 3, low_count: 6,
    progress: 100, checks_total: 420, checks_completed: 420, warning_count: 2, failure_counts: { HTTP_404: 2 },
    created_at: due, updated_at: due, started_at: due, completed_at: due, expires_at: later,
    archived_at: null, guest_key_hash: 'not-history-data', locked_by: 'worker', locked_at: due,
    lease_expires_at: later, checkpoint_pages_crawled: 42, checkpoint_updated_at: due,
    checkpoint_state: { scheduled: Array.from({ length: 300 }, (_, i) => ({ url: `https://example.com/${i}/${'x'.repeat(650)}`, depth: 1 })) },
  };
  let selected: string[] = [];
  let summaryBytes = 0;
  context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(url.hostname, 'worker-query-fixture.supabase.co');
    if (url.pathname.endsWith('/audit_reports')) {
      return json([{ audit_id: auditId, scores: { overall: 81 }, summary: 'Measured report', generated_at: due }]);
    }
    assert.equal(url.pathname, '/rest/v1/audits');
    assert.equal(url.searchParams.get('user_id'), 'eq.user');
    assert.equal(url.searchParams.get('status'), 'eq.completed_with_warnings');
    assert.equal(url.searchParams.get('hostname'), 'eq.example.com');
    assert.equal(url.searchParams.get('archived_at'), 'is.null');
    assert.match(request.headers.get('prefer')!, /count=exact/);
    const select = url.searchParams.get('select')!;
    selected = select.split(',');
    const result = select === '*' ? full : Object.fromEntries(Object.entries(full).filter(([key]) => selected.includes(key)));
    summaryBytes = Buffer.byteLength(JSON.stringify(result));
    return json([result], 200, { 'content-range': '5-5/37' });
  });
  const input = { userId: 'user', status: full.status, hostname: full.hostname, limit: 12, offset: 5 };
  const summary = await auditRepository.listAuditHistoryForUser({ ...input, summaryOnly: true });
  assert.equal(summary.total, 37);
  assert.equal(summary.limit, 12);
  assert.equal(summary.offset, 5);
  const audit = summary.items[0].audit;
  assert.deepEqual([audit.pagesCrawled, audit.issuesFound, audit.criticalCount, audit.highCount, audit.mediumCount, audit.lowCount], [42, 12, 1, 2, 3, 6]);
  assert.equal(audit.status, full.status);
  assert.equal(audit.processingVersion, 2);
  assert.equal(audit.projectId, 'project');
  assert.equal(audit.startedAt, due);
  assert.equal(audit.checkpointPagesCrawled, 42);
  assert.equal(audit.checkpointState, null);
  assert.equal(audit.lockedBy, null);
  assert.equal(summary.items[0].finalReport?.scores.overall, 81);
  for (const field of ['*', 'checkpoint_state', 'guest_key_hash', 'locked_by', 'locked_at', 'lease_expires_at']) assert.ok(!selected.includes(field));
  context.diagnostic(`Synthetic checkpoint-heavy audit: ${Buffer.byteLength(JSON.stringify(full))} -> ${summaryBytes} audit-row bytes; still 2 history queries.`);
  const complete = await auditRepository.listAuditHistoryForUser(input);
  assert.deepEqual(selected, ['*']);
  assert.deepEqual(complete.items[0].audit.checkpointState, full.checkpoint_state);
});
