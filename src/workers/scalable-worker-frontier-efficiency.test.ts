import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { auditRepository, toAuditDocument, toAuditPage } from '../lib/supabase/audit-repository';
import { frontierItem, type CrawlRun, type FrontierItem } from '../lib/supabase/scalable-audit-repository';
import { SCORING_VERSION } from '../lib/platform/version';
import { parseHtml } from '../lib/seo/html-parser';
import { HostRequestScheduler } from './host-request-scheduler';
import { runScalableSlice } from './scalable-audit-worker';

const origin = 'https://example.com';
const row = {
  id: '00000000-0000-0000-0000-000000000001', normalized_url: `${origin}/`, submitted_input: origin,
  hostname: 'example.com', effective_mode: 'standard', mode: 'standard', page_limit: 3,
  processing_version: 2, status: 'running',
};
const audit = toAuditDocument(row)!;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json' },
});
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function fixture(context: TestContext, items: FrontierItem[]) {
  const saved = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'AUDIT_WORKER_RSS_LIMIT_MB'].map(key => [key, process.env[key]] as const);
  process.env.SUPABASE_URL = 'https://frontier-worker-fixture.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only';
  process.env.AUDIT_WORKER_RSS_LIMIT_MB = '65536';
  context.after(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const run: CrawlRun = {
    audit_id: audit.id, generation: 7, owner: 'fixture', active_ms: 0, budget_ms: 7_200_000,
    candidate_limit: 12, discovered: 3, attempted: 0, analysed: 0, failed: 0, blocked: 0, page_count: 0,
    error_pages: 0, redirect_pages: 0, slow_pages: 0, large_pages: 0, check_count: 0, unavailable_count: 0,
    failure_count: 0, discovery_documents: 0, last_score_pages: 0, last_score_at: null,
    metadata: { initialized: true, scoringVersion: SCORING_VERSION, measuredCategories: [] },
  };
  const state = {
    run, pending: [...items], limits: [] as number[], commits: [] as Record<string, any>[],
    finishes: [] as Record<string, any>[], pages: [] as Record<string, any>[], requests: [] as string[],
    loseOwnership: false, inFlight: 0, maxInFlight: 0, reportReads: 0, failFinish: false,
  };
  context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(url.hostname, 'frontier-worker-fixture.supabase.co', 'No production or target network calls are allowed.');
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const args = JSON.parse(await request.text());
      switch (url.pathname.split('/').at(-1)) {
        case 'claim_scalable_audit':
          run.owner = args.p_worker;
          return json({ audit: row, run });
        case 'read_scalable_audit_frontier': {
          assert.equal(args.p_audit, audit.id);
          state.limits.push(args.p_limit);
          const robots = state.pending.filter(item => item.kind === 'robots');
          const ready = (values: FrontierItem[]) => values.filter(item => Date.parse(item.next_attempt_at!) <= Date.now());
          const ordered = (values: FrontierItem[]) => values.sort((a, b) => a.depth - b.depth || a.key.localeCompare(b.key)).slice(0, args.p_limit);
          if (robots.length) return json(ready(ordered(robots)));
          for (const group of [
            state.pending.filter(item => item.kind === 'page' && item.depth === 0),
            state.pending.filter(item => item.kind === 'sitemap'),
            state.pending.filter(item => item.kind === 'page'),
          ]) {
            const batch = ordered(ready(group));
            if (batch.length) return json(batch);
          }
          return json([]);
        }
        case 'scalable_audit_commit': {
          assert.equal(args.p_worker, run.owner);
          assert.equal(args.p_generation, 7);
          if (state.loseOwnership) return json({ message: 'AUDIT_OWNERSHIP_LOST' }, 400);
          const payload = args.p_payload;
          state.commits.push(payload);
          run.metadata = { ...run.metadata, ...payload.metadata };
          for (const result of payload.items || []) {
            state.pending = state.pending.filter(item => item.key !== result.key);
            if (result.page) {
              state.pages.push(result.page);
              run.analysed++;
              run.attempted++;
              run.page_count++;
            } else run.discovery_documents++;
            run.check_count += result.checks || 0;
          }
          if (payload.score) {
            run.last_score_pages = run.analysed;
            run.last_score_at = payload.score.updatedAt;
          }
          return json(run);
        }
        case 'scalable_audit_finish_slice':
          assert.equal(args.p_worker, run.owner);
          assert.equal(args.p_generation, 7);
          state.finishes.push(args);
          return json(!state.failFinish);
        default: throw new Error(`Unexpected RPC ${url.pathname}`);
      }
    }
    if (url.pathname.endsWith('/audit_score_groups')) return json([]);
    assert.equal(url.pathname, '/rest/v1/audit_crawl_frontier');
    assert.equal(url.searchParams.get('select'), 'key');
    return json(state.pending.length ? [{ key: state.pending[0].key }] : []);
  });
  context.mock.method(auditRepository, 'getLatestPages', async () => {
    state.reportReads++;
    return state.pages.map(toAuditPage);
  });
  context.mock.method(auditRepository, 'getLatestIssues', async () => []);
  context.mock.method(auditRepository, 'getAudit', async () => ({ ...audit, status: 'completed' as const }));
  context.mock.method(HostRequestScheduler.prototype, 'schedule', async (url: string) => {
    state.requests.push(url);
    state.inFlight++;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    await flush();
    state.inFlight--;
    if (url.endsWith('/robots.txt') || url.endsWith('/sitemap.xml')) {
      return { status: 200, body: url.endsWith('/robots.txt') ? 'User-agent: *\nDisallow:\n' : '<urlset></urlset>', headers: {} };
    }
    const html = '<!doctype html><html lang="en"><head><title>Fixture page</title></head><body><h1>Fixture</h1><p>Measured content.</p></body></html>';
    return { url, finalUrl: url, statusCode: 200, responseTimeMs: 10, pageSizeBytes: html.length,
      headers: {}, contentType: 'text/html', html, parsed: parseHtml(html, url) };
  });
  return state;
}
const ready = (url: string, kind: FrontierItem['kind'], depth = 0) => ({
  ...frontierItem(url, kind, depth), next_attempt_at: '2020-01-01T00:00:00Z',
});

test('single-RPC selection preserves first-page score, two-item batches, stable IDs and accurate finalization', async context => {
  const root = ready(`${origin}/`, 'page');
  const state = fixture(context, [ready(`${origin}/robots.txt`, 'robots'), root,
    ready(`${origin}/sitemap.xml`, 'sitemap'), ready(`${origin}/one`, 'page', 1), ready(`${origin}/two`, 'page', 1)]);
  assert.equal(await runScalableSlice('score-fixture'), true);
  assert.deepEqual(state.limits, [1, 1, 2, 2]);
  const firstScore = state.commits.findIndex(payload => payload.score);
  assert.equal(state.commits[firstScore].score.pagesAnalysed, 1);
  assert.equal(state.commits[firstScore - 1].items[0].key, root.key);
  assert.equal(state.commits[firstScore + 1].items[0].key, frontierItem(`${origin}/sitemap.xml`, 'sitemap').key);
  assert.equal(state.maxInFlight, 2);
  assert.equal(new Set(state.pages.map(page => page.id)).size, 3);
  assert.ok(state.pages.every(page => /^[a-f0-9]{40}$/.test(page.id)));
  assert.equal(state.finishes.length, 1);
  const report = state.finishes[0].p_report;
  assert.equal(report.scores.processingVersion, 2);
  assert.equal(report.scores.scoringVersion, SCORING_VERSION);
  assert.equal(report.scores.coverage.pagesAnalysed, 3);
  assert.equal(report.scores.coverage.stopReason, 'page_limit_reached');
  assert.equal(report.pages.length, 3);
  assert.equal(state.finishes[0].p_reason, 'page_limit_reached');
});

test('robots retry backoff remains pending and cannot finalize an exhausted-looking batch', async context => {
  const robots = { ...ready(`${origin}/robots.txt`, 'robots'), next_attempt_at: '2099-01-01T00:00:00Z' };
  const state = fixture(context, [robots, ready(`${origin}/`, 'page')]);
  assert.equal(await runScalableSlice('retry-fixture'), true);
  assert.deepEqual(state.requests, []);
  assert.deepEqual(state.commits, []);
  assert.deepEqual(state.limits, [1]);
  assert.equal(state.finishes.length, 1);
  assert.equal(state.finishes[0].p_report, null);
  assert.equal(state.reportReads, 0);
});

test('ownership loss after a frontier read prevents checkpoint and terminal writes', async context => {
  const state = fixture(context, [ready(`${origin}/`, 'page')]);
  state.loseOwnership = true;
  await assert.rejects(runScalableSlice('ownership-fixture'), /AUDIT_OWNERSHIP_LOST/);
  assert.equal(state.commits.length, 0);
  assert.equal(state.finishes.length, 0);
  assert.equal(state.reportReads, 0);
});

test('generation-fenced finalization failure never attempts a second lease release', async context => {
  const state = fixture(context, []);
  state.failFinish = true;
  await assert.rejects(runScalableSlice('finish-fenced-fixture'), /AUDIT_OWNERSHIP_LOST/);
  assert.equal(state.finishes.length, 1);
});
