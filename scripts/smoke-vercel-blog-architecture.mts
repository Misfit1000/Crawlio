import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateGroqCompletion, getGroqBlogConfiguration, GROQ_DEFAULT_STRUCTURED_MODEL, GROQ_DEFAULT_WRITER_MODEL } from '../src/lib/blog/server/groq';
import { blogAutomationRepository } from '../src/lib/blog/automation-repository';
import { dispatchVercelBlogStages } from '../src/lib/blog/server/vercel-workflow';

const mode = process.argv[2] || 'all';
const root = new URL('../', import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), 'utf8');
const originalEnv = { ...process.env };
const migration = () => source('supabase/migrations/015_vercel_blog_workflow.sql');
const workflow = () => source('src/lib/blog/server/vercel-workflow.ts');
const api = () => source('src/api/index.ts');

function response(content: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(status === 200 ? JSON.stringify({ model: GROQ_DEFAULT_STRUCTURED_MODEL, choices: [{ message: { content } }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }) : '{}', { status, headers });
}

async function workerRoleSeparation() {
  const auditWorker = source('src/workers/audit-worker.ts');
  const auditTypes = source('src/workers/audit-job-types.ts');
  assert.doesNotMatch(auditWorker, /blog-worker|processOneBlogJob|GROQ_|NVIDIA_/i);
  assert.doesNotMatch(source('render.yaml'), /BLOG_|GROQ_|NVIDIA_|Gemini/i);
  assert.match(auditWorker, /isAuditJobType/);
  assert.match(auditTypes, /'quick', 'standard', 'deep'/);
  assert.doesNotMatch(auditTypes, /blog_/);
  assert.match(migration(), /revoke all on function public\.claim_blog_generation_job/);
  assert.match(migration(), /execution_target = 'vercel'/);
}

async function dispatch() {
  Object.assign(process.env, { BLOG_FIXTURE_PROVIDER_ENABLED: 'true', ALLOW_BLOG_FIXTURE_GENERATION: 'true', NODE_ENV: 'test' });
  const job = await blogAutomationRepository.createJob({ origin: 'admin_manual', topic: 'Deterministic Vercel workflow test', provider: 'fixture_test', model: 'deterministic-fixture-v1', payload: { jobType: 'generate_article', articleType: 'evergreen_guide' }, idempotencyKey: `smoke-vercel-${Date.now()}` });
  assert.equal(job.executionTarget, 'vercel');
  const result = await dispatchVercelBlogStages({ requestedJobId: job.id, maxStages: 2 });
  assert.equal(result.processedStages, 2);
  let current = await blogAutomationRepository.getJob(job.id);
  assert.equal(current?.workflowStage, 'source_validation');
  assert.ok((current?.stageProgress || 0) > 0);
  for (let invocation = 0; invocation < 20 && current?.workflowStage !== 'ready_for_review'; invocation += 1) {
    const step = await dispatchVercelBlogStages({ requestedJobId: job.id, maxStages: 1 });
    assert.equal(step.processedStages, 1);
    current = await blogAutomationRepository.getJob(job.id);
  }
  assert.equal(current?.workflowStage, 'ready_for_review');
  assert.equal(current?.state, 'ready_for_review');
  assert.ok(current?.articleId, 'full fixture workflow must create exactly one review draft');
}

async function idempotency() {
  const sql = migration();
  const providerHealthCreate = sql.indexOf('create table if not exists public.blog_provider_health');
  const providerHealthAlter = sql.indexOf('alter table public.blog_provider_health drop constraint');
  assert.ok(providerHealthCreate >= 0 && providerHealthCreate < providerHealthAlter, 'migration must create optional provider health storage before altering it');
  assert.match(sql, /alter table public\.blog_provider_health enable row level security/);
  assert.match(sql, /for update skip locked limit 1/i);
  assert.match(sql, /workflow_stage = expected_stage/);
  assert.match(sql, /locked_by = execution_id/);
  assert.match(source('supabase/migrations/012_blog_automation_platform.sql'), /blog_posts_generation_job_unique_idx/);
}

async function recovery() {
  const sql = migration();
  assert.match(sql, /recover_vercel_blog_jobs/);
  assert.match(sql, /lease_expires_at < now\(\)/);
  assert.match(workflow(), /recoverAndDispatchVercelBlogWork/);
}

async function apiSecurity() {
  const text = api();
  for (const route of ['/admin/blog/jobs/:id', '/admin/blog/jobs/:id/cancel', '/admin/blog/jobs/:id/process', '/blog/jobs/dispatch', '/blog/jobs/recover']) assert.match(text, new RegExp(route.replace(/[/:]/g, (part) => part === '/' ? '\\/' : '\\:')));
  assert.match(text, /schedulerRequestAllowed/);
  assert.match(text, /BLOG_DISPATCH_UNAUTHORIZED/);
  assert.match(text, /status: 'queued'/);
}

async function groqOnly() {
  process.env.GROQ_BLOG_ENABLED = 'false'; delete process.env.GROQ_API_KEY;
  assert.equal(getGroqBlogConfiguration().configured, false);
  await assert.rejects(() => generateGroqCompletion({ role: 'structured', system: 'x', user: 'x' }), (error: any) => error.code === 'GROQ_DISABLED');
  Object.assign(process.env, { GROQ_BLOG_ENABLED: 'true', GROQ_API_KEY: 'test-placeholder-not-a-real-key', GROQ_BLOG_MIN_REQUEST_INTERVAL_MS: '250' });
  let body = '';
  const structured = await generateGroqCompletion({ role: 'structured', system: 'x', user: 'x', maxAttempts: 1, fetchImpl: (async (_url, init) => { body = String(init?.body); return response('{"ok":true}'); }) as typeof fetch });
  assert.equal(JSON.parse(structured.content).ok, true);
  assert.match(body, new RegExp(GROQ_DEFAULT_STRUCTURED_MODEL.replaceAll('/', '\\/')));
  let calls = 0;
  await generateGroqCompletion({ role: 'writer', system: 'x', user: 'x', maxAttempts: 2, fetchImpl: (async (_url, init) => { body = String(init?.body); calls += 1; return calls === 1 ? response('', 429, { 'retry-after': '0' }) : response('{"ok":true}'); }) as typeof fetch });
  assert.equal(calls, 2);
  assert.match(body, new RegExp(GROQ_DEFAULT_WRITER_MODEL.replaceAll('/', '\\/')));
  calls = 0;
  await assert.rejects(() => generateGroqCompletion({ role: 'structured', system: 'x', user: 'x', maxAttempts: 3, fetchImpl: (async () => { calls += 1; return response('', 401); }) as typeof fetch }), (error: any) => error.code === 'GROQ_AUTH_FAILED');
  assert.equal(calls, 1);
}

async function renderOnly() {
  assert.match(source('render.yaml'), /startCommand: npm run worker:audit/);
  assert.match(source('src/workers/audit-worker-health.ts'), /audit/i);
  assert.doesNotMatch(source('package.json'), /worker:blog/);
}

async function publication() {
  assert.match(workflow(), /blogRepository\.publishDueScheduled/);
  assert.match(workflow(), /renderBlogArticleHtml/);
  assert.match(workflow(), /publicationBlockers/);
  assert.match(api(), /renderBlogNewsSitemap/);
  assert.match(api(), /renderBlogRss/);
}

async function scheduling() {
  assert.match(source('vercel.json'), /"crons"/);
  assert.match(workflow(), /recoverAndDispatchVercelBlogWork/);
  assert.match(source('src/lib/blog/repository.ts'), /pause_all_publication/);
  assert.match(source('src/lib/blog/freshness.ts'), /maximumPostsPerDay/);
}

async function secrets() {
  const browserFiles = ['src/components/blog/BlogAutomationPanel.tsx', 'src/components/blog/BlogAdmin.tsx', 'src/lib/blog/client.ts'].map(source).join('\n');
  assert.doesNotMatch(browserFiles, /GROQ_API_KEY|SUPABASE_SERVICE_ROLE_KEY|gsk_/);
  assert.doesNotMatch(source('render.yaml'), /GROQ_/);
  assert.doesNotMatch(source('.env.example'), /VITE_GROQ/);
  assert.doesNotMatch(source('src/workers/audit-worker.ts'), /server\/groq|GROQ_/);
}

const tests: Record<string, () => Promise<void>> = {
  'worker-role-separation': workerRoleSeparation, 'vercel-blog-dispatch': dispatch, 'stage-idempotency': idempotency,
  recovery, 'api-security': apiSecurity, 'groq-vercel-only': groqOnly, 'render-audit-only': renderOnly,
  publication, scheduling, 'secret-boundaries': secrets,
};

try {
  const selected = mode === 'all' ? Object.entries(tests) : [[mode, tests[mode]] as const];
  for (const [name, test] of selected) { assert.ok(test, `Unknown mode: ${name}`); await test(); console.log(`${name}: passed`); }
} finally {
  process.env = originalEnv;
}
