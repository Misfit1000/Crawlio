import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blogRuntimeReadiness, runBoundedBlogDispatch } from './dispatch-runner';
import { getGroqBlogConfiguration, generateGroqCompletion, GroqBlogProviderError } from './groq';
import type { BlogGenerationJob } from '../types';

const job = (stage: string, state = 'drafting', extra = {}) => ({ id: 'job', workflowStage: stage, state, ...extra }) as BlogGenerationJob;

test('background dispatch continues through durable stages without another browser request', async () => {
  let clock = 0;
  let index = 0;
  const stages = [job('source_collection'), job('section_drafting'), job('published', 'published')];
  const result = await runBoundedBlogDispatch({ requestedJobId: 'job' }, { now: () => clock, wait: async ms => { clock += ms; },
    process: async () => ({ processed: true, job: stages[index++] }), getJob: async () => stages[index - 1] });
  assert.equal(result.processedStages, 3);
  assert.equal(result.pendingJobId, null);
});

test('retry backoff resumes the same stage and failed state is terminal even with an active stage name', async () => {
  let clock = 0;
  let calls = 0;
  const result = await runBoundedBlogDispatch({ requestedJobId: 'job' }, { now: () => clock, wait: async ms => { clock += ms; },
    process: async () => ({ processed: true, job: ++calls === 1 ? job('section_drafting', 'queued', { nextRetryAt: new Date(30_000).toISOString() }) : job('section_drafting', 'failed') }), getJob: async () => null });
  assert.equal(calls, 2);
  assert.equal(clock, 30_000);
  assert.equal(result.pendingJobId, null);
});

test('deadline checkpoints preserve the pending job and long provider backoff does not spin', async () => {
  let calls = 0;
  const result = await runBoundedBlogDispatch({ requestedJobId: 'job' }, { now: () => 0, wait: async () => { throw new Error('must not wait'); },
    process: async () => { calls++; return { processed: true, job: job('section_drafting', 'queued', { nextRetryAt: new Date(900_000).toISOString() }) }; }, getJob: async () => null });
  assert.equal(calls, 1);
  assert.equal(result.pendingJobId, 'job');
});

test('readiness distinguishes manual generation from strict scheduled publication without exposing credentials', () => {
  const original = { ...process.env };
  try {
    Object.assign(process.env, { GROQ_API_KEY: ' test-key ', GROQ_BLOG_ENABLED: ' true ', BLOG_DISPATCH_SECRET: 'a'.repeat(32), BLOG_AUTOMATION_ENABLED: 'true' });
    const ready = blogRuntimeReadiness({ provider_enabled: true, enabled: true, strict_autopilot_enabled: false });
    assert.equal(ready.generationAllowed, true);
    assert.equal(ready.automaticPublishingAllowed, false);
    assert.equal(blogRuntimeReadiness({ provider_enabled: true, emergency_pause: true }).generationAllowed, false);
    assert.equal(JSON.stringify(ready).includes('test-key'), false);
    assert.equal(getGroqBlogConfiguration().apiKey, 'test-key');
    assert.throws(() => getGroqBlogConfiguration({ GROQ_API_BASE_URL: 'https://untrusted.example/openai/v1' }), /base URL/);
  } finally { process.env = original; }
});

test('Groq Retry-After is retained for durable retries instead of hammering a rate-limited provider', async () => {
  const original = { ...process.env };
  try {
    Object.assign(process.env, { GROQ_API_KEY: 'test-key', GROQ_BLOG_ENABLED: 'true' });
    let requests = 0;
    await assert.rejects(generateGroqCompletion({ role: 'writer', system: 'Test', user: 'Test', maxAttempts: 1,
      fetchImpl: async () => { requests++; return new Response('', { status: 429, headers: { 'retry-after': '120' } }); } }),
    error => error instanceof GroqBlogProviderError && error.code === 'GROQ_RATE_LIMITED' && error.retryAfterMs === 120_000);
    assert.equal(requests, 1);
  } finally { process.env = original; }
});
