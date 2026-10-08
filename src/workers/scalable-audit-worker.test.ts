import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { auditRepository, toAuditDocument } from '../lib/supabase/audit-repository';
import { frontierItem, type CrawlRun } from '../lib/supabase/scalable-audit-repository';
import { SCORING_VERSION } from '../lib/platform/version';
import { parseHtml } from '../lib/seo/html-parser';
import { analyseScalableItem, runScalableSlice } from './scalable-audit-worker';
import { HostRequestScheduler } from './host-request-scheduler';
import { requestScalableWorkerStop } from './scalable-worker-lifecycle';

const origin = 'https://example.com';
const auditRow = {
  id: 'worker-fixture-audit', normalized_url: `${origin}/`, submitted_input: origin, hostname: 'example.com',
  effective_mode: 'standard', mode: 'standard', page_limit: 50, processing_version: 2, status: 'running',
};
const audit = toAuditDocument(auditRow)!;
const initialRun: CrawlRun = {
  audit_id: audit.id, generation: 7, owner: 'fixture-worker', active_ms: 0, budget_ms: 7_200_000,
  candidate_limit: 200, discovered: 1, attempted: 0, analysed: 0, failed: 0, blocked: 0,
  page_count: 0, error_pages: 0, redirect_pages: 0, slow_pages: 0, large_pages: 0,
  check_count: 0, unavailable_count: 0, failure_count: 0, discovery_documents: 0,
  last_score_pages: 0, last_score_at: null,
  metadata: { initialized: true, scoringVersion: SCORING_VERSION, measuredCategories: [] },
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json' },
});
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(context: TestContext) {
  const keys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'AUDIT_WORKER_RSS_LIMIT_MB'];
  const saved = keys.map(key => [key, process.env[key]] as const);
  process.env.SUPABASE_URL = 'https://audit-worker-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service-role-key';
  process.env.AUDIT_WORKER_RSS_LIMIT_MB = '65536';
  context.after(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const timers = new Set<() => void>();
  const state = {
    run: structuredClone(initialRun), released: false, claims: 0, frontierReads: 0,
    commits: [] as Record<string, any>[], finishes: [] as Record<string, any>[],
    onClaim: async () => {}, onCommit: async (_payload: Record<string, any>) => {},
    onFinish: async () => {}, onPages: async () => {}, onAudit: async () => {},
    onFrontier: async () => {}, pending: false, items: [] as ReturnType<typeof frontierItem>[],
    tick: () => { for (const timer of timers) timer(); },
    activeTimers: () => timers.size,
  };
  context.mock.method(globalThis, 'setInterval', (callback: () => void) => {
    timers.add(callback);
    return { unref() {}, callback } as unknown as NodeJS.Timeout;
  });
  context.mock.method(globalThis, 'clearInterval', (timer: NodeJS.Timeout) => {
    timers.delete((timer as unknown as { callback: () => void }).callback);
  });
  context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(url.hostname, 'audit-worker-test.supabase.co', 'Tests must not make external requests.');
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const args = JSON.parse(await request.text());
      switch (url.pathname.split('/').at(-1)) {
        case 'read_scalable_audit_frontier':
          return json({code:'PGRST202',message:'read_scalable_audit_frontier is absent in the rollback fixture'},404);
        case 'claim_efficient_scoped_audit':
          state.claims++;
          state.run.owner = args.p_worker;
          await state.onClaim();
          return json({ audit: auditRow, run: state.run, scoreGroups: [], pending: state.pending });
        case 'renew_scalable_audit_lease':
        case 'scalable_audit_commit_efficient': {
          const renewal = url.pathname.endsWith('/renew_scalable_audit_lease');
          const payload = args.p_payload || { renewal: true };
          state.commits.push(payload);
          assert.equal(args.p_generation, state.run.generation);
          assert.equal(args.p_worker, state.run.owner);
          if (state.released) return json({ message: 'AUDIT_OWNERSHIP_LOST' }, 400);
          try { await state.onCommit(payload); }
          catch (error) { return json({ message: String(error) }, 400); }
          state.run.metadata = { ...state.run.metadata, ...payload.metadata };
          return json(renewal ? true : { run: state.run, scoreGroups: [], pending: state.pending });
        }
        case 'scalable_audit_finish_slice':
          state.finishes.push(args);
          assert.equal(args.p_generation, state.run.generation);
          assert.equal(args.p_worker, state.run.owner);
          state.released = true;
          await state.onFinish();
          return json(true);
        default: throw new Error(`Unexpected RPC: ${url.pathname}`);
      }
    }
    if (url.pathname === '/rest/v1/audit_score_groups') return json([]);
    assert.equal(url.pathname, '/rest/v1/audit_crawl_frontier');
    if (url.searchParams.get('select') === 'key') return json(state.pending ? [{ key: 'pending' }] : []);
    state.frontierReads++;
    await state.onFrontier();
    return json(state.items.filter(item => `eq.${item.kind}` === url.searchParams.get('kind')));
  });
  context.mock.method(auditRepository, 'getLatestPages', async () => { await state.onPages(); return []; });
  context.mock.method(auditRepository, 'getLatestIssues', async () => []);
  context.mock.method(auditRepository, 'getAudit', async () => { await state.onAudit(); return { ...audit, status: 'failed' as const }; });
  return state;
}

test('terminal finalization drains the in-flight lease renewal before releasing ownership', async context => {
  const state = fixture(context);
  const entered = deferred(), release = deferred();
  let renewalFinished = false;
  state.onCommit = async () => { entered.resolve(); await release.promise; renewalFinished = true; };
  state.onPages = async () => { state.tick(); await entered.promise; };
  state.onFinish = async () => {
    assert.equal(renewalFinished, true);
    assert.equal(state.activeTimers(), 0);
    state.tick();
    await flush();
  };
  const task = runScalableSlice('finish-worker');
  const result = task.then(value => ({ value }), error => ({ error }));
  await entered.promise;
  await flush();
  const earlyFinishes = state.finishes.length;
  release.resolve();
  assert.equal(earlyFinishes, 0);
  assert.deepEqual(await result, { value: true });
  assert.equal(state.commits.length, 1);
  assert.equal(state.finishes.length, 1);
  assert.ok(state.finishes[0].p_report);
});

test('lease renewal remains single-flight during a slow database write', async context => {
  const state = fixture(context);
  state.pending = true;
  const frontierEntered = deferred(), frontierRelease = deferred();
  const commitEntered = deferred(), commitRelease = deferred();
  state.onFrontier = async () => { frontierEntered.resolve(); await frontierRelease.promise; };
  state.onCommit = async () => { commitEntered.resolve(); await commitRelease.promise; };
  const task = runScalableSlice('slow-database-worker');
  await frontierEntered.promise;
  for (let i = 0; i < 5; i++) state.tick();
  await commitEntered.promise;
  commitRelease.resolve();
  await flush();
  const commitCount = state.commits.length;
  frontierRelease.resolve();
  assert.equal(await task, true);
  assert.equal(commitCount, 1);
  assert.equal(state.finishes.length, 1);
  assert.equal(state.finishes[0].p_report, null);
  assert.equal(state.activeTimers(), 0);
});

test('ownership loss during report reads prevents terminal or pause finalization', async context => {
  const state = fixture(context);
  state.onCommit = async () => { throw new Error('AUDIT_OWNERSHIP_LOST'); };
  state.onPages = async () => { state.tick(); await flush(); };
  await assert.rejects(runScalableSlice('cancelled-worker'), /AUDIT_OWNERSHIP_LOST/);
  assert.equal(state.commits.length, 1);
  assert.equal(state.finishes.length, 0);
  assert.equal(state.activeTimers(), 0);
});

test('a transient renewal failure pauses for resume without publishing a terminal report', async context => {
  const state = fixture(context);
  state.onCommit = async () => { throw new Error('database temporarily unavailable'); };
  state.onPages = async () => { state.tick(); await flush(); };
  await assert.rejects(runScalableSlice('transient-renewal-worker'), /database temporarily unavailable/);
  assert.equal(state.commits.length, 1);
  assert.equal(state.finishes.length, 1);
  assert.equal(state.finishes[0].p_report, null);
  assert.equal(state.finishes[0].p_reason, 'Audit paused after a service error; retrying');
  assert.equal(state.activeTimers(), 0);
});

test('activity reporting failure releases the claimed slice and attempts idle cleanup', async context => {
  const state = fixture(context);
  const activity: Array<string | null> = [];
  await assert.rejects(runScalableSlice('activity-worker', id => {
    activity.push(id);
    throw new Error(id ? 'activity unavailable' : 'idle unavailable');
  }), /activity unavailable/);
  assert.deepEqual(activity, [audit.id, null]);
  assert.equal(state.finishes.length, 1);
  assert.equal(state.finishes[0].p_report, null);
  assert.equal(state.commits.length, 0);
  assert.equal(state.activeTimers(), 0);
});

test('idle reporting failure does not turn a finalized audit into a failed slice', async context => {
  const state = fixture(context);
  assert.equal(await runScalableSlice('idle-worker', async id => {
    if (id === null) throw new Error('idle unavailable');
  }), true);
  assert.equal(state.finishes.length, 1);
  assert.equal(state.activeTimers(), 0);
});

test('a post-finalization read failure never attempts to release the lease twice', async context => {
  const state = fixture(context);
  state.onAudit = async () => { throw new Error('completion read unavailable'); };
  await assert.rejects(runScalableSlice('completion-read-worker'), /completion read unavailable/);
  assert.equal(state.finishes.length, 1);
  assert.equal(state.activeTimers(), 0);
});

test('shutdown requested during claim releases without seeding or reading crawl work', async context => {
  const state = fixture(context);
  state.run.metadata = {};
  state.onClaim = async () => { requestScalableWorkerStop('shutdown-claim-worker'); };
  assert.equal(await runScalableSlice('shutdown-claim-worker'), true);
  assert.equal(state.claims, 1);
  assert.equal(state.commits.length, 0);
  assert.equal(state.frontierReads, 0);
  assert.equal(state.finishes.length, 1);
  assert.equal(state.finishes[0].p_report, null);
  assert.equal(await runScalableSlice('shutdown-claim-worker'), false);
  assert.equal(state.claims, 1);
});

test('shutdown requested during a frontier read starts no new network operations', async context => {
  const state = fixture(context);
  state.pending = true;
  state.items = [{ ...frontierItem(`${origin}/sitemap.xml`, 'sitemap'), next_attempt_at: '2020-01-01T00:00:00.000Z' }];
  state.onFrontier = async () => { requestScalableWorkerStop('shutdown-read-worker'); };
  let fetches = 0;
  context.mock.method(HostRequestScheduler.prototype, 'schedule', async () => { fetches++; throw new Error('unexpected fetch'); });
  assert.equal(await runScalableSlice('shutdown-read-worker'), true);
  assert.equal(fetches, 0);
  assert.equal(state.commits.length, 0);
  assert.equal(state.finishes.length, 1);
});

test('shutdown checkpoints an already in-flight page before releasing the slice', async context => {
  const state = fixture(context);
  state.pending = true;
  const item = { ...frontierItem(`${origin}/`, 'page'), next_attempt_at: '2020-01-01T00:00:00.000Z' };
  state.items = [item];
  const html = '<!doctype html><html lang="en"><head><title>Fixture</title></head><body><h1>Fixture</h1></body></html>';
  let fetches = 0;
  context.mock.method(HostRequestScheduler.prototype, 'schedule', async () => {
    fetches++;
    requestScalableWorkerStop('shutdown-flight-worker');
    return { url: item.url, finalUrl: item.url, statusCode: 200, responseTimeMs: 10, pageSizeBytes: html.length,
      headers: {}, contentType: 'text/html', html, parsed: parseHtml(html, item.url) };
  });
  assert.equal(await runScalableSlice('shutdown-flight-worker'), true);
  assert.equal(fetches, 1);
  assert.equal(state.commits.length, 1);
  assert.equal(state.commits[0].items[0].key, item.key);
  assert.equal(state.commits[0].items[0].page.fetch_status, 'success');
  assert.equal(state.finishes.length, 1);
  assert.equal(state.finishes[0].p_report, null);
  assert.equal(state.activeTimers(), 0);
});

test('transient sitemap transport errors retry twice before recording discovery failure', async context => {
  const scheduler = new HostRequestScheduler(1, 0);
  context.mock.method(scheduler, 'schedule', async () => { throw Object.assign(new Error('temporary DNS'), { code: 'EAI_AGAIN' }); });
  const item = frontierItem(`${origin}/sitemap.xml`, 'sitemap');
  for (const attempts of [0, 1]) {
    const result = await analyseScalableItem(audit, initialRun, { ...item, attempts }, scheduler);
    assert.equal(result.key, item.key);
    assert.equal(typeof result.retryAt, 'string');
    assert.equal(result.children, undefined);
    assert.equal(result.discoveryErrors, undefined);
  }
  const exhausted = await analyseScalableItem(audit, initialRun, { ...item, attempts: 2 }, scheduler);
  assert.equal(exhausted.retryAt, undefined);
  assert.deepEqual(exhausted.discoveryErrors, ['Sitemap unavailable']);
  assert.deepEqual(exhausted.children, []);
});

test('non-retryable sitemap errors and robots restrictions retain their existing behavior', async context => {
  const scheduler = new HostRequestScheduler(1, 0);
  let fetches = 0;
  context.mock.method(scheduler, 'schedule', async () => {
    fetches++;
    throw Object.assign(new Error('private address'), { code: 'PRIVATE_NETWORK_BLOCKED' });
  });
  const sitemap = frontierItem(`${origin}/sitemap.xml`, 'sitemap');
  const failure = await analyseScalableItem(audit, initialRun, sitemap, scheduler);
  assert.equal(failure.retryAt, undefined);
  assert.deepEqual(failure.discoveryErrors, ['Sitemap unavailable']);
  const blockedRun = { ...initialRun, metadata: { ...initialRun.metadata, robotsUnavailable: true } };
  assert.deepEqual(await analyseScalableItem(audit, blockedRun, sitemap, scheduler), { key: sitemap.key, children: [] });
  const page = await analyseScalableItem(audit, blockedRun, frontierItem(`${origin}/private`, 'page'), scheduler);
  assert.equal((page.page as Record<string, unknown>).fetch_status, 'blocked');
  assert.equal((page.page as Record<string, unknown>).failure_code, 'ROBOTS_BLOCKED');
  assert.equal(fetches, 1);
});
