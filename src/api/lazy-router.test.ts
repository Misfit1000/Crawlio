import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { registerHooks } from 'node:module';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import express from 'express';
import { ApiError, requestIdMiddleware, safeApiError } from '../lib/api/errors';
import { apiSecurityHeaders, jsonBodyParser, jsonParseErrorHandler, requireJsonContentType } from '../lib/api/http-hardening';
import { requireSupabaseAdminClient } from '../lib/supabase/server';
import { publicVersionPayload } from '../lib/platform/version';
import type { ApiRouteFamily } from './index';

type Reply = { status: number; headers: IncomingHttpHeaders; text: string; body: any };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const auditId = '00000000-0000-4000-8000-000000000001';
const sourceShareId = '00000000-0000-4000-8000-000000000002';
const badgeShareId = '00000000-0000-4000-8000-000000000003';
const badgeToken = `sb1.${sourceShareId}.${'x'.repeat(43)}`;
const guestHeaders = { 'x-crawlio-guest-id': 'lazy-router-guest' };

test('lazy dispatcher preserves mounted API behavior without external fetches or database mutations', async context => {
  const safeEnv = {
    NODE_ENV: 'test', SUPABASE_URL: 'https://lazy-router-fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only',
    APP_URL: 'https://app-fixture.invalid', CRON_SECRET: 'fixture-cron-secret-that-is-not-used',
    BLOG_DISPATCH_SECRET: 'fixture-dispatch-secret-that-is-not-used', SCALABLE_AUDITS_ENABLED: 'false',
    SENTRY_DSN: '', VITE_SENTRY_DSN: '', GROQ_API_KEY: '', INDEXNOW_KEY: '',
    BUILD_TIMESTAMP: '2026-10-03T00:00:00Z', BLOG_AUTOMATION_ENABLED: 'false', GROQ_BLOG_ENABLED: 'false',
  };
  const saved = Object.keys(safeEnv).map(key => [key, process.env[key]] as const);
  for (const [key, value] of Object.entries(safeEnv)) process.env[key] = value;
  context.after(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const calls: string[] = [];
  const mutations: string[] = [];
  const externalFetches: string[] = [];
  const unexpectedErrors: Array<{ path: string; error: string }> = [];
  const loadedFamilies = new Set<string>();
  const hooks = registerHooks({
    load(url, options, nextLoad) {
      const family = /\/src\/api\/(core|blog|admin|projects|search|exports|providers|tools|evidence)-router\.[cm]?[jt]s(?:[?#]|$)/.exec(url);
      if (family) loadedFamilies.add(family[1]);
      return nextLoad(url, options);
    },
  });
  context.after(() => hooks.deregister());
  context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    externalFetches.push(input instanceof Request ? input.url : String(input));
    throw new Error('External fetch is forbidden in lazy-router fixtures.');
  });
  const client = requireSupabaseAdminClient();
  let deniedNamespace: string | null = null;
  context.mock.method(client, 'rpc', async (name: string, args: Record<string, unknown>) => {
    calls.push(`rpc:${name}:${args.p_namespace}`);
    assert.equal(name, 'consume_api_rate_limit', 'Only a mocked rate-control RPC is permitted.');
    return { data: { allowed: args.p_namespace !== deniedNamespace, retry_after_seconds: 17 }, error: null };
  });
  context.mock.method(client.auth, 'getUser', async () => {
    calls.push('auth:getUser');
    return { data: { user: null }, error: null };
  });
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  const share = { audit_id: auditId, user_id: 'fixture-owner', project_id: null, expires_at: expiresAt, revoked_at: null };
  context.mock.method(client, 'from', (table: string) => {
    calls.push(`from:${table}`);
    assert.ok(['plan_limits', 'audit_export_jobs', 'audit_pages', 'audit_tool_documents', 'report_shares', 'audit_reports'].includes(table), `Unexpected database table: ${table}`);
    const filters = new Map<string, unknown>();
    let columns = '';
    const result = () => {
      calls.push(`read:${table}`);
      let data: unknown;
      if (table === 'plan_limits') data = null;
      else if (table === 'audit_export_jobs') data = { state: 'queued', expires_at: expiresAt };
      else if (table === 'audit_pages') data = [];
      else if (table === 'audit_tool_documents') data = { robots: { state: 'available', raw: 'User-agent: *\nDisallow:\n', statusCode: 200 } };
      else if (table === 'audit_reports') data = { overall: 81, scoringVersion: '2.2', coverage: { pagesAnalysed: 3 } };
      else if (filters.get('token_hash') === hash(badgeToken)) data = { ...share, id: badgeShareId };
      else if (filters.get('id') === sourceShareId) data = { ...share, id: sourceShareId };
      else data = null;
      if (table === 'audit_export_jobs') {
        assert.equal(columns, 'state,expires_at');
        assert.equal(filters.get('audit_id'), 'guest-audit');
        assert.equal(filters.get('format'), 'pages.csv');
      }
      return { data, error: null };
    };
    const query = {
      select(value: string) { columns = value; return query; },
      eq(key: string, value: unknown) { filters.set(key, value); return query; },
      order() { return query; },
      limit(value: number) { assert.ok(value <= 101); return query; },
      maybeSingle: async () => result(),
      then(resolve: (value: ReturnType<typeof result>) => unknown, reject?: (error: unknown) => unknown) {
        return Promise.resolve().then(result).then(resolve, reject);
      },
      insert() { mutations.push(`${table}:insert`); throw new Error('Database mutation forbidden'); },
      upsert() { mutations.push(`${table}:upsert`); throw new Error('Database mutation forbidden'); },
      update() { mutations.push(`${table}:update`); throw new Error('Database mutation forbidden'); },
      delete() { mutations.push(`${table}:delete`); throw new Error('Database mutation forbidden'); },
    };
    return query;
  });

  const { apiRouter, apiRouteFamily } = await import('./index');
  const app = express();
  const referenceRouter = express.Router();
  app.use(requestIdMiddleware, apiSecurityHeaders, jsonBodyParser(), jsonParseErrorHandler, requireJsonContentType);
  app.use('/api/tools', apiRouter);
  app.use('/tools', apiRouter);
  app.use('/reference', referenceRouter);
  app.use('/api', (_req, _res, next) => next(new ApiError('API_ROUTE_NOT_FOUND', 'The requested API route was not found.', 404)));
  app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (!(error instanceof ApiError)) unexpectedErrors.push({ path: req.originalUrl, error: error instanceof Error ? error.stack || error.message : String(error) });
    const mapped = safeApiError(error, String(res.locals.requestId));
    if (error instanceof ApiError && error.retryAfterSeconds) res.setHeader('Retry-After', String(error.retryAfterSeconds));
    res.status(mapped.status).json(mapped.body);
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  context.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const port = (server.address() as AddressInfo).port;
  function request(path: string, options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Reply> {
    const text = options.body === undefined ? undefined : JSON.stringify(options.body);
    return new Promise((resolve, reject) => {
      const request = httpRequest({ host: '127.0.0.1', port, path, method: options.method || 'GET',
        headers: { 'x-request-id': 'lazy-router-fixture', ...(text === undefined ? {} : { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)) }), ...options.headers },
      }, response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body: unknown;
          try { body = JSON.parse(text); } catch { body = undefined; }
          resolve({ status: response.statusCode!, headers: response.headers, text, body });
        });
      });
      request.on('error', reject);
      request.setTimeout(10_000, () => request.destroy(new Error(`Fixture request timed out: ${path}`)));
      request.end(text);
    });
  }
  const api = (path: string, options?: Parameters<typeof request>[1]) => request(`/api/tools${path}`, options);
  const assertPrivate = (reply: Reply) => assert.equal(reply.headers['cache-control'], 'private, no-store');

  await context.test('cold /version, trailing slash and HEAD stay cheap and preserve the version envelope', async () => {
    for (const path of ['/version', '/version/', '/VERSION?probe=1']) {
      const reply = await api(path);
      assert.equal(reply.status, 200);
      assert.deepEqual(reply.body, { success: true, data: publicVersionPayload() });
      assert.equal(reply.headers['cache-control'], 'public, max-age=60, stale-while-revalidate=300');
    }
    const head = await api('/version', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.text, '');
    assert.deepEqual(calls, []);
    assert.deepEqual([...loadedFamilies], [], 'Version must not import a route-family module.');
  });

  const familyCases: Record<ApiRouteFamily, string[]> = {
    core: ['/audit/start', '/audit/status/example', '/audits/history', '/me/profile', '/shared-reports/token'],
    blog: ['/blog/posts', '/blog/rss.xml', '/blog/scheduler/run', '/admin/blog/posts'],
    admin: ['/admin/users', '/admin/platform/settings'],
    projects: ['/projects/overview', '/projects/scheduler/run', '/imports', '/imports/example/rows'],
    search: ['/search-console/status', '/search-console/callback'],
    exports: ['/audit/export/example/pages.csv', '/audit/export-status/example/pages.csv', '/me/export'],
    providers: ['/domain/link-signals'],
    tools: ['/keyword/research', '/clusters', '/content-brief', '/competitor-gap'],
    evidence: ['/audit/example/evidence/pages', '/audit/example/tool-evidence', '/audit/example/shares', '/audit/example/badge', `/score-badges/${badgeToken}.svg`],
  };
  for (const [family, paths] of Object.entries(familyCases)) {
    await context.test(`${family} selection retains canonical and trailing-slash routes`, () => {
      for (const path of paths) {
        assert.equal(apiRouteFamily(path), family, path);
        assert.equal(apiRouteFamily(`${path}/`), family, `${path}/`);
      }
    });
  }
  await context.test('family prefix matching does not capture similarly named unknown routes', () => {
    for (const path of ['/blogger/posts', '/administrator', '/projects-old', '/domain-other', '/keyword/research-other', '/audit/exporter/example/json']) {
      assert.equal(apiRouteFamily(path), 'core', path);
    }
  });

  const { auditRepository, toAuditDocument } = await import('../lib/supabase/audit-repository');
  const { blogRepository, mapBlogPostRow } = await import('../lib/blog/repository');
  const { blogAutomationRepository } = await import('../lib/blog/automation-repository');
  const guestAudit = toAuditDocument({ id: 'guest-audit', normalized_url: 'https://example.com/', submitted_input: 'example.com', hostname: 'example.com',
    mode: 'quick', status: 'completed', plan: 'free', pages_crawled: 3, pages_discovered: 3, page_limit: 5, issues_found: 0,
    guest_key_hash: hash('guest-session:lazy-router-guest'), created_at: '2026-10-03T00:00:00Z', updated_at: '2026-10-03T00:01:00Z' })!;
  const ownedAudit = { ...guestAudit, id: auditId, userId: 'fixture-owner', guestKeyHash: null, projectId: null, completedAt: '2026-10-03T00:01:00Z' };
  context.mock.method(auditRepository, 'getAudit', async function (id: string) {
    assert.equal(this, auditRepository, 'Audit repository method lost its receiver.');
    calls.push(`audit:get:${id}`);
    return id === 'guest-audit' ? guestAudit : id === auditId ? ownedAudit : null;
  });
  const live = { audit: guestAudit, latestEvents: [], latestPages: [], latestIssues: [], finalReport: null };
  context.mock.method(auditRepository, 'getLiveData', async function (id: string, knownAudit?: unknown) {
    assert.equal(this, auditRepository);
    assert.equal(id, 'guest-audit');
    assert.equal(knownAudit, guestAudit);
    calls.push('audit:live');
    return live;
  });
  const post = mapBlogPostRow({ id: 'fixture-post', title: 'Fixture crawling guide', slug: 'fixture-crawling-guide', status: 'published',
    content_text: 'Measured crawling guidance.', published_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' });
  context.mock.method(blogRepository, 'listPublished', async function (input) {
    assert.equal(this, blogRepository, 'Blog repository method lost its receiver.');
    calls.push(`blog:list:${JSON.stringify(input)}`);
    return { posts: [post], total: 1, limit: Number(input?.limit || 12), offset: Number(input?.offset || 0) };
  });
  context.mock.method(blogRepository, 'listPublishedTopics', async function () {
    assert.equal(this, blogRepository);
    calls.push('blog:topics');
    return [{ name: 'SEO guides', slug: 'seo-guides', count: 1 }];
  });
  for (const [repository, method] of [[blogRepository, 'publishDueScheduled'], [blogAutomationRepository, 'recoverVercelJobs'], [blogAutomationRepository, 'createJob']] as const) {
    context.mock.method(repository, method as never, async () => {
      mutations.push(`scheduler:${method}`);
      throw new Error('Scheduler mutation forbidden');
    });
  }

  await context.test('shared admin limiter runs before auth and private headers survive its rejection', async () => {
    deniedNamespace = 'admin-api';
    try {
      const before = calls.length;
      const reply = await api('/admin/users');
      assert.equal(reply.status, 429);
      assert.equal(reply.body.error.code, 'RATE_LIMITED');
      assert.equal(reply.headers['retry-after'], '17');
      assertPrivate(reply);
      assert.deepEqual(calls.slice(before), ['rpc:consume_api_rate_limit:admin-api']);
      assert.ok(!loadedFamilies.has('admin'), 'Shared limiter rejection must precede lazy family loading.');
    } finally { deniedNamespace = null; }
  });

  for (const path of ['/admin/users', '/admin/users/', '/admin/platform/settings', '/admin/blog/posts']) {
    await context.test(`unauthenticated ${path} rejects privately without repository reads`, async () => {
      const before = calls.length;
      const reply = await api(path);
      assert.equal(reply.status, 401);
      assert.deepEqual(reply.body, { success: false, error: 'Authentication required.' });
      assertPrivate(reply);
      assert.deepEqual(calls.slice(before), ['rpc:consume_api_rate_limit:admin-api']);
    });
  }
  for (const path of ['/blog/posts', '/blog/posts/']) {
    await context.test(`public ${path} retains query, envelope and public caching`, async () => {
      const reply = await api(`${path}?q=crawling&limit=2&offset=4`);
      assert.equal(reply.status, 200);
      assert.equal(reply.body.success, true);
      assert.equal(reply.body.data.posts[0].slug, post.slug);
      assert.deepEqual(reply.body.data.topics, [{ name: 'SEO guides', slug: 'seo-guides', count: 1 }]);
      assert.deepEqual([reply.body.data.total, reply.body.data.limit, reply.body.data.offset], [1, 2, 4]);
      assert.equal(reply.headers['cache-control'], 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600');
      assert.ok(calls.includes('blog:list:{"query":"crawling","limit":2,"offset":4}'));
    });
  }
  for (const method of ['GET', 'POST']) {
    await context.test(`${method} blog scheduler rejects before any publication or dispatch`, async () => {
      const before = calls.length;
      const reply = await api('/blog/scheduler/run/', { method });
      assert.equal(reply.status, 401);
      assert.equal(reply.body.error.code, 'BLOG_SCHEDULER_UNAUTHORIZED');
      assertPrivate(reply);
      assert.deepEqual(calls.slice(before), ['rpc:consume_api_rate_limit:blog-scheduler']);
      assert.deepEqual(mutations, []);
    });
  }

  for (const [path, namespace] of [['/projects/overview/', 'projects'], ['/imports/', 'project-imports'], ['/search-console/status/', 'search-console']] as const) {
    await context.test(`${path} reaches its extracted authentication gate`, async () => {
      const before = calls.length;
      const reply = await api(path);
      assert.equal(reply.status, 401);
      assert.equal(reply.body.success, false);
      assertPrivate(reply);
      assert.deepEqual(calls.slice(before), [`rpc:consume_api_rate_limit:${namespace}`]);
    });
  }
  await context.test('provider validation stays local and precedes upstream evidence fetches', async () => {
    const before = calls.length;
    const reply = await api('/domain/link-signals/');
    assert.equal(reply.status, 400);
    assert.equal(reply.body.error.code, 'INVALID_DOMAIN');
    assert.deepEqual(calls.slice(before), []);
  });
  await context.test('keyword research preserves deterministic response and seed validation', async () => {
    const before = calls.length;
    const reply = await api('/keyword/research', { method: 'POST', body: { seed: '  Technical SEO  ' } });
    assert.equal(reply.status, 200);
    assert.equal(reply.body.success, true);
    assert.ok(reply.body.data.keywords.length > 50);
    assert.deepEqual(reply.body.data.keywords[0], {
      id: '1', keyword: 'technical seo', intent: 'Informational', funnelStage: 'Awareness', relevanceScore: 100,
      estimatedDifficulty: 60, opportunityScore: 46, suggestedContentType: 'Blog Post', source: 'Seed',
    });
    const invalid = await api('/keyword/research', { method: 'POST', body: { seed: ' ' } });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, 'INVALID_KEYWORD_SEED');
    assert.deepEqual(calls.slice(before), []);
  });
  referenceRouter.use('/tools', (await import('./tools-router')).apiRouter);
  referenceRouter.use('/exports', (await import('./exports-router')).apiRouter);
  referenceRouter.use('/blog', (await import('./blog-router')).apiRouter);
  for (const [path, body] of [
    ['/keyword/research/', { seed: ' ' }],
    ['/clusters/', { keywords: [] }],
    ['/content-brief/', {}],
    ['/competitor-gap/', {}],
  ] as const) {
    await context.test(`Express-compatible trailing slash: POST ${path}`, async () => {
      const reference = await request(`/reference/tools${path}`, { method: 'POST', body });
      assert.notEqual(reference.status, 404, 'The extracted route itself accepts this URL.');
      const reply = await api(path, { method: 'POST', body });
      assert.equal(reply.status, reference.status, 'Dispatcher must preserve the extracted Express route response.');
      assert.deepEqual(reply.body, reference.body);
    });
  }
  for (const [family, path, options] of [
    ['tools', '/KEYWORD/RESEARCH', { method: 'POST', body: { seed: 'technical seo' } }],
    ['blog', '/BLOG/posts', {}],
  ] as const) {
    await context.test(`Express-compatible case-insensitive route: ${path}`, async () => {
      const reference = await request(`/reference/${family}${path}`, options);
      assert.equal(reference.status, 200);
      const reply = await api(path, options);
      assert.equal(reply.status, reference.status, 'Family selection must retain default Express case-insensitive routing.');
      assert.deepEqual(reply.body, reference.body);
    });
  }
  for (const path of ['/me/export', '/me/export/']) {
    await context.test(`${path} reaches account-export auth rather than API not-found`, async () => {
      const reference = await request(`/reference/exports${path}`);
      assert.equal(reference.status, 401);
      const reply = await api(path);
      assert.equal(reply.status, reference.status);
      assert.equal(reply.body.error.code, 'AUTHENTICATION_REQUIRED');
      assertPrivate(reply);
    });
  }
  await context.test('export-status with a filename extension and trailing slash stays a private read', async () => {
    const before = calls.length;
    const reply = await api('/audit/export-status/guest-audit/pages.csv/', { headers: guestHeaders });
    assert.equal(reply.status, 202);
    assert.deepEqual(reply.body, { success: true, data: { state: 'queued' } });
    assert.equal(reply.headers['retry-after'], '2');
    assertPrivate(reply);
    assert.deepEqual(calls.slice(before), ['rpc:consume_api_rate_limit:export-status', 'audit:get:guest-audit', 'from:plan_limits', 'read:plan_limits', 'from:audit_export_jobs', 'read:audit_export_jobs']);
  });
  await context.test('export download retains shared limiting before format validation', async () => {
    const before = calls.length;
    const reply = await api('/audit/export/guest-audit/unsupported/', { headers: guestHeaders });
    assert.equal(reply.status, 400);
    assert.deepEqual(reply.body, { success: false, error: 'Unsupported export format' });
    assertPrivate(reply);
    assert.deepEqual(calls.slice(before), ['rpc:consume_api_rate_limit:report-export']);
  });

  await context.test('core audit status keeps guest ownership and known-audit repository binding', async () => {
    const reply = await api('/audit/status/guest-audit/', { headers: guestHeaders });
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, JSON.parse(JSON.stringify({ success: true, data: live })));
    assertPrivate(reply);
  });
  await context.test('evidence and tool-evidence retain guest access helpers and shared middleware', async () => {
    const pages = await api('/audit/guest-audit/evidence/pages/', { headers: guestHeaders });
    assert.equal(pages.status, 200);
    assert.deepEqual(pages.body.data.items, []);
    assert.equal(pages.body.data.total, 3);
    assert.equal(pages.body.data.limit, 50);
    assertPrivate(pages);
    const before = calls.length;
    const tools = await api('/audit/guest-audit/tool-evidence/', { headers: guestHeaders });
    assert.equal(tools.status, 200);
    assert.equal(tools.body.data.robots.statusCode, 200);
    assert.equal(tools.body.data.auditId, 'guest-audit');
    assertPrivate(tools);
    assert.deepEqual(calls.slice(before), ['rpc:consume_api_rate_limit:audit-tool-evidence', 'audit:get:guest-audit', 'from:audit_tool_documents', 'read:audit_tool_documents']);
  });
  await context.test('unauthorized evidence is rejected before reading private rows', async () => {
    const before = calls.length;
    const reply = await api(`/audit/${auditId}/evidence/pages`);
    assert.equal(reply.status, 404);
    assert.deepEqual(reply.body, { success: false, error: 'Audit not found.' });
    assertPrivate(reply);
    assert.deepEqual(calls.slice(before), [`audit:get:${auditId}`]);
  });
  for (const suffix of ['.svg', '.svg/']) {
    await context.test(`public score badge ${suffix} reaches SVG rendering without cache or mutations`, async () => {
      const reply = await api(`/score-badges/${badgeToken}${suffix}`, { headers: { 'if-none-match': 'old-etag' } });
      assert.equal(reply.status, 200);
      assert.match(reply.headers['content-type']!, /^image\/svg\+xml/);
      assert.match(reply.text, /^<svg/);
      assert.match(reply.text, /81\/100/);
      assertPrivate(reply);
      assert.equal(reply.headers['cdn-cache-control'], 'no-store');
      assert.equal(reply.headers.etag, undefined);
      assert.equal(reply.headers['last-modified'], undefined);
    });
  }

  await context.test('unknown API routes fall through to the existing JSON 404 contract', async () => {
    for (const path of ['/api/tools/does-not-exist', '/api/tools/admin/does-not-exist/', '/api/tools/blog/does-not-exist', '/api/does-not-exist']) {
      const reply = await request(path);
      assert.equal(reply.status, 404);
      assert.deepEqual(reply.body, { success: false, error: {
        code: 'API_ROUTE_NOT_FOUND', message: 'The requested API route was not found.', requestId: 'lazy-router-fixture',
      } });
      assert.match(reply.headers['content-type']!, /^application\/json/);
      assertPrivate(reply);
    }
  });
  await context.test('all extracted families load and no unresolved binding, external fetch or mutation is observed', () => {
    assert.deepEqual([...loadedFamilies].sort(), Object.keys(familyCases).sort());
    assert.deepEqual(unexpectedErrors, []);
    assert.deepEqual(externalFetches, []);
    assert.deepEqual(mutations, []);
  });
});
