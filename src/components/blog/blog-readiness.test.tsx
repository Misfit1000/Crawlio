import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BlogAutomationDashboard, BlogProviderTestResult } from '../../lib/blog/client';
import type { BlogGenerationJob } from '../../lib/blog/types';
import BlogReadinessStatus from './BlogReadinessStatus';
import { blogJobStatus, blogReadiness, providerErrorAction, providerTestPassed, validBlogSourceUrl } from './blog-readiness';

const provider: BlogAutomationDashboard['provider'] = { provider: 'Groq', execution: 'Vercel server workflow', enabled: true, configured: true, model: 'structured-model', structuredModel: 'structured-model', writerModel: 'writer-model', baseUrlHost: 'api.groq.com' };
const dashboard = (overrides: Partial<BlogAutomationDashboard> = {}): BlogAutomationDashboard => ({ overview: { stalledVercelJobs: 0 } as BlogAutomationDashboard['overview'], provider, jobs: [], discoveries: [], ...overrides });

test('legacy readiness distinguishes key presence, enable flags and unverified execution', () => {
  assert.equal(blogReadiness(null).generationReady, false);
  const legacy = blogReadiness(dashboard());
  assert.equal(legacy.label, 'Provider configured');
  assert.equal(legacy.generationReady, true);
  assert.ok(legacy.warnings.some(item => item.code === 'BLOG_DISPATCH_UNVERIFIED'));
  const serverDisabled = blogReadiness(dashboard({ provider: { ...provider, enabled: false, serverEnabled: false, adminEnabled: true } }));
  assert.ok(serverDisabled.blockers.some(item => item.code === 'GROQ_SERVER_DISABLED'));
  assert.ok(!serverDisabled.blockers.some(item => item.code === 'GROQ_ADMIN_DISABLED'));
  const adminDisabled = blogReadiness(dashboard({ provider: { ...provider, enabled: false, serverEnabled: true, adminEnabled: false } }));
  assert.ok(adminDisabled.blockers.some(item => item.code === 'GROQ_ADMIN_DISABLED'));
  assert.equal(adminDisabled.oneClickReady, false);
});

test('server diagnostics can block publication independently of generation, without overriding disabled provider', () => {
  const runtime = { dispatchConfigured: true, automationEnabled: false, providerEnabled: true, providerConfigured: true, generationAllowed: true, automaticPublishingAllowed: false, cronSchedule: null, oneClickAllowed: false, blockers: [{ code: 'BLOG_PUBLICATION_PAUSED', message: 'Publication is paused.', action: 'Review the saved publication policy.' }] };
  const status = blogReadiness(dashboard({ runtime }));
  assert.equal(status.generationReady, true);
  assert.equal(status.oneClickReady, false);
  assert.equal(status.label, 'Drafting available');
  assert.equal(blogReadiness(dashboard({ runtime, provider: { ...provider, enabled: false } })).generationReady, false);
  assert.equal(blogReadiness(dashboard({ runtime: { ...runtime, generationAllowed: false } })).generationReady, false);
  assert.equal(blogReadiness(dashboard({ runtime: { ...runtime, dispatchConfigured: false } })).generationReady, false);
  assert.equal(blogReadiness(dashboard({ runtime: { ...runtime, oneClickAllowed: true } })).oneClickReady, true);
});

test('provider test failures are not successes and safe codes have actionable explanations', () => {
  const result: BlogProviderTestResult = { status: 'authentication failed', model: 'structured-model', host: 'api.groq.com', durationMs: null, errorCode: 'GROQ_AUTH_FAILED' };
  assert.equal(providerTestPassed(result), false);
  assert.equal(providerTestPassed({ ...result, status: 'connected' }), false);
  assert.equal(providerTestPassed({ ...result, status: 'connected', errorCode: null }), true);
  assert.match(providerErrorAction(result.errorCode!), /Groq API credential/);
  assert.match(providerErrorAction('GROQ_MODEL_UNAVAILABLE'), /model/);
  assert.match(providerErrorAction('GROQ_RATE_LIMITED'), /Wait/);
});

test('job statuses reflect queue, review and terminal states, and source URL syntax is checked', () => {
  const job = { state: 'queued', workflowStage: 'queued' } as BlogGenerationJob;
  assert.equal(blogJobStatus(job).label, 'Queued');
  assert.equal(blogJobStatus({ ...job, state: 'ready_for_review' }).label, 'Ready for review');
  assert.equal(blogJobStatus({ ...job, state: 'cancelled' }).label, 'Cancelled');
  assert.equal(blogJobStatus({ ...job, state: 'skipped' }).label, 'Skipped');
  assert.equal(blogJobStatus({ ...job, state: 'failed' }).tone, 'danger');
  assert.equal(validBlogSourceUrl('https://developers.google.com/search/blog'), true);
  for (const url of ['', 'not a URL', 'http://example.com', 'https://user:pass@example.com', 'https://localhost/path']) assert.equal(validBlogSourceUrl(url), false);
});

test('readiness displays deployment diagnostics rather than a generic connect instruction', () => {
  const html = renderToStaticMarkup(<BlogReadinessStatus dashboard={dashboard({ provider: { ...provider, enabled: false, serverEnabled: false, adminEnabled: true, health: 'not tested' } })} loading={false} />);
  assert.match(html, /GROQ_BLOG_ENABLED=true/);
  assert.match(html, /Present \(not a connectivity test\)/);
  assert.match(html, /Generation blocked/);
  const unavailable = renderToStaticMarkup(<BlogReadinessStatus dashboard={null} loading={false} error="Admin session expired." />);
  assert.match(unavailable, /Admin session expired/);
  assert.match(unavailable, /Manual writing remains available/);
  assert.doesNotMatch(unavailable, /Groq generation is disabled/);
});
