import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const entry = `import React from 'react'; import {createRoot} from 'react-dom/client'; import Start from '/src/components/blog/BlogStudioStart.tsx'; import Automation from '/src/components/blog/BlogAutomationPanel.tsx'; import '/src/index.css'; const view=location.pathname.endsWith('advanced')?React.createElement(Automation,{posts:[],onChanged(){}}):React.createElement(Start,{posts:[],onManual(){document.body.dataset.action='manual'},onOpenArticle(){},onOpenAutomation(){document.body.dataset.action='advanced'}}); createRoot(document.getElementById('root')).render(React.createElement('main',{style:{maxWidth:1200,margin:'0 auto',padding:16,minWidth:0}},view));`;
const fixtures = {
  name: 'blog-ui-fixtures', enforce: 'pre',
  resolveId(source) {
    if (source.endsWith('/api/auth-headers')) return '\0blog-check-auth';
    if (source.endsWith('/supabase/client')) return '\0blog-check-realtime';
    if (source === '/__blog_entry.jsx') return '\0blog-check-entry.jsx';
  },
  load(id) {
    if (id === '\0blog-check-auth') return 'export async function getAuthHeaders(base={}){return base}';
    if (id === '\0blog-check-realtime') return 'const channel={on(_kind,_options,callback){window.__emitBlogJob=callback;return channel},subscribe(){return channel}};export function getSupabaseBrowserClient(){return {channel(){return channel},async removeChannel(){}}}';
    if (id === '\0blog-check-entry.jsx') return entry;
  },
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/__blog_check/')) return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(await server.transformIndexHtml(req.url, '<html lang="en"><head><title>Blog UI check</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__blog_entry.jsx"></script></body></html>'));
    });
  },
};
const server = await createServer({ configFile: false, cacheDir: 'node_modules/.vite-blog-ui-check', resolve: { dedupe: ['react', 'react-dom'] }, optimizeDeps: { entries: [], include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'lucide-react'] }, plugins: [fixtures, react(), tailwindcss()], define: { __CRAWLIO_RELEASE__: '"blog-check"', __CRAWLIO_ENVIRONMENT__: '"test"' }, server: { host: '127.0.0.1', port: 5193, hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
const overview = Object.fromEntries('automaticGeneratedToday automaticGeneratedWeek automaticPublishedToday automaticPublishedWeek manuallyTriggered manualBatchArticles customHeadlineArticles updates skippedAutomaticOpportunities automaticHeldForReview highPriorityStories expiringStories draftsNeedingReview activeJobs unresolvedClaims sourceFailures linkFailures imageFailures qualityFailures originalityWarnings duplicateTopicWarnings prerenderFailures updatesDue sitemapReady rssReady providerInputTokens providerOutputTokens automaticReviewed automaticApproved automaticRejected vercelJobs stalledVercelJobs'.split(' ').map(key => [key, 0]));
const provider = { provider: 'Groq', execution: 'Vercel server workflow', enabled: true, configured: true, model: 'structured-model', structuredModel: 'structured-model', writerModel: 'writer-model', baseUrlHost: 'api.groq.com', health: 'not tested', lastErrorCode: '', fixtureAvailable: false };
const runtime = { dispatchConfigured: false, automationEnabled: false, providerEnabled: true, providerConfigured: true, generationAllowed: false, automaticPublishingAllowed: false, oneClickAllowed: false, cronSchedule: null, blockers: [{ code: 'BLOG_DISPATCH_NOT_CONFIGURED', message: 'Blog dispatcher is not configured.', action: 'Configure the deployment dispatcher and redeploy.' }] };
const job = { id: 'queued-job', state: 'queued', workflowStage: 'queued', origin: 'trend_autopilot', topic: 'Current SEO update', customHeadline: '', statusMessage: 'Queued for generation', stageProgress: 0, stageAttemptCount: 0, updatedAt: new Date().toISOString(), error: '', lastSafeErrorCode: '' };
const settings = { enabled: false, provider_enabled: true, timezone: 'UTC', approved_feed_urls: [], require_review_for_urgent: true, required_reviewed_articles_before_autopublish: 30, strict_autopilot_enabled: false, emergency_pause: false, pause_all_publication: false };
let browser;
let overviewFailed = false;
let settingsFailed = false;
const counts = new Map();
const writes = [];
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/tools/admin/blog/**', async route => {
    const path = new URL(route.request().url()).pathname.split('/admin/blog/')[1];
    counts.set(path, (counts.get(path) || 0) + 1);
    let data;
    let failure = '';
    if (path === 'overview') {
      if (overviewFailed) failure = 'Admin status is temporarily unavailable.';
      data = { overview: { ...overview, strictAutopilotUnlocked: false, lastSuccessfulStageAt: null }, provider, runtime, jobs: [job], discoveries: [] };
    } else if (path === 'settings') {
      if (settingsFailed) failure = 'Settings could not be read.';
      if (route.request().method() === 'PUT') writes.push({ path, body: route.request().postDataJSON() });
      data = { settings };
    } else if (path === 'provider/test') {
      provider.health = 'authentication failed'; provider.lastErrorCode = 'GROQ_AUTH_FAILED';
      data = { result: { status: 'authentication failed', model: provider.model, host: provider.baseUrlHost, durationMs: null, errorCode: 'GROQ_AUTH_FAILED' } };
    } else if (path === 'jobs') { writes.push({ path, body: route.request().postDataJSON() }); data = { job }; }
    else throw new Error(`Unexpected fixture request: ${path}`);
    await route.fulfill({ status: failure ? 503 : 200, json: failure ? { success: false, error: failure } : { success: true, data } });
  });
  const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
  const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.goto(`${origin}/__blog_check/studio`);
  await expect(page.getByText('Blog dispatcher is not configured.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Research, write and publish', exact: true })).toBeDisabled();
  await expect(page.getByText('Queued', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open editor', exact: true }).click();
  assert.equal(await page.locator('body').getAttribute('data-action'), 'manual');
  await noOverflow();
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow();
  runtime.dispatchConfigured = true; runtime.generationAllowed = true; runtime.oneClickAllowed = true; runtime.blockers = [];
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Research, write and publish', exact: true })).toBeEnabled();
  await page.getByRole('textbox', { name: 'Public source URL' }).fill('http://example.com/source');
  await expect(page.getByRole('button', { name: 'Create and publish', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Public source URL' }).fill('https://example.com/source');
  await page.getByRole('button', { name: 'Create and publish', exact: true }).click();
  await expect(page.getByText('Job queued; waiting for the dispatcher.', { exact: false })).toBeVisible();
  assert.equal(writes.at(-1).body.mode, 'one_click_source');
  assert.deepEqual(writes.at(-1).body.sourceUrls, ['https://example.com/source']);
  assert.equal('publishWhenReady' in writes.at(-1).body, false);
  overviewFailed = true;
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(page.getByText('Status could not be verified:', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Research, write and publish', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Open editor', exact: true })).toBeEnabled();
  overviewFailed = false; runtime.oneClickAllowed = false;
  await page.goto(`${origin}/__blog_check/advanced`);
  await expect(page.getByText('Drafting available', { exact: true })).toBeVisible();
  await page.getByText('Advanced content controls', { exact: false }).click();
  await expect(page.getByRole('button', { name: 'Discover', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Discover', exact: true }).click();
  await expect(page.getByText('Freshness discovery queued.', { exact: true })).toBeVisible();
  assert.equal(writes.at(-1).body.mode, 'discover');
  assert.equal('feedUrls' in writes.at(-1).body, false);
  await page.getByRole('textbox', { name: 'Article topic', exact: true }).fill('An actionable technical SEO guide');
  await expect(page.getByRole('button', { name: 'Live draft', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Research, write and publish', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Enable automatic discovery', exact: false }).check();
  const settingsReads = counts.get('settings');
  await page.evaluate(() => window.__emitBlogJob());
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await expect(page.getByRole('checkbox', { name: 'Enable automatic discovery', exact: false })).toBeChecked();
  assert.equal(counts.get('settings'), settingsReads, 'Realtime must not reload unsaved settings');
  await page.getByRole('button', { name: 'Test provider', exact: true }).click();
  await expect(page.getByText('Content operation failed', { exact: true })).toBeVisible();
  await expect(page.getByText('Groq connectivity verified for the tested model.', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Enable automatic discovery', exact: false })).toBeChecked();
  await noOverflow();
  assert.equal(writes.filter(item => item.path === 'settings').length, 0, 'Policy is never saved implicitly');
  settingsFailed = true;
  await page.reload();
  await expect(page.getByText('Automation settings could not be loaded.', { exact: false })).toBeVisible();
  await page.getByText('Advanced content controls', { exact: false }).click();
  await expect(page.getByRole('button', { name: 'Save settings', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Article topic', exact: true }).fill('A manual AI draft while settings are unavailable');
  await expect(page.getByRole('button', { name: 'Live draft', exact: true })).toBeEnabled();
  settingsFailed = false;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save settings', exact: true })).toBeEnabled();
  assert.deepEqual(errors, [], 'No UI runtime errors');
  console.log('PASS: real dispatch readiness, manual access, queued semantics, HTTPS sources, no policy writes, actionable status failure, draft-only readiness, built-in discovery, provider failure, unsaved settings, partial-load recovery and mobile overflow.');
} finally { await browser?.close(); await server.close(); }
