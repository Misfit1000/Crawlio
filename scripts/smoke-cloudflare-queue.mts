import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runSecondarySlice, type SecondaryEnvironment } from '../src/workers/cloudflare-audit/src/queue-runner';
import { CloudflarePublicFetchError } from '../src/workers/cloudflare-audit/src/safe-fetch';
import { analysisFrontierItem } from '../src/lib/audit/scalable-item-analysis';
import { makeAuditScope, type AuditScope } from '../src/lib/audit/audit-scope';
import type { CrawlRun, FrontierItem } from '../src/lib/supabase/scalable-audit-repository';

type Row = Record<string, any>;
type RpcCall = { name: string; args: Row };
type FixtureFrontier = FrontierItem & { state: 'pending' | 'done' };
const serviceKey = 'fixture-service-role-do-not-leak';
const env: SecondaryEnvironment = { SUPABASE_URL: 'https://fixtureproject.supabase.co', SUPABASE_SERVICE_ROLE_KEY: serviceKey, GIT_COMMIT_SHA: 'fixture-cloudflare-commit' };
const origin = 'https://queue.example.com';
const pageHtml = '<!doctype html><html lang="en"><head><title>Security-only queue fixture</title></head><body><h1>Fixture</h1><a href="/second">Second page</a><a href="/third">Third page</a><form action="http://queue.example.com/submit"><input></form><img src="http://queue.example.com/image.png"></body></html>';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

function fixture(scope: AuditScope = makeAuditScope('security'), pageLimit = 1) {
  const id = randomUUID();
  const audit: Row = { id, submitted_input: `${origin}/`, normalized_url: `${origin}/`, hostname: 'queue.example.com',
    audit_scope: scope, plan: 'free', mode: 'quick', requested_mode: 'quick', effective_mode: 'quick',
    processing_version: 2, processing_tier: 'free', page_limit: pageLimit, plan_page_limit: Math.max(pageLimit, 10), status: 'queued' };
  const run: CrawlRun = { audit_id: id, generation: 0, owner: '', active_ms: 0, budget_ms: 7_200_000,
    candidate_limit: pageLimit * 4, discovered: 1, attempted: 0, analysed: 0, failed: 0, blocked: 0,
    page_count: 0, error_pages: 0, redirect_pages: 0, slow_pages: 0, large_pages: 0, check_count: 0,
    unavailable_count: 0, failure_count: 0, discovery_documents: 0, last_score_pages: 0, last_score_at: null, metadata: {} };
  const frontier = new Map<string, FixtureFrontier>();
  const root = analysisFrontierItem(`${origin}/`, 'page');
  frontier.set(root.key, { ...root, state: 'pending' });
  const pages = new Map<string, Row>();
  const issues = new Map<string, Row>();
  const groups = new Map<string, Row>();
  const requests: Array<{ url: URL; init: RequestInit }> = [];
  const rpcs: RpcCall[] = [];
  const checkpoints: Row[] = [];
  const finishes: Row[] = [];
  const health: Row[] = [];
  let report: Row | null = null;
  let idle = false;
  let ownsLease = false;
  const hooks: {
    database?: (name: string, args: Row | undefined) => Response | Error | undefined;
    target?: (url: URL) => Response | Error | undefined;
  } = {};
  const pending = () => [...frontier.values()].some(item => item.state === 'pending');
  const snapshot = () => structuredClone({ run, pending: pending(), scoreGroups: [...groups.values()] });
  const insert = (item: FrontierItem) => {
    if (!frontier.has(item.key)) {
      frontier.set(item.key, { ...item, state: 'pending' });
      if (item.kind === 'page') run.discovered++;
    }
  };

  const fetchImpl: typeof fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push({ url, init });
    const headers = new Headers(init.headers);
    if (url.hostname === 'fixtureproject.supabase.co') {
      assert.equal(headers.get('apikey'), serviceKey);
      assert.equal(headers.get('authorization'), `Bearer ${serviceKey}`);
      assert.equal(init.redirect, 'manual');
      const name = url.pathname.replace('/rest/v1/', '').replace(/^rpc\//, '');
      const args = init.body ? JSON.parse(String(init.body)) as Row : undefined;
      if (args) rpcs.push({ name, args: structuredClone(args) });
      const intercepted = hooks.database?.(name, args);
      if (intercepted instanceof Error) throw intercepted;
      if (intercepted) return intercepted;
      if (name === 'claim_secondary_audit') {
        if (idle || report) return json(null);
        assert.equal(ownsLease, false, 'the fixture must release before another invocation claims');
        run.generation++; run.owner = String(args!.p_worker); audit.status = 'running'; ownsLease = true;
        return json({ ...snapshot(), audit: structuredClone(audit) });
      }
      if (name === 'read_scalable_audit_frontier' || name === 'read_scoped_audit_frontier') {
        assert.equal(args!.p_limit, 1);
        assert.equal(args!.p_audit, id);
        const candidates = [...frontier.values()].filter(item => item.state === 'pending');
        const priority = (item: FixtureFrontier) => item.kind === 'robots' ? 0 : item.kind === 'page' && item.depth === 0 ? 1 : item.kind === 'sitemap' ? 2 : 3;
        candidates.sort((left, right) => priority(left) - priority(right) || left.url.localeCompare(right.url));
        return json(candidates.slice(0, 1));
      }
      if (name === 'scalable_audit_commit_efficient') {
        assert.equal(ownsLease, true);
        assert.equal(args!.p_audit, id);
        assert.equal(args!.p_worker, run.owner);
        assert.equal(args!.p_generation, run.generation);
        const payload = args!.p_payload as Row;
        for (const item of payload.seed || []) insert(item);
        Object.assign(run.metadata, payload.metadata || {});
        for (const item of payload.items || []) {
          const source = frontier.get(item.key);
          assert.ok(source, 'only persisted frontier entries may be committed');
          if (source.state !== 'pending') continue;
          for (const child of item.children || []) insert(child);
          if (item.discoveryOnly) { source.discovery_offset = item.discoveryOffset; continue; }
          if (item.retryAt) { source.attempts++; source.next_attempt_at = item.retryAt; continue; }
          source.state = 'done';
          if (item.page && !pages.has(item.page.id)) {
            pages.set(item.page.id, structuredClone(item.page)); run.attempted++; run.page_count++;
            run.analysed += Number(item.page.fetch_status === 'success');
            run.failed += Number(item.page.fetch_status === 'failed');
            run.blocked += Number(item.page.fetch_status === 'blocked');
            run.check_count += item.checks || 0; run.unavailable_count += item.unavailable || 0;
            for (const issue of item.issues || []) issues.set(issue.id, structuredClone(issue));
            for (const group of item.groups || []) {
              const previous = groups.get(group.key);
              groups.set(group.key, { ...group, affected_pages: (previous?.affected_pages || 0) + 1 });
            }
          } else if (source.kind !== 'page') run.discovery_documents++;
        }
        if (payload.score) {
          checkpoints.push(structuredClone(payload.score));
          run.last_score_pages = payload.score.pagesAnalysed; run.last_score_at = payload.score.updatedAt;
        }
        return json(snapshot());
      }
      if (name === 'scalable_audit_finish_slice') {
        assert.equal(args!.p_audit, id);
        assert.equal(args!.p_generation, run.generation);
        finishes.push(structuredClone(args!));
        if (args!.p_report) { report = structuredClone(args!.p_report); audit.status = 'completed'; }
        ownsLease = false; run.owner = '';
        return json(true);
      }
      if (name === 'secondary_executor_slice_finished') { health.push(structuredClone(args!)); return json(null); }
      if (name === 'renew_scalable_audit_lease') return json(true);
      assert.equal(url.searchParams.get('audit_id'), `eq.${id}`);
      if (name === 'audit_score_groups') return json([...groups.values()]);
      if (name === 'audit_pages') return json([...pages.values()].slice(0, 25));
      if (name === 'audit_issues') return json([...issues.values()].slice(0, 25));
      assert.fail(`Unexpected database request: ${name}`);
    }
    assert.equal(headers.get('authorization'), null, 'service credentials cannot reach target sites or DNS');
    assert.equal(headers.get('apikey'), null, 'service credentials cannot reach target sites or DNS');
    assert.equal(init.redirect, 'manual');
    if (url.hostname === 'cloudflare-dns.com') {
      assert.equal(url.pathname, '/dns-query');
      assert.equal(url.searchParams.get('name'), 'queue.example.com');
      const ipv6 = url.searchParams.get('type') === 'AAAA';
      return json({ Status: 0, Answer: [{ type: ipv6 ? 28 : 1, data: ipv6 ? '2606:4700:4700::1111' : '8.8.8.8' }] });
    }
    assert.equal(url.origin, origin, 'no unrelated provider, backlink, or search API calls');
    const intercepted = hooks.target?.(url);
    if (intercepted instanceof Error) throw intercepted;
    if (intercepted) return intercepted;
    if (url.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /', { headers: { 'content-type': 'text/plain' } });
    if (url.pathname === '/sitemap.xml') return new Response('<urlset/>', { headers: { 'content-type': 'application/xml' } });
    return new Response(pageHtml, { headers: { 'content-type': 'text/html' } });
  };
  return { id, audit, run, frontier, pages, issues, groups, requests, rpcs, checkpoints, finishes, health, hooks, fetchImpl,
    get report() { return report; }, set idle(value: boolean) { idle = value; }, get ownsLease() { return ownsLease; } };
}

function assertClaimContract(call: RpcCall) {
  assert.equal(call.name, 'claim_secondary_audit');
  assert.deepEqual(call.args, { p_worker: 'cloudflare:secondary-v1', p_commit: env.GIT_COMMIT_SHA,
    p_schema: 16, p_engine: '2026.09', p_scoring: '2.2', p_checks: '3.1' });
}

async function caught(operation: Promise<unknown>) {
  try { await operation; }
  catch (error) { return error as Error & { code?: string }; }
  assert.fail('The operation should reject');
}

function assertRedacted(error: Error, code: string) {
  const serialized = [error.message, error.stack, JSON.stringify(error)].join('\n');
  assert.ok(!serialized.includes(serviceKey), 'Service credential leaked through an error');
  assert.ok(!serialized.includes('internal-database-host'), 'Internal database details leaked through an error');
  assert.equal((error as { code?: string }).code, code);
}

const failures: Array<{ name: string; message: string }> = [];
let passed = 0;
async function test(name: string, operation: () => Promise<void>) {
  try { await operation(); passed++; console.log(`PASS ${name}`); }
  catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).replaceAll(serviceKey, '[REDACTED]');
    failures.push({ name, message }); console.error(`FAIL ${name}: ${message}`);
  }
}

// Keep the scheduler's unref'ed politeness timer alive in this standalone fixture process.
const keepAlive = setInterval(() => {}, 1_000);
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Unexpected unmocked network call'); };
try {
  await test('idle queue performs only the schema-16 claim RPC', async () => {
    const state = fixture(); state.idle = true;
    assert.deepEqual(await runSecondarySlice(env, state.fetchImpl), { worked: false, completed: false, pages: 0 });
    assert.equal(state.requests.length, 1); assertClaimContract(state.rpcs[0]);
  });

  await test('fixed-host database redirects are rejected without following their location', async () => {
    const state = fixture();
    state.hooks.database = () => new Response(null, { status: 307, headers: { location: 'https://untrusted.example/collect' } });
    assertRedacted(await caught(runSecondarySlice(env, state.fetchImpl)), 'DATABASE_REQUEST_FAILED');
    assert.equal(state.requests.length, 1);
    assert.equal(state.requests[0].init.redirect, 'manual');
  });

  await test('one-page security audit observes robots, publishes the first score and a scoped final report', async () => {
    const state = fixture();
    assert.deepEqual(await runSecondarySlice(env, state.fetchImpl), { worked: true, completed: true, pages: 1 });
    assertClaimContract(state.rpcs[0]);
    assert.equal(state.run.check_count, 2, 'one selected registry group and the passive security pass');
    assert.deepEqual(state.run.metadata.measuredCategories, ['security']);
    assert.deepEqual(state.requests.filter(call => call.url.origin === origin).map(call => call.url.pathname), ['/robots.txt', '/']);
    assert.equal(state.rpcs.filter(call => call.name === 'scalable_audit_commit_efficient' && call.args.p_payload.seed).length, 1);
    assert.equal(state.frontier.size, 2, 'single-page security must not seed sitemaps or child pages');
    assert.equal(state.checkpoints.length, 1);
    assert.equal(state.checkpoints[0].scoreState, 'provisional');
    assert.equal(state.checkpoints[0].pagesAnalysed, 1);
    assert.equal(typeof state.checkpoints[0].overallScore, 'number');
    assert.ok(state.report);
    assert.deepEqual(state.report!.scores.scope, makeAuditScope('security'));
    assert.deepEqual(state.report!.scores.measuredChecks, ['security']);
    assert.equal(state.report!.scores.overall, state.checkpoints[0].overallScore);
    for (const category of ['seo', 'technical', 'crawlability', 'internalLinks', 'performance', 'mobile', 'structuredData', 'accessibility']) {
      assert.equal(state.report!.scores[category], null, `${category} is unmeasured`);
    }
    assert.ok([...state.issues.values()].every(issue => String(issue.category).toLowerCase() === 'security'));
    assert.ok(state.report!.top_issues.every((issue: Row) => String(issue.category).toLowerCase() === 'security'));
    assert.equal(state.finishes[0].p_reason, 'selected_page_completed');
    assert.equal(state.report!.scores.coverage.pagesAnalysed, 1);
    assert.equal(state.ownsLease, false);
  });

  await test('bounded website slices release and resume under the same audit without lost evidence', async () => {
    const scope = makeAuditScope('security', 'site');
    const state = fixture(scope, 3);
    const first = await runSecondarySlice(env, state.fetchImpl);
    assert.equal(first.worked, true); assert.equal(first.completed, false); assert.equal(first.pages, 1);
    assert.equal(state.finishes[0].p_report, null); assert.equal(state.finishes[0].p_reason, null);
    assert.equal(state.ownsLease, false); assert.equal(state.report, null);
    const before = [...state.pages.keys()];
    const second = await runSecondarySlice(env, state.fetchImpl);
    assert.deepEqual(second, { worked: true, completed: true, pages: 2 });
    assert.equal(state.run.generation, 2); assert.equal(state.run.analysed, 3);
    assert.equal(state.pages.size, 3); assert.ok(before.every(id => state.pages.has(id)));
    assert.deepEqual(state.report!.scores.scope, scope);
    assert.equal(state.report!.scores.coverage.pagesAnalysed, 3);
    assert.equal(state.report!.scores.coverage.stopReason, 'page_limit_reached');
    assert.equal(state.requests.filter(call => call.url.origin === origin && call.url.pathname === '/robots.txt').length, 1);
    assert.equal(state.requests.filter(call => call.url.origin === origin && call.url.pathname === '/').length, 1);
    assert.equal(state.checkpoints[0].pagesAnalysed, 1); assert.equal(state.checkpoints.at(-1)!.pagesAnalysed, 3);
    assert.ok([...state.groups.values()].every(group => group.affected_pages <= 3));
  });

  await test('database HTTP errors redact credentials and release a claimed slice for recovery', async () => {
    const state = fixture(); let failOnce = true;
    state.hooks.database = name => {
      if (name === 'scalable_audit_commit_efficient' && failOnce) {
        failOnce = false; return json({ message: `${serviceKey} internal-database-host`, details: 'private debug details' }, 500);
      }
    };
    assertRedacted(await caught(runSecondarySlice(env, state.fetchImpl)), 'DATABASE_REQUEST_FAILED');
    assert.equal(state.finishes.length, 1); assert.equal(state.finishes[0].p_report, null);
    assert.match(state.finishes[0].p_reason, /resume/); assert.equal(state.ownsLease, false);
    assert.equal(state.health.at(-1)!.p_error_code, 'DATABASE_REQUEST_FAILED');
    assert.equal(state.run.analysed, 0); assert.equal(state.pages.size, 0);
    assert.equal(state.report, null);
    assert.equal((await runSecondarySlice(env, state.fetchImpl)).completed, true);
  });

  await test('database transport errors cannot expose service credentials in thrown errors or health records', async () => {
    const state = fixture(); let failOnce = true;
    state.hooks.database = name => {
      if (name === 'scalable_audit_commit_efficient' && failOnce) {
        failOnce = false; return new Error(`socket failure ${serviceKey} internal-database-host`);
      }
    };
    assertRedacted(await caught(runSecondarySlice(env, state.fetchImpl)), 'DATABASE_REQUEST_FAILED');
    assert.equal(state.finishes[0].p_report, null);
    assert.ok(!JSON.stringify(state.health).includes(serviceKey));
  });

  await test('subrequest exhaustion pauses without fake page failures, then resumes successfully', async () => {
    const state = fixture(); let exhaustOnce = true;
    state.hooks.target = url => {
      if (url.pathname === '/' && exhaustOnce) {
        exhaustOnce = false; return new CloudflarePublicFetchError('SUBREQUEST_BUDGET_EXCEEDED', 'The network subrequest budget was exhausted.');
      }
    };
    const error = await caught(runSecondarySlice(env, state.fetchImpl));
    assert.equal(error.code, 'SUBREQUEST_BUDGET_EXCEEDED');
    assert.equal(state.pages.size, 0); assert.equal(state.issues.size, 0);
    assert.equal(state.run.failed, 0); assert.equal(state.run.analysed, 0);
    assert.equal(state.frontier.get(analysisFrontierItem(`${origin}/`, 'page').key)!.state, 'pending');
    assert.equal(state.finishes[0].p_report, null); assert.equal(state.ownsLease, false);
    assert.equal(state.health.at(-1)!.p_error_code, 'SUBREQUEST_BUDGET_EXCEEDED');
    assert.equal((await runSecondarySlice(env, state.fetchImpl)).completed, true);
    assert.equal(state.pages.size, 1); assert.equal(state.run.failed, 0);
  });

  console.log(`Cloudflare queue fixtures: ${passed} passed, ${failures.length} failed. No external services were contacted.`);
  if (failures.length) throw new Error(failures.map(failure => `${failure.name}: ${failure.message}`).join('\n'));
} finally {
  clearInterval(keepAlive);
  globalThis.fetch = realFetch;
}
