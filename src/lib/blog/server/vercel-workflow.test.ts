import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { blogAutomationRepository } from '../automation-repository';
import { blogTextFromHtml } from '../sanitize';
import type { BlogGenerationJob, BlogWorkflowStage } from '../types';
import { nextProviderRequestAt, processNextVercelBlogStage, safeBlogStageError } from './vercel-workflow';
import { blogRepository, mapBlogPostRow } from '../repository';
import { blogEditorRepository } from '../editor-repository';
import { completeManualArticleLinks } from '../editor-safe-fixes';
import { prepareBlogPost } from '../validation';

const sections = ['First', 'Second', 'Third'].map((name, index) => ({ heading: `${name} section`, purpose: `Explain ${name.toLowerCase()} practices`, sourceUrl: `https://example.com/source-${index}` }));
const html = (index: number) => `<h2>${sections[index].heading}</h2><p>unique-section-${index} ${'practical explanation '.repeat(115)} end-section-${index}</p>`;
const evidence = sections.map(section => ({ url: section.sourceUrl, text: 'Readable supporting evidence and context. '.repeat(220), status: 'readable' }));
const baseOutputs = () => ({ brief: { title: 'Practical SEO checks', tagline: 'Review the evidence', summary: 'An independent guide to reviewing practical SEO checks using readable source material.', focusKeyword: 'SEO checks', articleType: 'evergreen_guide' },
  outline: { sections }, sources: sections.map(section => ({ url: section.sourceUrl, title: section.heading, publisher: 'Example', citationStatus: 'verified' as const })), sourceEvidence: evidence });

function mockWorkflow(context: TestContext, stage: BlogWorkflowStage, outputs: Record<string, unknown>, answer: (body: any, index: number) => unknown | Response) {
  const original = { ...process.env };
  Object.assign(process.env, { GROQ_API_KEY: 'mock-private-key', GROQ_BLOG_ENABLED: 'true' });
  context.after(() => { process.env = original; });
  let current: BlogGenerationJob = { id: 'mock-job', provider: 'groq', topic: 'SEO checks', origin: 'admin_manual', workflowStage: stage, state: 'queued', customHeadline: 'Preserved custom headline',
    stageOutputs: structuredClone(outputs), stageAttemptCount: 0, attemptCount: 0, maxAttempts: 3,
    payload: { lengthMode: 'custom', customMinimum: 600, customMaximum: 900 }, requestedBy: null,
    batchId: null, model: 'mock-model', articleId: null, result: {}, inputTokens: null, outputTokens: null, actualCost: null, scheduledFor: null,
    error: '', createdAt: '', updatedAt: '', executionTarget: 'vercel', stageProgress: 0, statusMessage: '', nextRetryAt: null, leaseExpiresAt: null, lastSafeErrorCode: '' };
  const requests: any[] = [], completions: any[] = [];
  context.mock.method(blogAutomationRepository, 'claimVercelStage', async () => { current.stageAttemptCount++; return structuredClone(current); });
  context.mock.method(blogAutomationRepository, 'completeVercelStage', async input => {
    assert.equal(input.expectedStage, current.workflowStage);
    completions.push(structuredClone(input));
    current = { ...current, workflowStage: input.nextStage, state: input.nextState, stageAttemptCount: 0, nextRetryAt: null,
      stageOutputs: { ...current.stageOutputs, ...structuredClone(input.output) } };
    return structuredClone(current);
  });
  context.mock.method(blogAutomationRepository, 'deferVercelStage', async input => {
    current = { ...current, state: input.terminal ? 'failed' : 'queued', nextRetryAt: input.retryAt, lastSafeErrorCode: input.errorCode };
    return structuredClone(current);
  });
  context.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    const data = answer(body, requests.length - 1);
    if (data instanceof Response) return data;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) } }], usage: { prompt_tokens: 1100, completion_tokens: 500, total_tokens: 1600 } }), {
      headers: { 'x-ratelimit-remaining-tokens': '2000', 'x-ratelimit-limit-tokens': '8000', 'x-ratelimit-reset-tokens': '7.66s' },
    });
  });
  return { requests, completions, get job() { return current; }, run: () => processNextVercelBlogStage({ requestedJobId: current.id, executionId: 'mock-lease' }) };
}

test('draft sections checkpoint once, survive a rate limit, and assemble without growing prompts', async context => {
  let limited = false;
  const workflow = mockWorkflow(context, 'section_drafting', baseOutputs(), body => {
    const prompt = body.messages[1].content as string;
    const index = Number(prompt.match(/Draft only section (\d+)/)?.[1]) - 1;
    assert.ok(body.max_tokens <= 4000);
    assert.ok(prompt.length < 9000);
    assert.equal(prompt.includes('unique-section-'), false);
    assert.equal(prompt.includes(evidence[0].text), false);
    if (index === 1 && !limited) { limited = true; return new Response('', { status: 429, headers: { 'retry-after': '30' } }); }
    return { contentHtml: html(index) };
  });
  await workflow.run();
  assert.equal(workflow.job.workflowStage, 'section_drafting');
  assert.equal((workflow.job.stageOutputs.draftedSections as any[]).length, 1);
  assert.ok(Date.parse(String(workflow.job.stageOutputs.nextProviderRequestAt)) > Date.now());
  assert.equal(workflow.job.stageAttemptCount, 0);
  (workflow.job.stageOutputs.draftedSections as any[]).push(structuredClone((workflow.job.stageOutputs.draftedSections as any[])[0]));
  workflow.job.stageOutputs.outline = { sections: sections.map(section => ({ ...section, heading: 'Changed later outline' })) };
  const retained = structuredClone(workflow.job.stageOutputs);
  const failure = await workflow.run();
  assert.equal(failure.errorCode, 'GROQ_RATE_LIMITED');
  assert.deepEqual(workflow.job.stageOutputs, retained);
  await workflow.run();
  await workflow.run();
  assert.equal(workflow.job.workflowStage, 'article_assembly');
  assert.equal(workflow.requests.length, 4);
  assert.deepEqual((workflow.job.stageOutputs.draftedSections as any[]).map(section => section.index), [0, 1, 2]);
  const draft = workflow.job.stageOutputs.draft as any;
  assert.equal(draft.title, 'Preserved custom headline');
  assert.ok(draft.seoTitle && draft.metaDescription && draft.excerpt);
  assert.equal(draft.contentHtml, [html(0), html(1), html(2)].join('\n'));
  const words = blogTextFromHtml(draft.contentHtml).split(/\s+/).length;
  assert.ok(words >= 600 && words <= 900);
  assert.equal(JSON.stringify(workflow.job.stageOutputs.sourceEvidence), JSON.stringify(evidence));
  assert.deepEqual(workflow.completions.map(input => input.nextStage), ['section_drafting', 'section_drafting', 'article_assembly']);
  await workflow.run();
  const assembled = workflow.job.stageOutputs.assembled as any;
  for (const section of sections) assert.ok(assembled.contentHtml.includes(section.sourceUrl));
  assert.ok(assembled.contentHtml.includes('/blog') && assembled.contentHtml.includes('/#start-audit'));
});

test('claim checkpoints review every drafted section and preserve unsupported results across retries', async context => {
  const draftedSections = sections.map((section, index) => ({ index, heading: section.heading, contentHtml: html(index) }));
  const fullText = draftedSections.map(section => blogTextFromHtml(section.contentHtml)).join(' ') + ' Additional assembled source links and navigation.';
  let limited = false;
  const workflow = mockWorkflow(context, 'claim_validation', { ...baseOutputs(), draftedSections, draftingPlan: { sections }, assembled: { title: 'SEO checks', contentText: fullText } }, body => {
    const prompt = body.messages[1].content as string;
    const index = Number(prompt.match(/This is section (\d+)/)?.[1]) - 1;
    assert.ok(prompt.length < 10500);
    assert.equal(body.max_tokens, 1200);
    if (index === 1 && !limited) { limited = true; return new Response('', { status: 429, headers: { 'retry-after': '30' } }); }
    return { claimsSupported: index !== 1, warnings: index === 1 ? ['Second section needs factual review'] : [], publicationRecommendation: index === 1 ? 'Human review of this claim is required.' : 'Evidence supports this window.' };
  });
  await workflow.run();
  assert.equal(workflow.job.workflowStage, 'claim_validation');
  const retained = structuredClone(workflow.job.stageOutputs);
  assert.equal((retained.claimChecks as any[]).length, 1);
  await workflow.run();
  assert.deepEqual(workflow.job.stageOutputs, retained);
  (workflow.job.stageOutputs.claimChecks as any[]).push(structuredClone((workflow.job.stageOutputs.claimChecks as any[])[0]));
  while (workflow.job.workflowStage === 'claim_validation' && workflow.job.state !== 'failed') await workflow.run();
  assert.equal(workflow.job.workflowStage, 'originality_validation');
  const plan = workflow.job.stageOutputs.claimPlan as any[];
  assert.equal(plan.length, 4);
  assert.equal(plan.map(part => part.text).join(' '), fullText);
  assert.deepEqual((workflow.job.stageOutputs.claimChecks as any[]).map(check => check.index), [0, 1, 2, 3]);
  const validation = workflow.job.stageOutputs.claimValidation as any;
  assert.equal(validation.claimsSupported, false);
  assert.deepEqual(validation.warnings, ['Second section needs factual review']);
  assert.match(validation.publicationRecommendation, /Human review of this claim/);
  assert.equal(workflow.requests.length, 5);
});

test('invalid sections retry durably without an immediate larger repair request', async context => {
  const workflow = mockWorkflow(context, 'section_drafting', baseOutputs(), (_body, index) =>
    ({ contentHtml: index === 0 ? '<h1>Invalid section</h1>' : html(0) }));
  const retained = structuredClone(workflow.job.stageOutputs);
  const result = await workflow.run();
  assert.equal(result.errorCode, 'GROQ_SCHEMA_VALIDATION_FAILED');
  assert.equal(workflow.requests.length, 1);
  assert.equal(workflow.job.state, 'queued');
  assert.ok(Date.parse(workflow.job.nextRetryAt!) > Date.now() + 55_000);
  assert.deepEqual(workflow.job.stageOutputs, retained);
  await workflow.run();
  assert.equal(workflow.requests.length, 2);
  assert.equal((workflow.job.stageOutputs.draftedSections as any[]).length, 1);
  assert.equal(workflow.requests[0].messages[1].content, workflow.requests[1].messages[1].content);
});

test('legacy whole-article claims use a stable complete bounded plan including the article tail', async context => {
  const text = `${'Article claims require readable source evidence. '.repeat(1100)}TAIL_CLAIM_REQUIRES_REVIEW`;
  const workflow = mockWorkflow(context, 'claim_validation', { ...baseOutputs(), assembled: { title: 'Legacy article', contentText: text } }, body => {
    const prompt = body.messages[1].content as string;
    const tail = prompt.includes('TAIL_CLAIM_REQUIRES_REVIEW');
    assert.ok(prompt.length < 10500);
    return { claimsSupported: !tail, warnings: tail ? ['Tail claim needs review'] : [], publicationRecommendation: 'Review the supplied evidence.' };
  });
  await workflow.run();
  const plan = structuredClone(workflow.job.stageOutputs.claimPlan) as any[];
  assert.ok(text.length > 45000);
  assert.ok(plan.every(part => part.text.length <= 4000));
  assert.equal(plan.map(part => part.text).join(' '), text);
  while (workflow.job.workflowStage === 'claim_validation' && workflow.job.state !== 'failed') await workflow.run();
  assert.equal(workflow.job.workflowStage, 'originality_validation');
  assert.deepEqual(workflow.job.stageOutputs.claimPlan, plan);
  assert.equal(workflow.requests.length, plan.length);
  assert.equal((workflow.job.stageOutputs.claimValidation as any).claimsSupported, false);
  assert.deepEqual((workflow.job.stageOutputs.claimValidation as any).warnings, ['Tail claim needs review']);
});

test('insufficient readable evidence cannot pass claims even when the model approves', async context => {
  const workflow = mockWorkflow(context, 'claim_validation', { ...baseOutputs(), sourceEvidence: [{ url: sections[0].sourceUrl, text: 'Only a title' }], assembled: { title: 'Article', contentText: 'A factual claim requiring evidence.' } }, () => ({ claimsSupported: true, warnings: [], publicationRecommendation: 'Supported' }));
  await workflow.run();
  const validation = workflow.job.stageOutputs.claimValidation as any;
  assert.equal(validation.claimsSupported, false);
  assert.match(validation.warnings.join(' '), /not provide enough readable evidence/);
});

test('metadata uses a short excerpt without duplicated article HTML or complete text', async context => {
  const workflow = mockWorkflow(context, 'metadata_generation', { assembled: { title: 'SEO checks', contentHtml: `<p>${'HTML_ONLY_SENTINEL '.repeat(3000)}</p>`, contentText: `${'Readable article text. '.repeat(1500)}TEXT_TAIL_SENTINEL`, suggestedSlug: 'seo-checks' } }, body => {
    const prompt = body.messages[1].content as string;
    assert.ok(prompt.length < 2200);
    assert.equal(prompt.includes('HTML_ONLY_SENTINEL'), false);
    assert.equal(prompt.includes('TEXT_TAIL_SENTINEL'), false);
    return { seoTitle: 'Practical SEO checks', metaDescription: 'An independent review of useful SEO checks.', canonicalPath: '/blog/seo-checks' };
  });
  await workflow.run();
  assert.equal(workflow.job.workflowStage, 'claim_validation');
  assert.ok(workflow.job.stageOutputs.nextProviderRequestAt);
});

test('token reset durations have a conservative fallback and a bounded persisted cooldown', () => {
  const delay = (resetTokens: string | null, remainingTokens = '2000') => Date.parse(nextProviderRequestAt({ resetTokens, remainingTokens, limitTokens: '8000' }, 0));
  assert.equal(delay('7.66s'), 30000);
  assert.equal(delay('2m59.56s'), 180560);
  assert.equal(delay('50s'), 51000);
  assert.equal(delay('2h'), 900000);
  assert.equal(delay('invalid'), 30000);
  assert.equal(delay(null), 30000);
  assert.equal(delay('1m', '7000'), 30000);
  assert.equal(delay('1m', '-1'), 30000);
});

test('memory completion shares provider cooldown across jobs and rejected leases do not update it', async context => {
  const original = { ...process.env };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  context.after(() => { process.env = original; });
  let clock = Date.now();
  context.mock.method(Date, 'now', () => clock);
  const first = await blogAutomationRepository.createJob({ origin: 'admin_manual', topic: 'Memory first', initialStage: 'section_drafting', idempotencyKey: `pacing-first-${clock}` });
  const second = await blogAutomationRepository.createJob({ origin: 'admin_manual', topic: 'Memory second', initialStage: 'section_drafting', idempotencyKey: `pacing-second-${clock}` });
  await blogAutomationRepository.claimVercelStage('first-lease', first.id);
  const ready = new Date(clock + 90_000).toISOString();
  const input = { jobId: first.id, executionId: 'first-lease', expectedStage: 'section_drafting' as const, nextStage: 'section_drafting' as const, nextState: 'drafting' as const,
    output: { nextProviderRequestAt: ready }, progress: 42, message: 'Section checkpoint' };
  assert.ok(await blogAutomationRepository.completeVercelStage(input));
  assert.equal((await blogAutomationRepository.getDispatcherState()).provider_pause_until, ready);
  assert.equal(await blogAutomationRepository.claimVercelStage('second-lease', second.id), null);
  assert.equal(await blogAutomationRepository.completeVercelStage({ ...input, output: { nextProviderRequestAt: new Date(clock + 900_000).toISOString() } }), null);
  assert.equal((await blogAutomationRepository.getDispatcherState()).provider_pause_until, ready);
  clock += 95_000;
  assert.ok(await blogAutomationRepository.claimVercelStage('second-lease', second.id));
  assert.ok(await blogAutomationRepository.completeVercelStage({ ...input, jobId: second.id, executionId: 'second-lease', output: { savedSection: true } }));
  assert.equal((await blogAutomationRepository.getDispatcherState()).provider_pause_until, ready);
});

function interruptedSave(context: TestContext, options: { publish?: boolean; edited?: boolean; status?: 'needs_review' | 'published'; unsupported?: boolean } = {}) {
  const contentHtml = completeManualArticleLinks('<h2>Inspect the response</h2>'
    + Array.from({ length: 55 }, () => '<p>Inspect the returned document and record the observed page signals.</p>').join('')
    + '<h2>Review published links</h2><p>Compare the recorded destinations.</p><h2>Verify the correction</h2><p>Retest the original behavior.</p>', baseOutputs().sources);
  const draft = { title: 'Preserved custom headline', tagline: 'Inspect each correction against the original page evidence.',
    summary: 'Review page signals with reliable evidence.', excerpt: 'Inspect the initial document, metadata and article links against the evidence collected from the public page.',
    contentHtml, focusKeyword: 'response verification', tags: ['SEO'], suggestedSlug: 'saved-guide' };
  const workflow = mockWorkflow(context, 'quality_gate', { ...baseOutputs(), assembled: draft,
    originality: { passed: true }, claimValidation: { claimsSupported: !options.unsupported }, image: { status: 'not_required' } }, () => { throw new Error('Recovery must not regenerate content.'); });
  workflow.job.payload.publishWhenReady = Boolean(options.publish);
  let stored = mapBlogPostRow({ ...prepareBlogPost({ ...draft, status: 'needs_review', sources: baseOutputs().sources,
    sourceStatus: 'passed', originalityStatus: 'passed', prerenderStatus: 'passed', generationJobId: workflow.job.id }),
    id: 'saved-article', created_at: '2026-10-03T00:00:00Z', updated_at: '2026-10-03T00:00:01Z',
    ...(options.edited ? { content_html: `${contentHtml}<p>An administrator changed the article.</p>` } : {}),
    ...(options.status === 'published' ? { status: 'published', published_at: '2026-10-03T00:00:00Z' } : {}) });
  const writes: Record<string, unknown>[] = [], syncs: string[] = [], results: Record<string, unknown>[] = [];
  context.mock.method(blogRepository, 'getByGenerationJobId', async () => structuredClone(stored));
  context.mock.method(blogRepository, 'create', async () => { throw new Error('Interrupted saves must reuse the article.'); });
  context.mock.method(blogRepository, 'update', async (id, patch, expectedUpdatedAt) => {
    assert.equal(id, stored.id); assert.equal(expectedUpdatedAt, stored.updatedAt);
    writes.push(structuredClone(patch));
    stored = mapBlogPostRow({ ...prepareBlogPost({ ...stored, ...patch }), ...patch, id: stored.id,
      updated_at: new Date(Date.parse(stored.updatedAt) + 1000).toISOString() });
    return structuredClone(stored);
  });
  context.mock.method(blogRepository, 'syncEditorialRecords', async post => { syncs.push(post.status); });
  context.mock.method(blogAutomationRepository, 'getSettings', async () => ({ enabled: false }));
  context.mock.method(blogAutomationRepository, 'updateJob', async (_id, patch) => { results.push(structuredClone(patch)); return null; });
  context.mock.method(blogEditorRepository, 'createNotification', async () => null);
  return { ...workflow, writes, syncs, results, get stored() { return stored; } };
}

test('an interrupted private article finishes quality and evidence persistence without a second article or provider call', async context => {
  const workflow = interruptedSave(context);
  const result = await workflow.run();
  assert.equal(result.job?.workflowStage, 'ready_for_review');
  assert.equal(workflow.requests.length, 0);
  assert.deepEqual(workflow.syncs, ['needs_review']);
  assert.equal(workflow.results[0].articleId, 'saved-article');
  assert.equal((workflow.results[0].result as any).recoveredAfterRetry, true);
  assert.ok(workflow.writes[0].quality_results);
});

test('transient save errors defer durably and recovery still finishes the same article', async context => {
  const workflow = interruptedSave(context);
  let failed = false;
  context.mock.method(blogRepository, 'syncEditorialRecords', async post => {
    if (!failed) { failed = true; throw { code: '40001', message: 'Temporary serialization conflict.' }; }
    workflow.syncs.push(post.status);
  });
  const first = await workflow.run();
  assert.equal(first.errorCode, 'BLOG_DATABASE_40001');
  assert.equal(first.job?.workflowStage, 'quality_gate');
  assert.equal(first.job?.state, 'queued');
  assert.equal(workflow.results.length, 0);
  const recovered = await workflow.run();
  assert.equal(recovered.job?.workflowStage, 'ready_for_review');
  assert.equal(workflow.results.length, 1);
  assert.equal(workflow.stored.id, 'saved-article');
  assert.equal(workflow.requests.length, 0);
});

test('guarded one-click recovery saves evidence privately before publishing', async context => {
  const workflow = interruptedSave(context, { publish: true });
  const result = await workflow.run();
  assert.equal(result.job?.workflowStage, 'published', JSON.stringify(workflow.results));
  assert.deepEqual(workflow.syncs, ['needs_review', 'published']);
  assert.equal((workflow.results[0].result as any).published, true);
});

test('recovery never publishes changed content or unsupported claims', async context => {
  const workflow = interruptedSave(context, { publish: true, edited: true, unsupported: true });
  const result = await workflow.run();
  assert.equal(result.job?.workflowStage, 'ready_for_review');
  assert.equal(workflow.stored.status, 'needs_review');
  const blockers = (workflow.results[0].result as any).blockers as string[];
  assert.ok(blockers.some(item => item.includes('changed after AI claim validation')));
  assert.ok(blockers.some(item => item.includes('Factual claims need review')));
});

test('published recovery repairs evidence before completing the job', async context => {
  const workflow = interruptedSave(context, { status: 'published' });
  const result = await workflow.run();
  assert.equal(result.job?.workflowStage, 'published');
  assert.deepEqual(workflow.syncs, ['published']);
  assert.equal(workflow.writes.length, 0);
  assert.equal((workflow.results[0].result as any).published, true);
});

test('temporary infrastructure errors retry but permanent evidence and schema errors do not', () => {
  for (const code of ['08006', '40001', '40P01', '53300', '57P01', '57014', 'PGRST002']) {
    assert.equal(safeBlogStageError({ code, message: 'Temporary service problem.' }).retryable, true, code);
  }
  assert.equal(safeBlogStageError(new TypeError('fetch failed')).retryable, true);
  for (const code of ['23505', '42501', 'PGRST202']) assert.equal(safeBlogStageError({ code, message: 'Permanent configuration or input error.' }).retryable, false);
  assert.equal(safeBlogStageError(new Error('Unsupported factual claim.')).retryable, false);
});
