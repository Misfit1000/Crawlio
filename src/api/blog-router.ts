import { Router } from 'express';

import { authorizeScheduler } from '../lib/api/scheduler-auth';

import { waitUntil } from '@vercel/functions';

import { requireSupabaseAdminClient } from '../lib/supabase/server';

import { ensureUserProfileFromAuthUser, getAuthenticatedUserFromRequest } from '../lib/billing/entitlements';

import { createRateLimiter } from '../lib/api/http-hardening';

import { blogRepository, mapBlogPostRow } from '../lib/blog/repository';

import { normalizeBlogSlug } from '../lib/blog/slug';

import { BlogValidationError, prepareBlogPost } from '../lib/blog/validation';

import { canonicalSiteOrigin, renderBlogNewsSitemap, renderBlogRss, renderBlogSitemap } from '../lib/blog/sitemap';

import { renderBlogArticleHtml } from '../lib/blog/render';

import { renderBlogListingHtml } from '../lib/blog/public-render';

import { blogAutomationRepository } from '../lib/blog/automation-repository';

import { blogJobIdempotencyKey, validateManualBatch } from '../lib/blog/automation';

import { getGroqBlogConfiguration, getSafeGroqDiagnostics, GROQ_DEFAULT_STRUCTURED_MODEL, GROQ_DEFAULT_WRITER_MODEL, testGroqProvider } from '../lib/blog/server/groq';

import { dispatchVercelBlogStages, recoverAndDispatchVercelBlogWork, safeBlogStageError } from '../lib/blog/server/vercel-workflow';

import { blogJobIsActive, blogJobResumeDelay, blogRuntimeReadiness, runBoundedBlogDispatch } from '../lib/blog/server/dispatch-runner';

import { normalizeBlogArticleType } from '../lib/blog/length-policy';

import { validateCalendarMove } from '../lib/blog/freshness';

import { BLOG_FIXTURE_MODEL, BLOG_FIXTURE_PROVIDER, getBlogFixtureConfiguration, requireBlogFixtureProvider } from '../lib/blog/fixture-provider';

import { blogSourceRepository } from '../lib/blog/source-management';

import { blogEditorRepository, BlogDraftConflictError } from '../lib/blog/editor-repository';

import { buildBlogReadiness } from '../lib/blog/editor-experience';

import { projectBlogGenerationReview } from '../lib/blog/generation-review';

import { applySafeBlogFixes } from '../lib/blog/editor-safe-fixes';

import { suggestBlogHeadingStructure } from '../lib/blog/server/editor-assistance';

import { normalizePublicBlogSourceUrl } from '../lib/blog/source-url';

import { indexNowKey, notifyIndexNow } from '../lib/blog/indexnow';

import { ApiError } from '../lib/api/errors';


export const apiRouter = Router();


function asyncJsonRoute(handler: any) {
  return async (req: any, res: any, next: any) => {
    try {
      await handler(req, res, next);
    } catch (error: unknown) {
      next(error);
    }
  };
}

function firstHeaderValue(value: unknown) {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function schedulerRequestAllowed(req: any, scope: 'cron' | 'dispatch' = 'cron') {
  const supplied = firstHeaderValue(req.headers?.authorization).replace(/^Bearer\s+/i, '') || firstHeaderValue(req.headers?.['x-blog-scheduler-secret']);
  return authorizeScheduler(supplied, scope);
}

function requestOrigin(req: any) {
  const configured = [
    process.env.APP_URL || '',
    process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '',
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '',
  ];
  for (const value of configured) {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:') return url.origin;
    } catch {}
  }
  if (process.env.NODE_ENV === 'production') return '';
  const proto = firstHeaderValue(req.headers?.['x-forwarded-proto']) || 'http';
  const host = firstHeaderValue(req.headers?.['x-forwarded-host']) || firstHeaderValue(req.headers?.host);
  try {
    const url = new URL(`${proto}://${host}`);
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname) ? url.origin : '';
  } catch {
    return '';
  }
}

const activeBlogDispatches = new Map<string, Promise<void>>();

function requestImmediateBlogDispatch(req: any, jobId: string | null, chainDepth = 0, prepare?: () => Promise<void>) {
  if (process.env.NODE_ENV === 'test') return;
  // A handoff may reach the same warm function before its caller has finished.
  const key = `${jobId || 'queue'}:${chainDepth}`;
  const existing = activeBlogDispatches.get(key);
  if (existing) { waitUntil(existing); return; }
  const task = (async () => {
    try {
      if (prepare) await prepare();
      const readiness = blogRuntimeReadiness(await blogAutomationRepository.getSettings());
      if (!readiness.generationAllowed) return;
      const data = await runBoundedBlogDispatch({ requestedJobId: jobId });
      const secret = String(process.env.BLOG_DISPATCH_SECRET || '').trim();
      const origin = requestOrigin(req);
      const retryDelay = blogJobResumeDelay(data.latestJob);
      if (data.pendingJobId && retryDelay <= 60_000 && chainDepth < 8 && secret.length >= 24 && origin) {
        const response = await fetch(`${origin}/api/tools/blog/jobs/dispatch`, {
          method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId: data.pendingJobId, chainDepth: chainDepth + 1 }), signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new ApiError('BLOG_CONTINUATION_FAILED', `Blog continuation returned HTTP ${response.status}. Open Blog Studio to resume the queued job.`, 503);
      }
    } catch (error) {
      const safe = safeBlogStageError(error);
      console.warn('Blog background dispatch stopped', { code: safe.code, message: safe.message, jobId });
    } finally { activeBlogDispatches.delete(key); }
  })();
  activeBlogDispatches.set(key, task);
  waitUntil(task);
}

async function getRequester(req: any) {
  const authUser = await getAuthenticatedUserFromRequest(req);
  if (!authUser) return { userId: null, profile: null };
  req.requesterUserId = authUser.id;
  const profile = await ensureUserProfileFromAuthUser(authUser);
  return { userId: authUser.id, profile };
}

async function requireAdminRequester(req: any, res: any) {
  const requester = await getRequester(req);
  if (!requester.userId || !requester.profile) {
    res.status(401).json({ success: false, error: 'Authentication required.' });
    return null;
  }
  if (requester.profile.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin access required.' });
    return null;
  }
  return requester;
}

async function uniqueBlogSlug(value: string, exceptId?: string) {
  const base = normalizeBlogSlug(value);
  let candidate = base;
  for (let suffix = 2; await blogRepository.slugExists(candidate, exceptId); suffix += 1) {
    candidate = `${base.slice(0, Math.max(1, 116 - String(suffix).length)).replace(/-+$/g, '')}-${suffix}`;
    if (suffix > 9999) throw new Error('Could not create a unique slug.');
  }
  return candidate;
}

function prepareBlogPostForStorage(input: any) {
  const row = prepareBlogPost({ ...input, prerenderStatus: 'passed' });
  const now = new Date().toISOString();
  const candidate = mapBlogPostRow({ ...row, id: 'prerender-check', created_at: now, updated_at: now });
  const html = renderBlogArticleHtml(candidate, canonicalSiteOrigin());
  if (!html.startsWith('<!doctype html>') || !html.includes('<h1>') || !html.includes('application/ld+json') || !html.includes('rel="canonical"')) {
    throw new BlogValidationError('Publication blocked: initial article HTML is incomplete.');
  }
  row.prerender_status = 'passed';
  return row;
}

function boundedBlogEditorPayload(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('BLOG_EDITOR_PAYLOAD_INVALID', 'The editor draft is invalid.', 400);
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (bytes > 350_000) throw new ApiError('BLOG_EDITOR_PAYLOAD_TOO_LARGE', 'The editor draft exceeds the 350 KB autosave limit.', 413);
  const input = value as Record<string, unknown>;
  const allowed = [
    'title', 'slug', 'excerpt', 'tagline', 'summary', 'contentHtml', 'focusKeyword', 'tags', 'seoTitle', 'metaDescription',
    'canonicalUrl', 'ogImageUrl', 'ogImageAlt', 'ogImageAttribution', 'imageVariants', 'status', 'origin', 'articleType',
    'topicCluster', 'language', 'robotsDirective', 'freshnessStatus', 'scheduledAt', 'publishedAt', 'sources', 'relatedArticles',
    'qualityStatus', 'qualityResults', 'originalityStatus', 'sourceStatus', 'prerenderStatus', 'imageStatus', 'fixtureTest',
    'editorStep', 'automaticOverrides',
  ];
  return Object.fromEntries(Object.entries(input).filter(([key]) => allowed.includes(key)));
}

function editorDraftIdentity(value: unknown) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(text)) throw new ApiError('BLOG_EDITOR_DRAFT_ID_INVALID', 'The editor draft identifier is invalid.', 400);
  return text;
}

function requestedBlogSourceUrl(value: unknown) {
  try {
    return normalizePublicBlogSourceUrl(value);
  } catch {
    throw new ApiError('BLOG_SOURCE_URL_INVALID', 'Enter one public HTTP or HTTPS source URL on a standard port.', 400);
  }
}

async function logBlogAction(adminUserId: string, action: string, postId: string, metadata: Record<string, unknown> = {}) {
  const client = (await import('../lib/supabase/server')).getSupabaseAdminClient();
  if (!client) return;
  await client.from('admin_actions').insert({ admin_user_id: adminUserId, action, target_type: 'blog_post', target_id: postId, metadata });
}

async function syncApprovedFeedSettings(adminUserId: string) {
  const sources = await blogSourceRepository.list();
  const urls = sources.filter((source) => source.enabled && !['manual_url', 'imported'].includes(source.feedType)).map((source) => source.sourceUrl).slice(0, 20);
  await blogAutomationRepository.updateSettings({ approved_feed_urls: urls }, adminUserId);
}

apiRouter.get('/blog/posts', asyncJsonRoute(async (req, res) => {
  const [result, topics] = await Promise.all([
    blogRepository.listPublished({ query: String(req.query.q || ''), limit: Number(req.query.limit || 12), offset: Number(req.query.offset || 0) }),
    blogRepository.listPublishedTopics(),
  ]);
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600');
  res.json({ success: true, data: { ...result, topics } });
}));

apiRouter.get('/blog/index.html', asyncJsonRoute(async (req, res) => {
  const pageSize = 10;
  const page = Math.max(1, Math.min(500, Number.parseInt(String(req.query.page || '1'), 10) || 1));
  const query = String(req.query.q || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  const [result, topics] = await Promise.all([
    blogRepository.listPublished({ query, limit: pageSize, offset: (page - 1) * pageSize }),
    blogRepository.listPublishedTopics(),
  ]);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600');
  res.status(200).send(renderBlogListingHtml({
    origin: canonicalSiteOrigin(req),
    posts: result.posts,
    topics,
    total: result.total,
    page,
    pageSize,
    query,
  }));
}));

apiRouter.get('/blog/topic/:topic', asyncJsonRoute(async (req, res) => {
  const pageSize = 10;
  const page = Math.max(1, Math.min(500, Number.parseInt(String(req.query.page || '1'), 10) || 1));
  const topics = await blogRepository.listPublishedTopics();
  const selectedTopic = topics.find((topic) => topic.slug === normalizeBlogSlug(req.params.topic));
  if (!selectedTopic) {
    return res.status(404).type('html').send('<!doctype html><html><head><meta name="robots" content="noindex"></head><body><h1>Topic not found</h1><p><a href="/blog">Browse all articles</a></p></body></html>');
  }
  const result = await blogRepository.listPublished({ topic: selectedTopic.name, limit: pageSize, offset: (page - 1) * pageSize });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600');
  res.status(200).send(renderBlogListingHtml({
    origin: canonicalSiteOrigin(req),
    posts: result.posts,
    topics,
    total: result.total,
    page,
    pageSize,
    selectedTopic,
  }));
}));

apiRouter.get('/blog/sitemap.xml', asyncJsonRoute(async (req, res) => {
  const xml = await renderBlogSitemap(canonicalSiteOrigin(req));
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600');
  res.status(200).send(xml);
}));

apiRouter.get('/blog/rss.xml', asyncJsonRoute(async (req, res) => {
  const xml = await renderBlogRss(canonicalSiteOrigin(req));
  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600');
  res.status(200).send(xml);
}));

apiRouter.get('/blog/news-sitemap.xml', asyncJsonRoute(async (req, res) => {
  const xml = await renderBlogNewsSitemap(canonicalSiteOrigin(req));
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600');
  res.status(200).send(xml);
}));

async function prepareScheduledBlogWork() {
  await Promise.all([blogAutomationRepository.recoverVercelJobs(10), blogRepository.publishDueScheduled(10)]);
  const settings = await blogAutomationRepository.getSettings();
  const runtime = blogRuntimeReadiness(settings);
  if (runtime.generationAllowed && runtime.automationEnabled && settings.enabled) {
    await blogAutomationRepository.createJob({
      origin: 'autopilot', payload: { jobType: 'discover_trends', feedUrls: settings.approved_feed_urls },
      idempotencyKey: blogJobIdempotencyKey({ origin: 'autopilot', topic: 'scheduled-discovery' }),
    });
  }
}

const runBlogScheduler = asyncJsonRoute(async (req: any, res: any) => {
  if (!schedulerRequestAllowed(req)) throw new ApiError('BLOG_SCHEDULER_UNAUTHORIZED', 'Scheduler authentication failed.', 401);
  requestImmediateBlogDispatch(req, null, 0, prepareScheduledBlogWork);
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(202).json({ success: true, data: { accepted: true, execution: 'durable_background' } });
});

apiRouter.get('/blog/scheduler/run', runBlogScheduler);

apiRouter.post('/blog/scheduler/run', runBlogScheduler);

const runBlogDispatcher = asyncJsonRoute(async (req: any, res: any) => {
  if (!schedulerRequestAllowed(req, req.method === 'GET' ? 'cron' : 'dispatch')) throw new ApiError('BLOG_DISPATCH_UNAUTHORIZED', 'Dispatcher authentication failed.', 401);
  const requestedJobId = String(req.body?.jobId || req.query?.jobId || '').trim() || null;
  if (requestedJobId && !/^[0-9a-f-]{36}$/i.test(requestedJobId)) throw new ApiError('BLOG_JOB_ID_INVALID', 'The requested blog job ID is invalid.', 400);
  const chainDepth = Math.max(0, Math.min(8, Number(req.body?.chainDepth || 0) || 0));
  requestImmediateBlogDispatch(req, requestedJobId, chainDepth, req.method === 'GET' ? prepareScheduledBlogWork : undefined);
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(202).json({ success: true, data: { accepted: true, jobId: requestedJobId, execution: 'durable_background' } });
});

apiRouter.get('/blog/jobs/dispatch', runBlogDispatcher);

apiRouter.post('/blog/jobs/dispatch', runBlogDispatcher);

apiRouter.post('/blog/jobs/recover', asyncJsonRoute(async (req, res) => {
  if (!schedulerRequestAllowed(req, 'dispatch')) throw new ApiError('BLOG_RECOVERY_UNAUTHORIZED', 'Recovery authentication failed.', 401);
  const data = await recoverAndDispatchVercelBlogWork(Math.max(1, Math.min(3, Number(req.body?.maxStages || 1))));
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data });
}));

apiRouter.get('/blog/html/:slug', asyncJsonRoute(async (req, res) => {
  const post = await blogRepository.getPublishedBySlug(normalizeBlogSlug(req.params.slug));
  if (!post) return res.status(404).type('html').send('<!doctype html><html><head><meta name="robots" content="noindex"></head><body><h1>Article not found</h1><p><a href="/blog">Return to the blog</a></p></body></html>');
  if (!post.relatedArticles.length) {
    const related = await blogRepository.relatedPublished(post, 4);
    post.relatedArticles = related.map((item) => ({ postId: item.id, slug: item.slug, title: item.title, reason: item.topicCluster ? `More guidance about ${item.topicCluster}.` : '' }));
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600');
  res.status(200).send(renderBlogArticleHtml(post, canonicalSiteOrigin(req)));
}));

apiRouter.get('/blog/posts/:slug', asyncJsonRoute(async (req, res) => {
  const post = await blogRepository.getPublishedBySlug(normalizeBlogSlug(req.params.slug));
  if (!post) return res.status(404).json({ success: false, error: 'Article not found.' });
  if (!post.relatedArticles.length) {
    const related = await blogRepository.relatedPublished(post, 4);
    post.relatedArticles = related.map((item) => ({ postId: item.id, slug: item.slug, title: item.title, reason: item.topicCluster ? `More guidance about ${item.topicCluster}.` : '' }));
  }
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600');
  res.json({ success: true, data: { post } });
}));

apiRouter.get('/admin/blog/posts', asyncJsonRoute(async (req, res) => {
  if (!(await requireAdminRequester(req, res))) return;
  const posts = await blogRepository.listAdmin(Number(req.query.limit || 100));
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: { posts } });
}));

apiRouter.get('/blog/indexnow-key.txt', asyncJsonRoute(async (_req, res) => {
  const key = indexNowKey();
  if (!key) throw new ApiError('INDEXNOW_NOT_CONFIGURED', 'IndexNow is not configured.', 404);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(key);
}));

apiRouter.post('/admin/blog/source/inspect', asyncJsonRoute(async (req, res) => {
  if (!(await requireAdminRequester(req, res))) return;
  const sourceUrl = requestedBlogSourceUrl(req.body?.sourceUrl);
  let source;
  try {
    const { researchSourceUrls } = await import('../lib/blog/research');
    [source] = await researchSourceUrls([sourceUrl]);
  } catch {
    throw new ApiError('BLOG_SOURCE_UNAVAILABLE', 'Crawlio could not safely read usable source details from that URL.', 422);
  }
  if (!source) throw new ApiError('BLOG_SOURCE_UNAVAILABLE', 'Crawlio could not extract usable source details from that URL.', 422);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: { source } });
}));

apiRouter.post('/admin/blog/preflight', asyncJsonRoute(async (req, res) => {
  if (!(await requireAdminRequester(req, res))) return;
  const action = String(req.body?.action || 'inspect');
  if (!['inspect', 'safe_fix', 'suggest_headings'].includes(action)) throw new ApiError('BLOG_PREFLIGHT_ACTION_INVALID', 'Choose a supported article check action.', 400);
  const input = boundedBlogEditorPayload(req.body?.input || {}) as any;
  const overrides = Array.isArray(req.body?.overrides) ? req.body.overrides.map(String).slice(0, 20) : [];
  let draft = action === 'safe_fix' ? applySafeBlogFixes(input, overrides) : input;
  let headingPreview;
  if (action === 'suggest_headings') {
    const suggestion = await suggestBlogHeadingStructure(String(input.contentHtml || ''));
    headingPreview = { previousContentHtml: String(input.contentHtml || ''), contentHtml: suggestion.contentHtml, headings: suggestion.headings };
    draft = { ...input, contentHtml: suggestion.contentHtml };
  }
  const readiness = buildBlogReadiness(draft);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: { draft, readiness, ...(headingPreview ? { headingPreview } : {}) } });
}));

apiRouter.get('/admin/blog/editor-draft', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const clientDraftId = editorDraftIdentity(req.query.clientDraftId);
  const articleId = String(req.query.articleId || '').trim() || null;
  const draft = await blogEditorRepository.getDraft(requester.userId, clientDraftId, articleId);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: { draft } });
}));

apiRouter.put('/admin/blog/editor-draft', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const clientDraftId = editorDraftIdentity(req.body?.clientDraftId);
  const payload = boundedBlogEditorPayload(req.body?.payload || {});
  try {
    const draft = await blogEditorRepository.saveDraft({
      adminUserId: requester.userId, clientDraftId, articleId: String(req.body?.articleId || '').trim() || null,
      payload, expectedVersion: req.body?.expectedVersion == null ? null : Number(req.body.expectedVersion),
      basePostUpdatedAt: req.body?.basePostUpdatedAt ? new Date(String(req.body.basePostUpdatedAt)).toISOString() : null,
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ success: true, data: { draft } });
  } catch (error) {
    if (error instanceof BlogDraftConflictError) throw new ApiError('BLOG_EDITOR_DRAFT_CONFLICT', error.message, 409);
    throw error;
  }
}));

apiRouter.delete('/admin/blog/editor-draft', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const clientDraftId = editorDraftIdentity(req.body?.clientDraftId);
  await blogEditorRepository.deleteDraft(requester.userId, clientDraftId, String(req.body?.articleId || '').trim() || null);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: { deleted: true } });
}));

apiRouter.get('/admin/blog/notifications', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const notifications = await blogEditorRepository.listNotifications(requester.userId, Number(req.query.limit || 30));
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: { notifications } });
}));

apiRouter.post('/admin/blog/notifications/read', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter((id: string) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 50) : [];
  await blogEditorRepository.markNotificationsRead(requester.userId, ids);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: { updated: true } });
}));

apiRouter.get('/admin/blog/overview', asyncJsonRoute(async (req, res) => {
  if (!(await requireAdminRequester(req, res))) return;
  const [overview, jobs, discoveries, settings] = await Promise.all([
    blogAutomationRepository.overview(),
    blogAutomationRepository.listJobs(40),
    blogAutomationRepository.listDiscoveries(40),
    blogAutomationRepository.getSettings(),
  ]);
  res.setHeader('Cache-Control', 'private, no-store');
  const providerConfiguration = getGroqBlogConfiguration();
  const fixtureConfiguration = getBlogFixtureConfiguration();
  res.json({ success: true, data: { overview, jobs, discoveries, runtime: blogRuntimeReadiness(settings), provider: { provider: 'Groq', execution: 'Vercel server workflow', enabled: Boolean(settings.provider_enabled && providerConfiguration.enabled), configured: providerConfiguration.configured, serverEnabled: providerConfiguration.enabled, adminEnabled: settings.provider_enabled === true, automationEnabled: String(process.env.BLOG_AUTOMATION_ENABLED).trim().toLowerCase() === 'true', model: providerConfiguration.structuredModel, structuredModel: providerConfiguration.structuredModel, writerModel: providerConfiguration.writerModel, baseUrlHost: providerConfiguration.baseUrlHost, health: settings.provider_last_error_code ? 'attention required' : settings.provider_last_success_at ? 'connected' : providerConfiguration.configured ? 'not tested' : providerConfiguration.enabled ? 'not configured' : 'disabled', lastSuccessAt: settings.provider_last_success_at || null, lastErrorCode: settings.provider_last_error_code || '', lastDurationMs: settings.provider_last_duration_ms ?? null, liveVerificationStatus: settings.provider_live_verification_status || 'not_run', fixtureAvailable: fixtureConfiguration.enabled } } });
}));

apiRouter.get('/admin/blog/provider/diagnostics', asyncJsonRoute(async (req, res) => {
  if (!(await requireAdminRequester(req, res))) return;
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: getSafeGroqDiagnostics() });
}));

apiRouter.post('/admin/blog/provider/test', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const result = await testGroqProvider();
  await blogAutomationRepository.recordProviderHealth({ status: result.status, errorCode: result.errorCode, durationMs: result.durationMs, actorId: requester.userId, testKind: 'admin_test' });
  await logBlogAction(requester.userId, 'test_blog_provider', 'groq', { status: result.status, model: result.model });
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: { result } });
}));

apiRouter.get('/admin/blog/settings', asyncJsonRoute(async (req, res) => {
  if (!(await requireAdminRequester(req, res))) return;
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: { settings: await blogAutomationRepository.getSettings() } });
}));

apiRouter.put('/admin/blog/settings', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const feedUrls = Array.isArray(req.body?.approved_feed_urls) ? req.body.approved_feed_urls.slice(0, 20).map(String) : [];
  const providerConfiguration = getGroqBlogConfiguration();
  if (req.body?.enabled === true && (!providerConfiguration.configured || !providerConfiguration.enabled || process.env.BLOG_AUTOMATION_ENABLED !== 'true')) {
    throw new ApiError('BLOG_PROVIDER_NOT_CONFIGURED', 'Configure Groq and enable both Groq and blog automation in the Vercel server environment before enabling automatic generation.', 409);
  }
  if (feedUrls.some((value) => { try { return new URL(value).protocol !== 'https:'; } catch { return true; } })) throw new ApiError('INVALID_BLOG_FEED', 'Approved feeds must use valid public HTTPS URLs.', 400);
  const timezone = String(req.body?.timezone || 'UTC');
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); } catch { throw new ApiError('INVALID_TIMEZONE', 'Enter a valid IANA timezone.', 400); }
  const settings = await blogAutomationRepository.updateSettings({ ...req.body, timezone, approved_feed_urls: feedUrls }, requester.userId);
  await logBlogAction(requester.userId, 'update_blog_autopilot_settings', 'default', { enabled: settings.enabled, timezone });
  res.json({ success: true, data: { settings } });
}));

apiRouter.get('/admin/blog/sources', asyncJsonRoute(async (req, res) => {
  if (!(await requireAdminRequester(req, res))) return;
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: { sources: await blogSourceRepository.list() } });
}));

apiRouter.post('/admin/blog/sources', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const source = await blogSourceRepository.create(req.body || {}, requester.userId);
  await syncApprovedFeedSettings(requester.userId);
  await logBlogAction(requester.userId, 'create_blog_approved_source', source.id, { sourceUrl: source.sourceUrl, feedType: source.feedType });
  res.status(201).json({ success: true, data: { source } });
}));

apiRouter.put('/admin/blog/sources/:id', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const source = await blogSourceRepository.update(req.params.id, req.body || {}, requester.userId);
  if (!source) throw new ApiError('BLOG_SOURCE_NOT_FOUND', 'Approved source not found.', 404);
  await syncApprovedFeedSettings(requester.userId);
  await logBlogAction(requester.userId, 'update_blog_approved_source', source.id, { enabled: source.enabled, classification: source.classification });
  res.json({ success: true, data: { source } });
}));

apiRouter.delete('/admin/blog/sources/:id', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const reason = String(req.body?.reason || req.query?.reason || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (reason.length < 4) throw new ApiError('BLOG_OPERATION_REASON_REQUIRED', 'Provide a reason for deleting this source.', 400);
  if (!(await blogSourceRepository.remove(req.params.id))) throw new ApiError('BLOG_SOURCE_NOT_FOUND', 'Approved source not found.', 404);
  await syncApprovedFeedSettings(requester.userId);
  await logBlogAction(requester.userId, 'delete_blog_approved_source', req.params.id, { reason });
  res.json({ success: true, data: { deleted: true } });
}));

apiRouter.post('/admin/blog/sources/:id/test', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const result = await blogSourceRepository.test(req.params.id);
  if (!result) throw new ApiError('BLOG_SOURCE_NOT_FOUND', 'Approved source not found.', 404);
  await logBlogAction(requester.userId, 'test_blog_approved_source', req.params.id, { success: result.result.success, safeFailureCode: result.result.safeFailureCode });
  res.json({ success: true, data: result });
}));

apiRouter.post('/admin/blog/trends/:id/action', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const action = String(req.body?.action || '');
  const statusByAction: Record<string, string> = { add_to_research: 'review', link_existing: 'covered', convert_update: 'selected', dismiss: 'skipped', monitor: 'monitor', mark_covered: 'covered', add_to_calendar: 'selected', create_draft: 'selected' };
  if (!statusByAction[action]) throw new ApiError('BLOG_TREND_ACTION_INVALID', 'Choose a supported trend action.', 400);
  const discovery = await blogAutomationRepository.updateDiscovery(req.params.id, { status: statusByAction[action], existing_coverage: action === 'mark_covered' || action === 'link_existing' });
  if (!discovery) throw new ApiError('BLOG_TREND_NOT_FOUND', 'Trend discovery not found.', 404);
  let job = null;
  if (action === 'create_draft') {
    const [providerConfiguration, settings] = await Promise.all([Promise.resolve(getGroqBlogConfiguration()), blogAutomationRepository.getSettings()]);
    if (!providerConfiguration.enabled || !providerConfiguration.configured || settings.provider_enabled !== true) {
      throw new ApiError('BLOG_PROVIDER_NOT_READY', 'Creating a sourced trend draft requires a connected Groq provider.', 503);
    }
    job = await blogAutomationRepository.createJob({
      origin: 'trend_autopilot', topic: String(discovery.source_title || ''), requestedBy: requester.userId,
      provider: 'groq', model: GROQ_DEFAULT_STRUCTURED_MODEL,
      payload: {
        jobType: 'generate_article',
        articleType: Number(discovery.age_hours || 999) <= 48 ? 'urgent_news' : 'news_analysis',
        lengthMode: 'automatic',
        topicCluster: discovery.topic_cluster,
        discoveryId: discovery.id,
        sourceUrls: [String(discovery.source_url || '')].filter(Boolean),
      },
      idempotencyKey: blogJobIdempotencyKey({ origin: 'trend_autopilot', topic: `trend:${discovery.id}`, dateBucket: new Date().toISOString().slice(0, 13) }),
    });
    requestImmediateBlogDispatch(req, job.id);
  }
  await logBlogAction(requester.userId, `blog_trend_${action}`, req.params.id, { jobId: job?.id || null });
  res.json({ success: true, data: { discovery, job } });
}));

apiRouter.get('/admin/blog/operations', asyncJsonRoute(async (req, res) => {
  if (!(await requireAdminRequester(req, res))) return;
  const [jobs, posts, sources, staleLeases, settings, dispatcher] = await Promise.all([
    blogAutomationRepository.listJobs(200), blogRepository.listAdmin(300), blogSourceRepository.list(), blogAutomationRepository.countStaleLeases(), blogAutomationRepository.getSettings(), blogAutomationRepository.getDispatcherState(),
  ]);
  const providerConfiguration = getGroqBlogConfiguration();
  const now = Date.now();
  const snapshot = {
    execution: 'Vercel server workflow',
    provider: 'Groq',
    structuredModel: providerConfiguration.structuredModel,
    writerModel: providerConfiguration.writerModel,
    providerStatus: !settings.provider_enabled || !providerConfiguration.enabled ? 'disabled' : providerConfiguration.configured ? 'ready' : 'not_configured',
    lastDispatchAt: dispatcher?.last_dispatch_at || null,
    lastSuccessfulStageAt: dispatcher?.last_successful_stage_at || null,
    lastRecoveryAt: dispatcher?.last_recovery_at || null,
    recoveredJobs: Number(dispatcher?.recovered_jobs || 0),
    dispatcherErrorCode: String(dispatcher?.last_safe_error_code || ''),
    providerPauseUntil: dispatcher?.provider_pause_until || null,
    fixtureAvailable: getBlogFixtureConfiguration().enabled,
    activeJobs: jobs.filter((job) => !['published', 'ready_for_review', 'scheduled', 'skipped', 'failed', 'cancelled'].includes(job.state)).length,
    failedJobs: jobs.filter((job) => job.state === 'failed').length,
    staleLeases,
    sourceFailures: sources.filter((source) => Boolean(source.safeFailureCode)).length,
    staleSources: sources.filter((source) => source.enabled && (!source.lastSuccessfulFetch || now - new Date(source.lastSuccessfulFetch).getTime() > source.fetchFrequencyMinutes * 120_000)).length,
    imageFailures: posts.filter((post) => post.imageStatus === 'blocked').length,
    prerenderFailures: posts.filter((post) => post.prerenderStatus === 'blocked').length,
    sitemapReady: posts.filter((post) => post.status === 'published' && !post.robotsDirective.includes('noindex')).length,
    rssReady: posts.filter((post) => post.status === 'published' && !post.robotsDirective.includes('noindex')).length,
    databaseCompatible: true,
    migrationVersion: '015',
    checkedAt: new Date().toISOString(),
  };
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: { snapshot, jobs: jobs.slice(0, 40) } });
}));

apiRouter.post('/admin/blog/operations/action', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const action = String(req.body?.action || '');
  const targetId = String(req.body?.targetId || '');
  const reason = String(req.body?.reason || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (reason.length < 4) throw new ApiError('BLOG_OPERATION_REASON_REQUIRED', 'Provide a reason for this operation.', 400);
  let result: unknown;
  if (action === 'retry_job') result = await blogAutomationRepository.retryJob(targetId);
  else if (action === 'resume_job') {
    const job = await blogAutomationRepository.getJob(targetId);
    if (job?.executionTarget === 'vercel' && job.state === 'queued' && blogJobIsActive(job)) result = job;
  }
  else if (action === 'cancel_job') result = await blogAutomationRepository.cancelJob(targetId, reason);
  else if (action === 'recover_stale_job') result = await blogAutomationRepository.recoverJob(targetId);
  else if (action === 'pause_automation') result = await blogAutomationRepository.updateSettings({ enabled: false }, requester.userId);
  else if (action === 'pause_publication') result = await blogAutomationRepository.updateSettings({ pause_all_publication: true }, requester.userId);
  else if (action === 'validate_sitemap') result = { valid: (await renderBlogSitemap(canonicalSiteOrigin())).includes('<urlset') };
  else if (action === 'validate_rss') result = { valid: (await renderBlogRss(canonicalSiteOrigin())).includes('<rss') };
  else if (action === 'reset_fixture_data') {
    requireBlogFixtureProvider();
    const client = requireSupabaseAdminClient();
    const { data: fixtureJobs, error: readError } = await client.from('blog_generation_jobs').select('id').eq('provider', BLOG_FIXTURE_PROVIDER).limit(500);
    if (readError) throw readError;
    const ids = (fixtureJobs || []).map((job) => job.id);
    if (ids.length) {
      const { error: postError } = await client.from('blog_posts').delete().in('generation_job_id', ids);
      if (postError) throw postError;
      const { error: jobError } = await client.from('blog_generation_jobs').delete().in('id', ids);
      if (jobError) throw jobError;
    }
    result = { deletedFixtureJobs: ids.length };
  } else throw new ApiError('BLOG_OPERATION_INVALID', 'Choose a supported protected operation.', 400);
  if (!result) throw new ApiError('BLOG_OPERATION_NOT_APPLICABLE', 'The operation is not applicable to the selected item.', 409);
  await logBlogAction(requester.userId, `blog_operation_${action}`, targetId || 'blog', { reason });
  if (['retry_job', 'resume_job', 'recover_stale_job'].includes(action)) requestImmediateBlogDispatch(req, targetId);
  res.json({ success: true, data: { result } });
}));

apiRouter.post('/admin/blog/jobs', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const mode = String(req.body?.mode || 'manual');
  if (!['manual', 'custom_headline', 'discover', 'one_click', 'one_click_source', 'fixture'].includes(mode)) throw new ApiError('BLOG_JOB_MODE_INVALID', 'Choose a supported blog job type.', 400);
  if (mode === 'fixture') requireBlogFixtureProvider();
  if (mode !== 'fixture') {
    const runtime = blogRuntimeReadiness(await blogAutomationRepository.getSettings());
    if (!runtime.generationAllowed) {
      const blocker = runtime.blockers[0];
      throw new ApiError(blocker.code, `${blocker.message} ${blocker.action}`, 409);
    }
  }
  const origin = mode === 'custom_headline'
    ? 'admin_custom_headline'
    : mode === 'one_click' || mode === 'one_click_source'
      ? 'trend_autopilot'
      : mode === 'discover'
        ? 'autopilot'
        : 'admin_manual';
  const topic = String(req.body?.topic || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  const headline = String(req.body?.headline || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  const suppliedSourceUrls = Array.isArray(req.body?.sourceUrls) ? req.body.sourceUrls.slice(0, 12).map(String) : [];
  if (mode === 'one_click_source') {
    if (suppliedSourceUrls.length !== 1) throw new ApiError('BLOG_SOURCE_REQUIRED', 'Paste one public source URL.', 400);
    suppliedSourceUrls[0] = requestedBlogSourceUrl(suppliedSourceUrls[0]);
  }
  if (!['discover', 'one_click', 'one_click_source'].includes(mode) && (mode === 'custom_headline' ? headline.length < 8 : topic.length < 5)) throw new ApiError('BLOG_JOB_INPUT_REQUIRED', mode === 'custom_headline' ? 'Enter a specific headline.' : 'Enter a specific topic.', 400);
  if (mode === 'custom_headline') {
    const duplicate = (await blogRepository.listAdmin(200)).find((post) => post.title.toLowerCase() === headline.toLowerCase());
    if (duplicate && req.body?.allowDuplicate !== true) throw new ApiError('DUPLICATE_BLOG_HEADLINE', `A post already uses this headline: ${duplicate.title}`, 409);
  }
  const current = new Date();
  const dateBucket = mode === 'discover' || mode === 'one_click' || mode === 'one_click_source'
    ? current.toISOString().slice(0, 13)
    : `${current.toISOString().slice(0, 13)}:${Math.floor(current.getUTCMinutes() / 10)}`;
  const job = await blogAutomationRepository.createJob({
    origin,
    topic,
    customHeadline: headline,
    requestedBy: requester.userId,
    provider: mode === 'fixture' ? BLOG_FIXTURE_PROVIDER : 'groq',
    model: mode === 'fixture' ? BLOG_FIXTURE_MODEL : GROQ_DEFAULT_STRUCTURED_MODEL,
    payload: {
      jobType: mode === 'discover' ? 'discover_trends' : mode === 'one_click' ? 'one_click_trend' : mode === 'one_click_source' ? 'one_click_source' : 'generate_article',
      manualDiscovery: mode === 'discover',
      publishWhenReady: mode === 'one_click' || mode === 'one_click_source',
      audience: String(req.body?.audience || '').slice(0, 240),
      keywords: String(req.body?.keywords || '').slice(0, 300),
      feedUrls: Array.isArray(req.body?.feedUrls) ? req.body.feedUrls.slice(0, 20) : undefined,
      sources: Array.isArray(req.body?.sources) ? req.body.sources.slice(0, 12) : undefined,
      sourceUrls: suppliedSourceUrls.length ? suppliedSourceUrls : undefined,
      competitorUrls: Array.isArray(req.body?.competitorUrls) ? req.body.competitorUrls.slice(0, 5).map(String) : undefined,
      articleType: normalizeBlogArticleType(req.body?.articleType, ['discover', 'one_click', 'one_click_source'].includes(mode) ? 'news_analysis' : 'evergreen_guide'),
      lengthMode: ['automatic', 'brief', 'standard', 'detailed', 'custom'].includes(String(req.body?.lengthMode)) ? String(req.body.lengthMode) : 'automatic',
      customMinimum: Math.max(500, Math.min(3500, Number(req.body?.customMinimum) || 0)),
      customMaximum: Math.max(500, Math.min(4000, Number(req.body?.customMaximum) || 0)),
      fixtureScenario: mode === 'fixture' && ['evergreen', 'news', 'invalid', 'timeout', 'malformed', 'originality_failure', 'missing_sources', 'image_failure'].includes(String(req.body?.fixtureScenario)) ? String(req.body.fixtureScenario) : undefined,
    },
    idempotencyKey: blogJobIdempotencyKey({ origin, topic: mode === 'one_click_source' ? suppliedSourceUrls[0] : topic, customHeadline: headline, dateBucket }),
  });
  await logBlogAction(requester.userId, 'queue_blog_job', job.id, { origin, mode, batchId: null });
  requestImmediateBlogDispatch(req, job.id);
  res.status(202).json({ success: true, data: { jobId: job.id, status: 'queued', job } });
}));

apiRouter.get('/admin/blog/jobs/:id', asyncJsonRoute(async (req, res) => {
  if (!(await requireAdminRequester(req, res))) return;
  const job = await blogAutomationRepository.getJob(req.params.id);
  if (!job) throw new ApiError('BLOG_JOB_NOT_FOUND', 'Blog job not found.', 404);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: { job } });
}));

apiRouter.post('/admin/blog/jobs/:id/cancel', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const reason = String(req.body?.reason || '').trim().slice(0, 500);
  if (reason.length < 4) throw new ApiError('BLOG_OPERATION_REASON_REQUIRED', 'Provide a reason for cancelling this job.', 400);
  const job = await blogAutomationRepository.cancelJob(req.params.id, reason);
  if (!job) throw new ApiError('BLOG_JOB_NOT_CANCELLABLE', 'This job cannot be cancelled.', 409);
  await logBlogAction(requester.userId, 'cancel_blog_job', job.id, { reason });
  res.json({ success: true, data: { job } });
}));

apiRouter.post('/admin/blog/jobs/:id/process', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const existing = await blogAutomationRepository.getJob(req.params.id);
  if (!existing || existing.executionTarget !== 'vercel') throw new ApiError('BLOG_JOB_NOT_PROCESSABLE', 'This Vercel blog job is not available.', 409);
  const data = await dispatchVercelBlogStages({ requestedJobId: existing.id, maxStages: 1 });
  await logBlogAction(requester.userId, 'process_blog_job_stage', existing.id, { processedStages: data.processedStages });
  res.json({ success: true, data });
}));

apiRouter.post('/admin/blog/jobs/:id/retry', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const job = await blogAutomationRepository.retryJob(req.params.id);
  if (!job) throw new ApiError('BLOG_JOB_NOT_RETRYABLE', 'This job is not in a retryable state.', 409);
  await logBlogAction(requester.userId, 'retry_blog_job', job.id, { provider: job.provider, model: job.model });
  requestImmediateBlogDispatch(req, job.id);
  res.status(202).json({ success: true, data: { job } });
}));

apiRouter.post('/admin/blog/batches', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const batchInput = validateManualBatch({ headlines: req.body?.headlines, count: req.body?.count, maximumCost: req.body?.maximumCost });
  if (!batchInput.headlines.length) throw new ApiError('BATCH_HEADLINES_REQUIRED', 'Provide one to five distinct headlines.', 400);
  const recentJobs = await blogAutomationRepository.listJobs(200);
  const recentCutoff = Date.now() - 10 * 60 * 1000;
  const duplicateJob = recentJobs.find((job) => job.origin === 'admin_batch' && new Date(job.createdAt).getTime() >= recentCutoff && batchInput.headlines.some((headline) => headline.toLowerCase() === job.customHeadline.toLowerCase()));
  if (duplicateJob) throw new ApiError('DUPLICATE_BLOG_BATCH', 'A recent batch already contains one of these headlines.', 409);
  const batch = await blogAutomationRepository.createBatch({ createdBy: requester.userId, count: batchInput.count, settings: { audience: req.body?.audience || '', keywords: req.body?.keywords || '', sourceUrls: req.body?.sourceUrls || [], competitorUrls: req.body?.competitorUrls || [] }, maximumCost: req.body?.maximumCost });
  const jobs = [];
  for (const headline of batchInput.headlines) {
    jobs.push(await blogAutomationRepository.createJob({
      origin: 'admin_batch', customHeadline: headline, requestedBy: requester.userId, batchId: batch.id,
      payload: { jobType: 'generate_article', audience: String(req.body?.audience || '').slice(0, 240), keywords: String(req.body?.keywords || '').slice(0, 300), sourceUrls: Array.isArray(req.body?.sourceUrls) ? req.body.sourceUrls.slice(0, 12).map(String) : [], competitorUrls: Array.isArray(req.body?.competitorUrls) ? req.body.competitorUrls.slice(0, 5).map(String) : [], articleType: normalizeBlogArticleType(req.body?.articleType), lengthMode: ['automatic', 'brief', 'standard', 'detailed', 'custom'].includes(String(req.body?.lengthMode)) ? String(req.body.lengthMode) : 'automatic', customMinimum: Number(req.body?.customMinimum || 0), customMaximum: Number(req.body?.customMaximum || 0) },
      idempotencyKey: blogJobIdempotencyKey({ origin: 'admin_batch', customHeadline: headline, batchId: batch.id }),
    }));
  }
  await logBlogAction(requester.userId, 'queue_blog_batch', batch.id, { count: jobs.length });
  if (jobs[0]) requestImmediateBlogDispatch(req, jobs[0].id);
  res.status(202).json({ success: true, data: { batch, jobs } });
}));

apiRouter.post('/admin/blog/images/import', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const { importBlogImage } = await import('../lib/blog/images');
  const image = await importBlogImage(req.body || {});
  await logBlogAction(requester.userId, 'import_blog_image', String((image as any).id), { articleId: req.body?.articleId || null, sourceUrl: (image as any).source_url });
  res.status(201).json({ success: true, data: { image } });
}));

apiRouter.post('/admin/blog/posts', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  try {
    const row = prepareBlogPostForStorage(req.body || {});
    row.slug = await uniqueBlogSlug(row.slug);
    const post = await blogRepository.create({ ...row, author_id: requester.userId, updated_by: requester.userId });
    await blogRepository.syncEditorialRecords(post, requester.userId, '');
    await logBlogAction(requester.userId, 'create_blog_post', post.id, { status: post.status, slug: post.slug });
    res.status(201).json({ success: true, data: { post } });
  } catch (error) {
    if (error instanceof BlogValidationError) return res.status(error.status).json({ success: false, error: error.message });
    throw error;
  }
}));

apiRouter.put('/admin/blog/posts/:id', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const existing = await blogRepository.getAdminById(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'Article not found.' });
  const expectedUpdatedAt = String(req.body?.expectedUpdatedAt || '').trim();
  if (expectedUpdatedAt && Date.parse(expectedUpdatedAt) !== Date.parse(existing.updatedAt)) {
    throw new ApiError('BLOG_POST_EDIT_CONFLICT', 'This article changed after you opened it. Reload the latest version before saving.', 409);
  }
  try {
    const row = prepareBlogPostForStorage(req.body || {});
    row.slug = await uniqueBlogSlug(row.slug, existing.id);
    const post = await blogRepository.update(existing.id, { ...row, generation_job_id: existing.generationJobId, batch_id: existing.batchId, updated_by: requester.userId }, existing.updatedAt);
    if (post) await blogRepository.syncEditorialRecords(post, requester.userId, existing.status);
    await logBlogAction(requester.userId, 'update_blog_post', existing.id, { status: post?.status, slug: post?.slug });
    res.json({ success: true, data: { post } });
  } catch (error) {
    if (error instanceof BlogValidationError) return res.status(error.status).json({ success: false, error: error.message });
    throw error;
  }
}));

apiRouter.get('/admin/blog/posts/:id/generation-review', createRateLimiter({ namespace: 'blog-generation-review', windowMs: 60 * 60 * 1000, maxRequests: 120 }), asyncJsonRoute(async (req, res) => {
  if (!(await requireAdminRequester(req, res))) return;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) throw new ApiError('BLOG_POST_ID_INVALID', 'Choose an existing article.', 400);
  const post = await blogRepository.getAdminById(req.params.id);
  if (!post) throw new ApiError('BLOG_POST_NOT_FOUND', 'Article not found.', 404);
  const job = post.generationJobId ? await blogAutomationRepository.getJob(post.generationJobId) : null;
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: { review: projectBlogGenerationReview(job?.stageOutputs?.claimValidation) } });
}));

apiRouter.post('/admin/blog/posts/:id/workflow', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const existing = await blogRepository.getAdminById(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'Article not found.' });
  const action = String(req.body?.action || '');
  const reason = String(req.body?.reason || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (reason.length < 4) throw new ApiError('BLOG_WORKFLOW_REASON_REQUIRED', 'Provide a short reason for this workflow change.', 400);
  let post;
  if (action === 'hold' || action === 'cancel') {
    post = await blogRepository.update(existing.id, { status: action === 'hold' ? 'needs_review' : 'draft', scheduled_at: null, published_at: null, robots_directive: 'noindex,nofollow', publication_reason: reason, reviewer_id: requester.userId, updated_by: requester.userId }, existing.updatedAt);
  } else if (action === 'convert_manual') {
    post = await blogRepository.update(existing.id, { origin: 'scheduled_manual', publication_reason: reason, updated_by: requester.userId }, existing.updatedAt);
  } else if (action === 'publish_now' || action === 'reschedule' || action === 'unschedule' || action === 'reset_recommended_time') {
    const settings = await blogAutomationRepository.getSettings();
    const posts = await blogRepository.listAdmin(200);
    const requestedTime = action === 'reset_recommended_time' ? existing.recommendedPublicationAt : action === 'reschedule' ? String(req.body?.scheduledAt || '') : null;
    if ((action === 'reschedule' || action === 'reset_recommended_time') && !requestedTime) throw new ApiError('BLOG_SCHEDULE_REQUIRED', 'Choose a publication time.', 400);
    if (action === 'reschedule' || action === 'reset_recommended_time') {
      if (req.body?.scheduleVersion != null && Number(req.body.scheduleVersion) !== existing.scheduleVersion) throw new ApiError('BLOG_SCHEDULE_CONFLICT', 'This article schedule changed in another session. Refresh before moving it.', 409);
      const validation = validateCalendarMove({ scheduledAt: requestedTime, timezone: String(settings.timezone || 'UTC'), existingPublicationTimes: posts.filter((item) => item.id !== existing.id).map((item) => item.scheduledAt || item.publishedAt).filter(Boolean) as string[], minimumSpacingMinutes: Number(settings.minimum_spacing_minutes || 180), maximumPostsPerDay: Number(settings.maximum_posts_per_day || 2), blackoutWeekdays: settings.blackout_weekdays || [], blackoutDates: settings.blackout_dates || [] });
      if (!validation.valid) throw new ApiError('BLOG_SCHEDULE_CONFLICT', validation.conflicts.join(' '), 409);
    }
    if (action === 'unschedule') {
      post = await blogRepository.update(existing.id, { status: 'draft', scheduled_at: null, robots_directive: 'noindex,nofollow', publication_reason: reason, schedule_version: existing.scheduleVersion + 1, reviewer_id: requester.userId, updated_by: requester.userId }, existing.updatedAt);
    } else {
      const row = prepareBlogPostForStorage({ ...existing, status: action === 'publish_now' ? 'published' : 'scheduled', publishedAt: action === 'publish_now' ? new Date().toISOString() : null, scheduledAt: requestedTime, publicationReason: reason, publicationRule: action === 'reset_recommended_time' ? 'administrator_reset_to_recommendation' : action === 'reschedule' ? 'administrator_calendar_move' : 'administrator_publish_now', scheduleVersion: existing.scheduleVersion + 1 });
      post = await blogRepository.update(existing.id, { ...row, reviewer_id: requester.userId, updated_by: requester.userId }, existing.updatedAt);
    }
  } else {
    throw new ApiError('UNSUPPORTED_BLOG_WORKFLOW_ACTION', 'This content workflow action is not supported.', 400);
  }
  if (!post) return res.status(404).json({ success: false, error: 'Article not found.' });
  await blogRepository.syncEditorialRecords(post, requester.userId, existing.status);
  if ((existing.origin === 'autopilot' || existing.origin === 'trend_autopilot') && existing.status === 'needs_review' && (action === 'publish_now' || action === 'cancel')) await blogAutomationRepository.recordAutomaticReview(action === 'publish_now');
  await logBlogAction(requester.userId, `blog_workflow_${action}`, post.id, { previousState: existing.status, newState: post.status, reason });
  if (action === 'publish_now' && post.status === 'published') void notifyIndexNow([`/blog/${post.slug}`, '/blog', '/sitemap.xml', '/rss.xml']).catch(() => undefined);
  res.json({ success: true, data: { post } });
}));

apiRouter.get('/admin/blog/posts/:id/section-revisions', asyncJsonRoute(async (req, res) => {
  if (!(await requireAdminRequester(req, res))) return;
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: { revisions: await blogRepository.listSectionRevisions(req.params.id) } });
}));

apiRouter.post('/admin/blog/posts/:id/section-regeneration', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const existing = await blogRepository.getAdminById(req.params.id);
  if (!existing) throw new ApiError('BLOG_POST_NOT_FOUND', 'Article not found.', 404);
  const sectionKey = String(req.body?.sectionKey || '').slice(0, 120);
  const sectionAction = String(req.body?.action || 'regenerate');
  if (!sectionKey || !['regenerate', 'shorten', 'make_practical', 'add_example', 'improve_clarity', 'remove_repetition', 'rewrite_from_sources'].includes(sectionAction)) throw new ApiError('BLOG_SECTION_INPUT_INVALID', 'Choose a valid section and editing action.', 400);
  const useFixture = req.body?.useFixture === true;
  if (useFixture) {
    requireBlogFixtureProvider();
    if (!existing.fixtureTest) throw new ApiError('BLOG_FIXTURE_ARTICLE_REQUIRED', 'Fixture section revisions are limited to private fixture test drafts.', 400);
  }
  const idempotencyKey = blogJobIdempotencyKey({ origin: 'editor_update', topic: `${existing.id}:${sectionKey}:${sectionAction}:${useFixture ? 'fixture' : 'groq'}`, dateBucket: String(existing.updatedAt) });
  const job = await blogAutomationRepository.createJob({ origin: 'editor_update', topic: existing.title, requestedBy: requester.userId, provider: useFixture ? BLOG_FIXTURE_PROVIDER : 'groq', model: useFixture ? BLOG_FIXTURE_MODEL : GROQ_DEFAULT_WRITER_MODEL, initialStage: 'section_drafting', payload: { jobType: 'regenerate_section', articleId: existing.id, sectionKey, sectionAction, fixture: useFixture }, idempotencyKey });
  await logBlogAction(requester.userId, 'queue_blog_section_regeneration', existing.id, { jobId: job.id, sectionKey, sectionAction, provider: useFixture ? BLOG_FIXTURE_PROVIDER : 'groq' });
  requestImmediateBlogDispatch(req, job.id);
  res.status(202).json({ success: true, data: { jobId: job.id, status: 'queued', job } });
}));

apiRouter.post('/admin/blog/section-revisions/:id/decision', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const decision = String(req.body?.decision || '');
  if (decision !== 'accepted' && decision !== 'rejected') throw new ApiError('BLOG_REVISION_DECISION_INVALID', 'Choose Accept or Reject.', 400);
  const revision = await blogRepository.decideSectionRevision(req.params.id, decision, requester.userId);
  if (!revision) throw new ApiError('BLOG_REVISION_NOT_FOUND', 'Pending section revision not found.', 404);
  await logBlogAction(requester.userId, `blog_section_revision_${decision}`, revision.article_id, { revisionId: revision.id });
  res.json({ success: true, data: { revision } });
}));

apiRouter.delete('/admin/blog/posts/:id', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const post = await blogRepository.update(req.params.id, { status: 'archived', updated_by: requester.userId });
  if (!post) return res.status(404).json({ success: false, error: 'Article not found.' });
  await logBlogAction(requester.userId, 'archive_blog_post', post.id, { slug: post.slug });
  res.json({ success: true, data: { post } });
}));
