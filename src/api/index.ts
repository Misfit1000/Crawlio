import { createHash, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { normalizeDomainInput, normalizeUserUrl } from '../lib/seo/url-utils';
import { isCompletedAuditStatus } from '../lib/audit/audit-time';
import { generateKeywords } from '../lib/keywords/generator';
import { clusterKeywords } from '../lib/keywords/clustering';
import { buildContentBrief } from '../lib/keywords/content-brief';
import { auditRepository } from '../lib/supabase/audit-repository';
import { isSupabaseAdminEnabled, requireSupabaseAdminClient } from '../lib/supabase/server';
import { getAuditModeConfig, type AuditMode } from '../lib/audit/resource-types';
import {
  EntitlementError,
  canStartAudit,
  consumeAuditQuota,
  ensureUserProfileFromAuthUser,
  getAuthenticatedUserFromRequest,
  getPlanLimits,
} from '../lib/billing/entitlements';
import type { ResourceAuditDocument } from '../lib/audit/resource-types';
import { getAuditProfileForDocument } from '../lib/audit/audit-profiles';
import { createRateLimiter } from '../lib/api/http-hardening';
import { blogRepository, mapBlogPostRow } from '../lib/blog/repository';
import { normalizeBlogSlug } from '../lib/blog/slug';
import { BlogValidationError, prepareBlogPost } from '../lib/blog/validation';
import { canonicalSiteOrigin, renderBlogNewsSitemap, renderBlogRss, renderBlogSitemap } from '../lib/blog/sitemap';
import { renderBlogArticleHtml } from '../lib/blog/render';
import { blogAutomationRepository } from '../lib/blog/automation-repository';
import { blogJobIdempotencyKey, validateManualBatch } from '../lib/blog/automation';
import { importBlogImage } from '../lib/blog/images';
import { getGroqBlogConfiguration, getSafeGroqDiagnostics, GROQ_DEFAULT_STRUCTURED_MODEL, GROQ_DEFAULT_WRITER_MODEL, testGroqProvider } from '../lib/blog/server/groq';
import { dispatchVercelBlogStages, getVercelBlogRuntimeInfo, recoverAndDispatchVercelBlogWork } from '../lib/blog/server/vercel-workflow';
import { normalizeBlogArticleType } from '../lib/blog/length-policy';
import { validateCalendarMove } from '../lib/blog/freshness';
import { BLOG_FIXTURE_MODEL, BLOG_FIXTURE_PROVIDER, getBlogFixtureConfiguration, requireBlogFixtureProvider } from '../lib/blog/fixture-provider';
import { blogSourceRepository } from '../lib/blog/source-management';
import { ApiError } from '../lib/api/errors';
import {
  admitAuditSubmission,
  assertAuditDeploymentCompatible,
  durableRateLimit,
  getDeploymentCompatibility,
  releaseAuditAdmission,
  requestNetworkHash,
  verifyBotToken,
} from '../lib/api/production-controls';
import { publicVersionPayload } from '../lib/platform/version';
import { buildPublicAuditExport, csvRow } from '../lib/report/export';
import { BRAND } from '../lib/brand';
import { buildOperationalHealth, maybeSendOperationalAlert } from '../lib/operations/health';
import { getPublicLinkSignals } from '../lib/backlinks/public-link-signals';
import {
  findingWorkflowKey,
  isFindingPriorityOverride,
  isFindingWorkflowStatus,
} from '../lib/audit/finding-workflow';
import {
  captureAdminSentryTestEvent,
  flushNodeMonitoring,
} from '../lib/monitoring/sentry-node';
import { resolveSentryBuildConfiguration } from '../lib/monitoring/sentry-build';
import { adminControlCenterRouter } from './admin/control-center';
import { getUserActionGuard } from '../lib/admin/control-center';
import { invalidateAdminReadCache } from '../lib/admin/read-cache';

const DUPLICATE_AUDIT_WINDOW_MS = 10 * 60 * 1000;

function asyncJsonRoute(handler: any) {
  return async (req: any, res: any, next: any) => {
    try {
      await handler(req, res, next);
    } catch (error: unknown) {
      next(error);
    }
  };
}

export const apiRouter = Router();

apiRouter.use('/admin', durableRateLimit({ namespace: 'admin-api', limit: 120, windowSeconds: 60 }));
apiRouter.use('/admin/diagnostics/sentry-test', durableRateLimit({ namespace: 'sentry-test', limit: 3, windowSeconds: 3600 }));
apiRouter.use('/admin/blog/jobs', durableRateLimit({ namespace: 'blog-jobs', limit: 20, windowSeconds: 3600 }));
apiRouter.use('/admin/blog/batches', durableRateLimit({ namespace: 'blog-batches', limit: 5, windowSeconds: 3600 }));
apiRouter.use('/admin/blog/images/import', durableRateLimit({ namespace: 'blog-images', limit: 10, windowSeconds: 3600 }));
apiRouter.use('/admin/blog/provider/test', durableRateLimit({ namespace: 'blog-provider-test', limit: 5, windowSeconds: 3600 }));
apiRouter.use('/admin/blog/sources', durableRateLimit({ namespace: 'blog-sources', limit: 40, windowSeconds: 3600 }));
apiRouter.use('/admin/blog/operations/action', durableRateLimit({ namespace: 'blog-operations', limit: 20, windowSeconds: 3600 }));
apiRouter.use('/admin/blog/sections', durableRateLimit({ namespace: 'blog-section-regeneration', limit: 10, windowSeconds: 3600 }));
apiRouter.use('/blog/scheduler', durableRateLimit({ namespace: 'blog-scheduler', limit: 10, windowSeconds: 300 }));
apiRouter.use('/audit/export', durableRateLimit({ namespace: 'report-export', limit: 10, windowSeconds: 300 }));
apiRouter.use('/audit/cancel', durableRateLimit({ namespace: 'audit-cancel', limit: 10, windowSeconds: 300 }));
apiRouter.use('/domain/link-signals', createRateLimiter({ namespace: 'public-link-signals', windowMs: 60 * 60 * 1000, maxRequests: 20 }));
apiRouter.use('/admin/control-center', adminControlCenterRouter);
apiRouter.use('/admin/blog', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 400) invalidateAdminReadCache('content-health');
    });
  }
  next();
});

function firstHeaderValue(value: unknown) {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function hashGuestValue(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function schedulerRequestAllowed(req: any) {
  const expected = String(process.env.BLOG_DISPATCH_SECRET || process.env.BLOG_CRON_SECRET || process.env.BLOG_SCHEDULER_SECRET || process.env.CRON_SECRET || '');
  const supplied = firstHeaderValue(req.headers?.authorization).replace(/^Bearer\s+/i, '') || firstHeaderValue(req.headers?.['x-blog-scheduler-secret']);
  if (expected.length < 24 || supplied.length < 24) return false;
  return timingSafeEqual(createHash('sha256').update(expected).digest(), createHash('sha256').update(supplied).digest());
}

function requestOrigin(req: any) {
  const configured = [
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '',
    process.env.APP_URL || '',
    process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '',
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

function requestImmediateBlogDispatch(req: any, jobId: string, chainDepth = 0) {
  const secret = String(process.env.BLOG_DISPATCH_SECRET || '');
  const origin = requestOrigin(req);
  if (!origin || secret.length < 24 || process.env.NODE_ENV === 'test') return;
  void fetch(`${origin}/api/tools/blog/jobs/dispatch`, {
    method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, maxStages: 3, chainDepth }), signal: AbortSignal.timeout(8_000),
  }).catch(() => undefined);
}

function getCookieValue(req: any, name: string) {
  if (req.cookies?.[name]) return String(req.cookies[name]);
  const cookieHeader = firstHeaderValue(req.headers?.cookie);
  const match = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

function guestIdentityForRequest(req: any) {
  const explicitGuestId = firstHeaderValue(req.headers?.['x-crawlio-guest-id'])
    || firstHeaderValue(req.headers?.['x-seointel-guest-id'])
    || getCookieValue(req, 'crawlio_guest_id')
    || getCookieValue(req, 'seointel_guest_id');
  if (explicitGuestId) {
    const guestKeyHash = hashGuestValue(`guest-session:${explicitGuestId.slice(0, 128)}`);
    return { guestKey: `guest:${guestKeyHash}`, guestKeyHash };
  }

  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const userAgent = firstHeaderValue(req.headers?.['user-agent']).slice(0, 256);
  const fallback = `${forwarded || req.ip || req.socket?.remoteAddress || 'unknown'}|${userAgent}`;
  const guestKeyHash = hashGuestValue(`guest-network:${fallback}`);
  return { guestKey: `guest:${guestKeyHash}`, guestKeyHash };
}

function isDeepAuditEnabled() {
  return process.env.DEEP_AUDIT_ENABLED === 'true';
}

async function getRequester(req: any) {
  const authUser = await getAuthenticatedUserFromRequest(req);
  if (!authUser) return { userId: null, profile: null };
  req.requesterUserId = authUser.id;
  const profile = await ensureUserProfileFromAuthUser(authUser);
  if (profile.disabled) {
    throw new ApiError('ACCOUNT_SUSPENDED', 'This account is suspended.', 403);
  }
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

async function canAccessAudit(req: any, audit: ResourceAuditDocument) {
  const requester = await getRequester(req);
  if (requester.profile?.role === 'admin') return true;
  if (audit.userId) return requester.userId === audit.userId;
  if (audit.guestKeyHash) return guestIdentityForRequest(req).guestKeyHash === audit.guestKeyHash;
  return false;
}

function workflowRow(row: any) {
  return {
    id: row.id,
    auditId: row.audit_id,
    findingId: row.finding_id ?? null,
    findingKey: row.finding_key,
    status: row.status,
    priorityOverride: row.priority_override ?? null,
    notes: row.notes || '',
    dueAt: row.due_at ?? null,
    resolvedAt: row.resolved_at ?? null,
    resolvedBy: row.resolved_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    version: Number(row.version || 1),
  };
}

async function requireWorkflowAudit(req: any, res: any) {
  const requester = await getRequester(req);
  if (!requester.userId) {
    res.status(401).json({ success: false, error: 'Sign in to persist finding workflow.' });
    return null;
  }
  const audit = await auditRepository.getAuditJob(String(req.params.id || ''));
  const ownsAudit = audit?.userId === requester.userId;
  if (!audit || (!ownsAudit && requester.profile?.role !== 'admin')) {
    res.status(404).json({ success: false, error: 'Audit not found.' });
    return null;
  }
  if (!audit.userId) {
    res.status(403).json({ success: false, error: 'Guest finding workflow is stored on this device. Sign in before starting an audit to sync it.' });
    return null;
  }
  return { audit, requester };
}

function sendEntitlementError(res: any, error: unknown) {
  if (error instanceof EntitlementError) {
    throw new ApiError(error.upgradeRequired ? 'PLAN_LIMIT_REACHED' : 'AUDIT_LIMIT_REACHED', error.message, error.status);
  }
  throw error;
}

function admissionError(decision: { code: string; retryAfterSeconds?: number }) {
  const retryAfterSeconds = Math.max(1, Number(decision.retryAfterSeconds || 60));
  const mapping: Record<string, [string, string, number]> = {
    DAILY_QUOTA_REACHED: ['DAILY_QUOTA_REACHED', 'You have reached today\'s audit limit.', 429],
    DOMAIN_DAILY_LIMIT: ['DOMAIN_DAILY_LIMIT', 'This website has reached its audit limit for today.', 429],
    QUEUE_FULL: ['AUDIT_QUEUE_FULL', 'The audit queue is currently full. Please try again later.', 429],
    MAINTENANCE: ['AUDIT_MAINTENANCE', 'The audit service is temporarily unavailable for maintenance.', 503],
    FREE_SUBMISSIONS_PAUSED: ['FREE_AUDITS_PAUSED', 'New Free audits are temporarily paused.', 503],
    BOT_VERIFICATION_REQUIRED: ['BOT_VERIFICATION_REQUIRED', 'Please complete the verification check before starting another audit.', 403],
    GUEST_AUDITS_DISABLED: ['GUEST_AUDITS_DISABLED', 'Guest audits are temporarily unavailable. Sign in and try again.', 403],
    AUDIT_MODE_DISABLED: ['AUDIT_MODE_DISABLED', 'This audit type is temporarily unavailable.', 503],
    ACTIVE_AUDIT_EXISTS: ['ACTIVE_AUDIT_EXISTS', 'You already have an audit in progress.', 429],
  };
  const [code, message, status] = mapping[decision.code] || ['AUDIT_ADMISSION_DENIED', 'The audit could not be admitted right now.', 429];
  return new ApiError(code, message, status, { retryAfterSeconds });
}

function auditStartResponseData(audit: ResourceAuditDocument, extras: Record<string, unknown> = {}) {
  return {
    auditId: audit.id,
    status: audit.status,
    submittedInput: audit.submittedInput,
    normalizedUrl: audit.normalizedUrl,
    hostname: audit.hostname,
    requestedMode: audit.requestedMode,
    effectiveMode: audit.effectiveMode,
    plan: audit.plan,
    pageLimit: audit.pageLimit,
    queuePriority: audit.queuePriority,
    ...extras,
  };
}

apiRouter.get('/me/profile', asyncJsonRoute(async (req, res) => {
  const authUser = await getAuthenticatedUserFromRequest(req);
  if (!authUser) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  const profile = await ensureUserProfileFromAuthUser(authUser);
  if (profile.disabled) throw new ApiError('ACCOUNT_SUSPENDED', 'This account is suspended.', 403);
  const limits = await getPlanLimits(profile.plan);
  res.json({ success: true, data: { profile, limits } });
}));

apiRouter.get('/me/export', asyncJsonRoute(async (req, res) => {
  const requester = await getRequester(req);
  if (!requester.userId) throw new ApiError('AUTHENTICATION_REQUIRED', 'Authentication is required.', 401);
  const client = requireSupabaseAdminClient();
  const [profile, audits, projects, keywords, competitors] = await Promise.all([
    client.from('user_profiles').select('id,email,full_name,display_name,plan,role,created_at,terms_accepted_at,privacy_accepted_at,legal_version').eq('id', requester.userId).maybeSingle(),
    client.from('audits').select('id,submitted_input,normalized_url,final_url,hostname,status,requested_mode,effective_mode,page_limit,warning_count,failure_counts,created_at,completed_at,archived_at').eq('user_id', requester.userId).order('created_at', { ascending: false }).limit(500),
    client.from('projects').select('id,name,description,created_at').eq('user_id', requester.userId).limit(500),
    client.from('keywords').select('id,term,project_id,group,intent,created_at').eq('user_id', requester.userId).limit(1000),
    client.from('competitors').select('id,domain_url,niche,created_at').eq('user_id', requester.userId).limit(500),
  ]);
  const firstError = [profile.error, audits.error, projects.error, keywords.error, competitors.error].find(Boolean);
  if (firstError) throw firstError;
  res.setHeader('Content-Disposition', 'attachment; filename="crawlio-account-export.json"');
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({
    exportedAt: new Date().toISOString(),
    profile: profile.data,
    audits: audits.data || [],
    projects: projects.data || [],
    keywords: keywords.data || [],
    competitors: competitors.data || [],
    storageNotice: `${BRAND.name} stores audit summaries and findings, not complete raw HTML.`,
  });
}));

apiRouter.post('/me/delete', durableRateLimit({ namespace: 'account-delete', limit: 3, windowSeconds: 3600 }), asyncJsonRoute(async (req, res) => {
  const authUser = await getAuthenticatedUserFromRequest(req);
  if (!authUser) throw new ApiError('AUTHENTICATION_REQUIRED', 'Authentication is required.', 401);
  req.requesterUserId = authUser.id;
  if (req.body?.confirmation !== 'DELETE') throw new ApiError('ACCOUNT_DELETE_CONFIRMATION_REQUIRED', 'Enter DELETE to confirm account deletion.', 400);
  const requester = await getRequester(req);
  if (requester.profile?.role === 'admin') throw new ApiError('ADMIN_TRANSFER_REQUIRED', 'Transfer or remove administrator access before deleting this account.', 409);
  const lastSignIn = new Date(authUser.last_sign_in_at || 0).getTime();
  if (!Number.isFinite(lastSignIn) || Date.now() - lastSignIn > 30 * 60 * 1000) {
    throw new ApiError('RECENT_LOGIN_REQUIRED', 'Sign in again before deleting your account.', 403);
  }
  const client = requireSupabaseAdminClient();
  const requestedAt = new Date().toISOString();
  await client.from('user_profiles').update({ deletion_requested_at: requestedAt }).eq('id', authUser.id);
  const { data: existingRequest, error: existingRequestError } = await client
    .from('account_deletion_requests')
    .select('id')
    .eq('user_id', authUser.id)
    .in('status', ['requested', 'processing'])
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingRequestError) throw existingRequestError;
  const requestResult = existingRequest
    ? await client.from('account_deletion_requests').update({
      status: 'processing',
      processing_started_at: requestedAt,
      failure_code: null,
      failure_message: null,
    }).eq('id', existingRequest.id).select('id').single()
    : await client.from('account_deletion_requests').insert({
      user_id: authUser.id,
      requester_email: authUser.email ?? null,
      status: 'processing',
      request_source: 'self_service',
      processing_started_at: requestedAt,
      requested_at: requestedAt,
    }).select('id').single();
  if (requestResult.error) throw requestResult.error;
  try {
    const { data, error } = await client.rpc('delete_user_owned_data', { p_user_id: authUser.id });
    if (error) throw error;
    const { error: authDeleteError } = await client.auth.admin.deleteUser(authUser.id);
    if (authDeleteError) throw authDeleteError;
    await client.from('account_deletion_requests').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    }).eq('id', requestResult.data.id);
    invalidateAdminReadCache('overview:', 'resources');
    res.setHeader('Clear-Site-Data', '"cache", "cookies", "storage"');
    res.json({ success: true, data });
  } catch (error) {
    await client.from('account_deletion_requests').update({
      status: 'failed',
      failure_code: 'SELF_SERVICE_DELETION_FAILED',
      failure_message: 'Automatic deletion could not finish. An administrator can safely retry this request.',
    }).eq('id', requestResult.data.id);
    throw error;
  }
}));

apiRouter.get('/version', asyncJsonRoute(async (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.json({ success: true, data: publicVersionPayload() });
}));

apiRouter.get('/admin/diagnostics', asyncJsonRoute(async (req, res) => {
  if (!(await requireAdminRequester(req, res))) return;
  const client = requireSupabaseAdminClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [compatibility, auditsResult, workersResult, plansResult, errorsResult, diagnosticsResult, actionsResult] = await Promise.all([
    getDeploymentCompatibility(),
    client.from('audits').select('id,status,created_at,started_at,completed_at,lease_expires_at,warning_count,failure_counts,pages_discovered,pages_crawled,used_http_fallback').gte('created_at', since).order('created_at', { ascending: false }).limit(500),
    client.from('platform_settings').select('key,value,updated_at').like('key', 'audit_worker:%').order('updated_at', { ascending: false }).limit(20),
    client.from('plan_limits').select('plan,label,max_pages_quick,max_pages_standard,max_pages_deep,allowed_modes').order('priority', { ascending: true }),
    client.from('api_error_logs').select('request_id,route,method,user_id,internal_code,internal_details,deployment_version,created_at').order('created_at', { ascending: false }).limit(50),
    client.from('audit_diagnostics').select('id,audit_id,affected_url,failure_code,phase,attempt_count,request_duration_ms,worker_id,internal_details,created_at').order('created_at', { ascending: false }).limit(100),
    client.from('admin_actions').select('*').order('created_at', { ascending: false }).limit(50),
  ]);
  const error = [auditsResult.error, workersResult.error, plansResult.error, errorsResult.error, diagnosticsResult.error, actionsResult.error].find(Boolean);
  if (error) throw error;
  const rows = auditsResult.data || [];
  const durations = rows.map((row: any) => row.started_at && row.completed_at ? new Date(row.completed_at).getTime() - new Date(row.started_at).getTime() : 0).filter((value) => value > 0);
  const waits = rows.map((row: any) => row.started_at ? new Date(row.started_at).getTime() - new Date(row.created_at).getTime() : 0).filter((value) => value >= 0);
  const failureGroups: Record<string, number> = {};
  rows.forEach((row: any) => Object.entries(row.failure_counts || {}).forEach(([code, count]) => { failureGroups[code] = (failureGroups[code] || 0) + Number(count || 0); }));
  const operations = buildOperationalHealth({ audits: rows, workers: workersResult.data || [], plans: plansResult.data || [], compatibility });
  const sentryBuild = resolveSentryBuildConfiguration(process.env, process.env.NODE_ENV || 'production');
  const workerSentryConfigured = (workersResult.data || []).some((row: any) => row.value?.sentryConfigured === true);
  void maybeSendOperationalAlert(operations, client).catch(() => undefined);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: {
    compatibility,
    operations,
    metrics: {
      queued: rows.filter((row: any) => row.status === 'queued').length,
      running: rows.filter((row: any) => row.status === 'running').length,
      completed: rows.filter((row: any) => row.status === 'completed').length,
      completedWithWarnings: rows.filter((row: any) => row.status === 'completed_with_warnings').length,
      failed: rows.filter((row: any) => row.status === 'failed').length,
      abandoned: rows.filter((row: any) => row.status === 'abandoned').length,
      staleLeases: rows.filter((row: any) => row.status === 'running' && row.lease_expires_at && new Date(row.lease_expires_at).getTime() < Date.now()).length,
      averageQueueWaitMs: waits.length ? Math.round(waits.reduce((sum, value) => sum + value, 0) / waits.length) : null,
      averageAuditDurationMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
      pageFailureRate: rows.reduce((sum: number, row: any) => sum + Object.values(row.failure_counts || {}).reduce<number>((inner, value) => inner + Number(value || 0), 0), 0) / Math.max(1, rows.reduce((sum: number, row: any) => sum + Number(row.pages_discovered || 0), 0)),
      failuresByCode: failureGroups,
      oldestQueuedAt: rows.filter((row: any) => row.status === 'queued').map((row: any) => row.created_at).sort()[0] || null,
    },
    workers: workersResult.data || [],
    recentApiErrors: errorsResult.data || [],
    recentAuditDiagnostics: diagnosticsResult.data || [],
    adminActions: actionsResult.data || [],
    usageAvailability: { databaseStorage: 'provider-dashboard-only', realtime: 'provider-dashboard-only' },
    monitoring: {
      browserConfigured: Boolean(process.env.VITE_SENTRY_DSN),
      apiConfigured: Boolean(process.env.SENTRY_DSN),
      workerConfigured: workerSentryConfigured,
      sourceMapsConfigured: sentryBuild.sourceMapsConfigured,
      environment: sentryBuild.environment,
    },
  }});
}));

apiRouter.post('/admin/diagnostics/sentry-test', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const initiated = captureAdminSentryTestEvent();
  if (initiated) await flushNodeMonitoring(1_500);
  const client = requireSupabaseAdminClient();
  await client.from('admin_actions').insert({
    admin_user_id: requester.userId,
    action: 'sentry_api_test',
    target_type: 'monitoring',
    target_id: 'crawlio-api',
    metadata: { initiated },
  });
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: { initiated, service: 'crawlio-api' } });
}));

apiRouter.post('/admin/audits/:id/action', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 4 || reason.length > 500) throw new ApiError('ADMIN_REASON_REQUIRED', 'Provide a reason between 4 and 500 characters.', 400);
  const action = String(req.body?.action || '');
  const audit = await auditRepository.getAudit(req.params.id);
  if (!audit) throw new ApiError('AUDIT_NOT_FOUND', 'Audit not found.', 404);
  const before = { status: audit.status, phase: audit.currentPhase, leaseExpiresAt: audit.leaseExpiresAt, queuePriority: audit.queuePriority };
  const patches: Record<string, Partial<ResourceAuditDocument>> = {
    cancel: { status: 'cancelled', currentPhase: 'Cancelled by administrator', cancelledAt: new Date().toISOString(), lockedBy: null, lockedAt: null, leaseExpiresAt: null },
    retry: { status: 'queued', currentPhase: 'Retry queued', error: null, progress: 0, lockedBy: null, lockedAt: null, leaseExpiresAt: null },
    requeue: { status: 'queued', currentPhase: 'Recovered and requeued', error: null, lockedBy: null, lockedAt: null, leaseExpiresAt: null },
    abandon: { status: 'abandoned', currentPhase: 'Marked abandoned', completedAt: new Date().toISOString(), lockedBy: null, lockedAt: null, leaseExpiresAt: null },
    priority: { queuePriority: Math.max(0, Math.min(1000, Math.floor(Number(req.body?.queuePriority || 0)))) },
  };
  const patch = patches[action];
  if (!patch) throw new ApiError('UNSUPPORTED_ADMIN_ACTION', 'This administrator action is not supported.', 400);
  if (action === 'retry' && !['failed', 'abandoned'].includes(audit.status)) throw new ApiError('AUDIT_NOT_RETRYABLE', 'Only failed or abandoned audits can be retried.', 409);
  if (action === 'cancel' && !['queued', 'running'].includes(audit.status)) throw new ApiError('AUDIT_NOT_CANCELLABLE', 'Only queued or running audits can be cancelled.', 409);
  if (action === 'abandon' && audit.status !== 'running') throw new ApiError('AUDIT_NOT_ABANDONABLE', 'Only a running audit can be marked abandoned.', 409);
  if (action === 'requeue' && !(audit.status === 'running' && (!audit.leaseExpiresAt || new Date(audit.leaseExpiresAt).getTime() < Date.now()))) throw new ApiError('AUDIT_NOT_STALE', 'Only a running audit with an expired lease can be requeued.', 409);
  if (action === 'priority' && (!Number.isFinite(Number(req.body?.queuePriority)) || !['queued', 'running'].includes(audit.status))) throw new ApiError('INVALID_QUEUE_PRIORITY', 'Queue priority can be changed only for an active audit.', 400);
  await auditRepository.updateAudit(audit.id, patch);
  const client = requireSupabaseAdminClient();
  await client.from('admin_actions').insert({ admin_user_id: requester.userId, action: `audit_${action}`, target_type: 'audit', target_id: audit.id, metadata: { reason, before, after: patch } });
  invalidateAdminReadCache('overview:', 'resources');
  res.json({ success: true, data: { auditId: audit.id, action, before, after: patch } });
}));

apiRouter.post('/admin/users/:id/reset-quota', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 4 || reason.length > 500) throw new ApiError('ADMIN_REASON_REQUIRED', 'Provide a reason between 4 and 500 characters.', 400);
  const client = requireSupabaseAdminClient();
  const { data: before, error: readError } = await client.from('user_profiles').select('audit_quota_used_daily,audit_quota_used_monthly').eq('id', req.params.id).maybeSingle();
  if (readError) throw readError;
  if (!before) throw new ApiError('USER_NOT_FOUND', 'User not found.', 404);
  const { error } = await client.from('user_profiles').update({ audit_quota_used_daily: 0, audit_quota_used_monthly: 0, updated_at: new Date().toISOString() }).eq('id', req.params.id);
  if (error) throw error;
  await client.from('admin_actions').insert({ admin_user_id: requester.userId, action: 'reset_user_quota', target_type: 'user', target_id: req.params.id, metadata: { reason, before, after: { daily: 0, monthly: 0 } } });
  res.json({ success: true, data: { userId: req.params.id, daily: 0, monthly: 0 } });
}));

apiRouter.post('/admin/users/:id/update', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 4 || reason.length > 500) throw new ApiError('ADMIN_REASON_REQUIRED', 'Provide a reason between 4 and 500 characters.', 400);
  const allowed: Record<string, Set<string>> = {
    role: new Set(['user', 'support', 'admin']),
    plan: new Set(['free', 'paid', 'agency', 'admin']),
    subscription_status: new Set(['inactive', 'trialing', 'active', 'past_due', 'cancelled']),
  };
  const patch: Record<string, unknown> = {};
  for (const [key, values] of Object.entries(allowed)) {
    if (key in (req.body?.patch || {})) {
      const value = String(req.body.patch[key]);
      if (!values.has(value)) throw new ApiError('INVALID_ADMIN_UPDATE', `Invalid ${key.replace(/_/g, ' ')} value.`, 400);
      patch[key] = value;
    }
  }
  if (!Object.keys(patch).length) throw new ApiError('EMPTY_ADMIN_UPDATE', 'No supported user fields were provided.', 400);
  const client = requireSupabaseAdminClient();
  const { data: before, error: readError } = await client.from('user_profiles').select('role,plan,subscription_status,disabled').eq('id', req.params.id).maybeSingle();
  if (readError) throw readError;
  if (!before) throw new ApiError('USER_NOT_FOUND', 'User not found.', 404);
  const { count: activeAdminCount, error: countError } = await client.from('user_profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('disabled', false);
  if (countError) throw countError;
  const guard = getUserActionGuard({
    actorId: requester.userId,
    targetId: req.params.id,
    targetRole: before.role,
    activeAdminCount: activeAdminCount || 0,
    action: 'update_access',
    nextRole: patch.role as any,
  });
  if (!guard.allowed) throw new ApiError(guard.code, guard.message, 409);
  const { error } = await client.from('user_profiles').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', req.params.id);
  if (error) throw error;
  invalidateAdminReadCache('overview:');
  await client.from('admin_actions').insert({ admin_user_id: requester.userId, action: 'update_user_access', target_type: 'user', target_id: req.params.id, metadata: { reason, before, after: patch } });
  res.json({ success: true, data: { userId: req.params.id, before, after: patch } });
}));

apiRouter.post('/admin/plans/:plan', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 4 || reason.length > 500) throw new ApiError('ADMIN_REASON_REQUIRED', 'Provide a reason between 4 and 500 characters.', 400);
  const allowedKeys = new Set(['daily_audits', 'monthly_audits', 'max_pages_quick', 'max_pages_standard', 'max_pages_deep', 'audit_timeout_seconds', 'concurrency', 'max_events_per_audit', 'max_issues_per_audit', 'priority']);
  const patch = Object.fromEntries(Object.entries(req.body?.patch || {}).filter(([key, value]) => allowedKeys.has(key) && Number.isFinite(Number(value))).map(([key, value]) => [key, Number(value)]));
  if (!Object.keys(patch).length) throw new ApiError('EMPTY_ADMIN_UPDATE', 'No supported plan fields were provided.', 400);
  const client = requireSupabaseAdminClient();
  const { data: before, error: readError } = await client.from('plan_limits').select('*').eq('plan', req.params.plan).maybeSingle();
  if (readError) throw readError;
  if (!before) throw new ApiError('PLAN_NOT_FOUND', 'Plan not found.', 404);
  const { error } = await client.from('plan_limits').update({ ...patch, updated_at: new Date().toISOString() }).eq('plan', req.params.plan);
  if (error) throw error;
  invalidateAdminReadCache('plans');
  await client.from('admin_actions').insert({ admin_user_id: requester.userId, action: 'update_plan_limits', target_type: 'plan', target_id: req.params.plan, metadata: { reason, before, after: patch } });
  res.json({ success: true, data: { plan: req.params.plan, after: patch } });
}));

apiRouter.post('/admin/platform/settings', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 4 || reason.length > 500) throw new ApiError('ADMIN_REASON_REQUIRED', 'Provide a reason between 4 and 500 characters.', 400);
  const client = requireSupabaseAdminClient();
  const { data: before, error: readError } = await client.from('platform_settings').select('*').eq('id', 'settings').maybeSingle();
  if (readError) throw readError;
  const patch = req.body?.patch || {};
  const row = {
    id: 'settings',
    key: 'settings',
    platform_name: String(patch.platformName || before?.platform_name || BRAND.name).slice(0, 100),
    support_email: String(patch.supportEmail || before?.support_email || '').slice(0, 254),
    require_email_verification: Boolean(patch.requireEmailVerification ?? before?.require_email_verification),
    public_registration: Boolean(patch.publicRegistration ?? before?.public_registration ?? true),
    value: typeof patch.value === 'object' && patch.value ? patch.value : before?.value || {},
    updated_at: new Date().toISOString(),
  };
  const { error } = await client.from('platform_settings').upsert(row, { onConflict: 'id' });
  if (error) throw error;
  invalidateAdminReadCache('platform-settings');
  await client.from('admin_actions').insert({ admin_user_id: requester.userId, action: 'update_platform_settings', target_type: 'platform_setting', target_id: 'settings', metadata: { reason, before: before || null, after: row } });
  res.json({ success: true, data: row });
}));

apiRouter.post('/admin/platform/control', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 4 || reason.length > 500) throw new ApiError('ADMIN_REASON_REQUIRED', 'Provide a reason between 4 and 500 characters.', 400);
  const allowedKeys = new Set(['maintenanceMode', 'pauseFreeSubmissions', 'captchaRequired', 'hardQueueLimit', 'softQueueWarning', 'disabledAuditModes']);
  const key = String(req.body?.key || '');
  if (!allowedKeys.has(key)) throw new ApiError('UNSUPPORTED_PLATFORM_CONTROL', 'This platform control is not supported.', 400);
  const client = requireSupabaseAdminClient();
  const { data: row, error: readError } = await client.from('platform_settings').select('value').eq('id', 'settings').maybeSingle();
  if (readError) throw readError;
  const before = row?.value?.[key] ?? null;
  const value = req.body?.value;
  const nextValue = { ...(row?.value || {}), [key]: value };
  const { error } = await client.from('platform_settings').upsert({ id: 'settings', key: 'settings', value: nextValue, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) throw error;
  invalidateAdminReadCache('platform-settings');
  await client.from('admin_actions').insert({ admin_user_id: requester.userId, action: 'update_platform_control', target_type: 'platform_setting', target_id: key, metadata: { reason, before, after: value } });
  res.json({ success: true, data: { key, value } });
}));

apiRouter.get('/blog/posts', asyncJsonRoute(async (req, res) => {
  const result = await blogRepository.listPublished({ query: String(req.query.q || ''), limit: Number(req.query.limit || 12), offset: Number(req.query.offset || 0) });
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  res.json({ success: true, data: result });
}));

apiRouter.get('/blog/sitemap.xml', asyncJsonRoute(async (req, res) => {
  const xml = await renderBlogSitemap(canonicalSiteOrigin(req));
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  res.status(200).send(xml);
}));

apiRouter.get('/blog/rss.xml', asyncJsonRoute(async (req, res) => {
  const xml = await renderBlogRss(canonicalSiteOrigin(req));
  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  res.status(200).send(xml);
}));

apiRouter.get('/blog/news-sitemap.xml', asyncJsonRoute(async (req, res) => {
  const xml = await renderBlogNewsSitemap(canonicalSiteOrigin(req));
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  res.status(200).send(xml);
}));

const runBlogScheduler = asyncJsonRoute(async (req: any, res: any) => {
  if (!schedulerRequestAllowed(req)) throw new ApiError('BLOG_SCHEDULER_UNAUTHORIZED', 'Scheduler authentication failed.', 401);
  const settings = await blogAutomationRepository.getSettings();
  let discoveryJob = null;
  if (process.env.BLOG_AUTOMATION_ENABLED === 'true' && settings.enabled && Array.isArray(settings.approved_feed_urls) && settings.approved_feed_urls.length) {
    const now = new Date();
    const sixHourBucket = `${now.toISOString().slice(0, 10)}-${Math.floor(now.getUTCHours() / 6)}`;
    discoveryJob = await blogAutomationRepository.createJob({
      origin: 'autopilot',
      payload: { jobType: 'discover_trends', feedUrls: settings.approved_feed_urls },
      idempotencyKey: blogJobIdempotencyKey({ origin: 'autopilot', topic: 'scheduled-discovery', dateBucket: sixHourBucket }),
    });
  }
  const dispatch = await recoverAndDispatchVercelBlogWork(1);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: { ...dispatch, discoveryJobId: discoveryJob?.id || null } });
});
apiRouter.get('/blog/scheduler/run', runBlogScheduler);
apiRouter.post('/blog/scheduler/run', runBlogScheduler);

const runBlogDispatcher = asyncJsonRoute(async (req: any, res: any) => {
  if (!schedulerRequestAllowed(req)) throw new ApiError('BLOG_DISPATCH_UNAUTHORIZED', 'Dispatcher authentication failed.', 401);
  const requestedJobId = String(req.body?.jobId || req.query?.jobId || '').trim() || null;
  if (requestedJobId && !/^[0-9a-f-]{36}$/i.test(requestedJobId)) throw new ApiError('BLOG_JOB_ID_INVALID', 'The requested blog job ID is invalid.', 400);
  const data = await dispatchVercelBlogStages({ requestedJobId, maxStages: Math.max(1, Math.min(3, Number(req.body?.maxStages || req.query?.maxStages || 1))) });
  const chainDepth = Math.max(0, Math.min(7, Number(req.body?.chainDepth || 0)));
  const latestJob = data.results.at(-1)?.job;
  if (latestJob && !['ready_for_review', 'scheduled', 'published', 'failed', 'cancelled'].includes(latestJob.workflowStage) && chainDepth < 7) {
    requestImmediateBlogDispatch(req, latestJob.id, chainDepth + 1);
  }
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data });
});
apiRouter.get('/blog/jobs/dispatch', runBlogDispatcher);
apiRouter.post('/blog/jobs/dispatch', runBlogDispatcher);

apiRouter.post('/blog/jobs/recover', asyncJsonRoute(async (req, res) => {
  if (!schedulerRequestAllowed(req)) throw new ApiError('BLOG_RECOVERY_UNAUTHORIZED', 'Recovery authentication failed.', 401);
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
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  res.status(200).send(renderBlogArticleHtml(post, canonicalSiteOrigin(req)));
}));

apiRouter.get('/blog/posts/:slug', asyncJsonRoute(async (req, res) => {
  const post = await blogRepository.getPublishedBySlug(normalizeBlogSlug(req.params.slug));
  if (!post) return res.status(404).json({ success: false, error: 'Article not found.' });
  if (!post.relatedArticles.length) {
    const related = await blogRepository.relatedPublished(post, 4);
    post.relatedArticles = related.map((item) => ({ postId: item.id, slug: item.slug, title: item.title, reason: item.topicCluster ? `More guidance about ${item.topicCluster}.` : '' }));
  }
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  res.json({ success: true, data: { post } });
}));

apiRouter.get('/admin/blog/posts', asyncJsonRoute(async (req, res) => {
  if (!(await requireAdminRequester(req, res))) return;
  const posts = await blogRepository.listAdmin(Number(req.query.limit || 100));
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: { posts } });
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
  res.json({ success: true, data: { overview, jobs, discoveries, provider: { provider: 'Groq', execution: 'Vercel server workflow', enabled: Boolean(settings.provider_enabled && providerConfiguration.enabled), configured: providerConfiguration.configured, model: providerConfiguration.structuredModel, structuredModel: providerConfiguration.structuredModel, writerModel: providerConfiguration.writerModel, baseUrlHost: providerConfiguration.baseUrlHost, health: settings.provider_last_error_code ? 'attention required' : settings.provider_last_success_at ? 'connected' : providerConfiguration.configured ? 'not tested' : providerConfiguration.enabled ? 'not configured' : 'disabled', lastSuccessAt: settings.provider_last_success_at || null, lastErrorCode: settings.provider_last_error_code || '', lastDurationMs: settings.provider_last_duration_ms ?? null, liveVerificationStatus: settings.provider_live_verification_status || 'not_run', fixtureAvailable: fixtureConfiguration.enabled } } });
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
    requireBlogFixtureProvider();
    job = await blogAutomationRepository.createJob({
      origin: 'admin_manual', topic: String(discovery.source_title || ''), requestedBy: requester.userId,
      provider: BLOG_FIXTURE_PROVIDER, model: BLOG_FIXTURE_MODEL,
      payload: { jobType: 'generate_article', fixtureScenario: 'news', articleType: 'urgent_news', topicCluster: discovery.topic_cluster, discoveryId: discovery.id },
      idempotencyKey: blogJobIdempotencyKey({ origin: 'admin_manual', topic: `fixture-trend:${discovery.id}`, dateBucket: new Date().toISOString().slice(0, 13) }),
    });
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
  res.json({ success: true, data: { result } });
}));

apiRouter.post('/admin/blog/jobs', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const mode = String(req.body?.mode || 'manual');
  if (!['manual', 'custom_headline', 'discover', 'fixture'].includes(mode)) throw new ApiError('BLOG_JOB_MODE_INVALID', 'Choose a supported blog job type.', 400);
  if (mode === 'fixture') requireBlogFixtureProvider();
  const origin = mode === 'custom_headline' ? 'admin_custom_headline' : mode === 'discover' ? 'autopilot' : 'admin_manual';
  const topic = String(req.body?.topic || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  const headline = String(req.body?.headline || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  if (mode !== 'discover' && (mode === 'custom_headline' ? headline.length < 8 : topic.length < 5)) throw new ApiError('BLOG_JOB_INPUT_REQUIRED', mode === 'custom_headline' ? 'Enter a specific headline.' : 'Enter a specific topic.', 400);
  if (mode === 'custom_headline') {
    const duplicate = (await blogRepository.listAdmin(200)).find((post) => post.title.toLowerCase() === headline.toLowerCase());
    if (duplicate && req.body?.allowDuplicate !== true) throw new ApiError('DUPLICATE_BLOG_HEADLINE', `A post already uses this headline: ${duplicate.title}`, 409);
  }
  const current = new Date();
  const dateBucket = mode === 'discover'
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
      jobType: mode === 'discover' ? 'discover_trends' : 'generate_article',
      manualDiscovery: mode === 'discover',
      audience: String(req.body?.audience || '').slice(0, 240),
      keywords: String(req.body?.keywords || '').slice(0, 300),
      feedUrls: Array.isArray(req.body?.feedUrls) ? req.body.feedUrls.slice(0, 20) : undefined,
      sources: Array.isArray(req.body?.sources) ? req.body.sources.slice(0, 12) : undefined,
      sourceUrls: Array.isArray(req.body?.sourceUrls) ? req.body.sourceUrls.slice(0, 12).map(String) : undefined,
      competitorUrls: Array.isArray(req.body?.competitorUrls) ? req.body.competitorUrls.slice(0, 5).map(String) : undefined,
      articleType: normalizeBlogArticleType(req.body?.articleType, mode === 'discover' ? 'news_analysis' : 'evergreen_guide'),
      lengthMode: ['automatic', 'brief', 'standard', 'detailed', 'custom'].includes(String(req.body?.lengthMode)) ? String(req.body.lengthMode) : 'automatic',
      customMinimum: Math.max(500, Math.min(3500, Number(req.body?.customMinimum) || 0)),
      customMaximum: Math.max(500, Math.min(4000, Number(req.body?.customMaximum) || 0)),
      fixtureScenario: mode === 'fixture' && ['evergreen', 'news', 'invalid', 'timeout', 'malformed', 'originality_failure', 'missing_sources', 'image_failure'].includes(String(req.body?.fixtureScenario)) ? String(req.body.fixtureScenario) : undefined,
    },
    idempotencyKey: blogJobIdempotencyKey({ origin, topic, customHeadline: headline, dateBucket }),
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
  try {
    const row = prepareBlogPostForStorage(req.body || {});
    row.slug = await uniqueBlogSlug(row.slug, existing.id);
    const post = await blogRepository.update(existing.id, { ...row, updated_by: requester.userId });
    if (post) await blogRepository.syncEditorialRecords(post, requester.userId, existing.status);
    await logBlogAction(requester.userId, 'update_blog_post', existing.id, { status: post?.status, slug: post?.slug });
    res.json({ success: true, data: { post } });
  } catch (error) {
    if (error instanceof BlogValidationError) return res.status(error.status).json({ success: false, error: error.message });
    throw error;
  }
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
    post = await blogRepository.update(existing.id, { status: action === 'hold' ? 'needs_review' : 'draft', scheduled_at: null, published_at: null, robots_directive: 'noindex,nofollow', publication_reason: reason, reviewer_id: requester.userId, updated_by: requester.userId });
  } else if (action === 'convert_manual') {
    post = await blogRepository.update(existing.id, { origin: 'scheduled_manual', publication_reason: reason, updated_by: requester.userId });
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
      post = await blogRepository.update(existing.id, { status: 'draft', scheduled_at: null, robots_directive: 'noindex,nofollow', publication_reason: reason, schedule_version: existing.scheduleVersion + 1, reviewer_id: requester.userId, updated_by: requester.userId });
    } else {
      const row = prepareBlogPostForStorage({ ...existing, status: action === 'publish_now' ? 'published' : 'scheduled', publishedAt: action === 'publish_now' ? new Date().toISOString() : null, scheduledAt: requestedTime, publicationReason: reason, publicationRule: action === 'reset_recommended_time' ? 'administrator_reset_to_recommendation' : action === 'reschedule' ? 'administrator_calendar_move' : 'administrator_publish_now', scheduleVersion: existing.scheduleVersion + 1 });
      post = await blogRepository.update(existing.id, { ...row, reviewer_id: requester.userId, updated_by: requester.userId });
    }
  } else {
    throw new ApiError('UNSUPPORTED_BLOG_WORKFLOW_ACTION', 'This content workflow action is not supported.', 400);
  }
  if (!post) return res.status(404).json({ success: false, error: 'Article not found.' });
  await blogRepository.syncEditorialRecords(post, requester.userId, existing.status);
  if ((existing.origin === 'autopilot' || existing.origin === 'trend_autopilot') && existing.status === 'needs_review' && (action === 'publish_now' || action === 'cancel')) await blogAutomationRepository.recordAutomaticReview(action === 'publish_now');
  await logBlogAction(requester.userId, `blog_workflow_${action}`, post.id, { previousState: existing.status, newState: post.status, reason });
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
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 4 || reason.length > 500) throw new ApiError('ADMIN_REASON_REQUIRED', 'Provide a reason between 4 and 500 characters.', 400);
  const post = await blogRepository.update(req.params.id, { status: 'archived', updated_by: requester.userId });
  if (!post) return res.status(404).json({ success: false, error: 'Article not found.' });
  await logBlogAction(requester.userId, 'archive_blog_post', post.id, { slug: post.slug, reason });
  res.json({ success: true, data: { post } });
}));

async function startQueuedAudit(req: any, res: any, defaultMode: AuditMode = 'quick') {
  const { url, mode = defaultMode, projectId = null } = req.body || {};
  const normalized = normalizeUserUrl(String(url || ''), {
    allowPrivateForTesting: process.env.SEOINTEL_ALLOW_PRIVATE_TEST_TARGETS === 'true',
  });
  if (!normalized.isValid) {
    throw new ApiError('INVALID_AUDIT_TARGET', normalized.error || 'Enter a valid public website or domain.', 400);
  }

  const requestedMode = getAuditModeConfig(mode).mode as AuditMode;
  const { userId } = await getRequester(req);
  const guestIdentity = guestIdentityForRequest(req);
  const ownerLookup = userId
    ? { userId, guestKeyHash: null }
    : { userId: null, guestKeyHash: guestIdentity.guestKeyHash };
  const createdAfterIso = new Date(Date.now() - DUPLICATE_AUDIT_WINDOW_MS).toISOString();

  let decision;
  try {
    decision = await canStartAudit(userId, requestedMode, {
      guestKey: guestIdentity.guestKey,
      deepAuditEnabled: isDeepAuditEnabled(),
    });
  } catch (error) {
    if (error instanceof EntitlementError && /already have an audit in progress/i.test(error.message)) {
      const activeAudit = await auditRepository.findActiveAuditForOwner(ownerLookup);
      if (activeAudit) {
        return res.json({
          success: true,
          message: 'You already have an audit in progress.',
          data: auditStartResponseData(activeAudit, { reusedExistingAudit: true }),
        });
      }
    }
    return sendEntitlementError(res, error);
  }

  let admission: Awaited<ReturnType<typeof admitAuditSubmission>> | null = null;
  if (isSupabaseAdminEnabled()) {
    await assertAuditDeploymentCompatible();
    admission = await admitAuditSubmission({
      userId,
      guestKeyHash: userId ? null : guestIdentity.guestKeyHash,
      ipHash: requestNetworkHash(req),
      normalizedDomain: normalized.hostname,
      normalizedUrl: normalized.normalizedUrl,
      auditMode: decision.effectiveMode,
      plan: decision.plan,
      dailyLimit: userId ? decision.limits.dailyAudits : Number(process.env.GUEST_DAILY_AUDIT_LIMIT || 2),
      domainDailyLimit: Number(process.env.DOMAIN_DAILY_AUDIT_LIMIT || 2),
      activeLimit: decision.plan === 'free' ? 1 : Math.max(1, decision.limits.concurrency),
      globalActiveLimit: Number(process.env.GLOBAL_ACTIVE_AUDIT_LIMIT || 50),
      botVerified: await verifyBotToken(String(req.body?.botToken || '')),
    });

    if (admission.reusedExistingAudit) {
      let existing: ResourceAuditDocument | null = null;
      for (let attempt = 0; attempt < 20 && !existing; attempt += 1) {
        existing = await auditRepository.getAudit(admission.auditId);
        if (!existing) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (existing) return res.json({ success: true, data: auditStartResponseData(existing, { reusedExistingAudit: true }) });
      return res.status(202).json({ success: true, data: {
        auditId: admission.auditId,
        status: 'queued',
        submittedInput: String(url || '').trim(),
        normalizedUrl: normalized.normalizedUrl,
        hostname: normalized.hostname,
        requestedMode: decision.requestedMode,
        effectiveMode: decision.effectiveMode,
        plan: decision.plan,
        pageLimit: decision.pageLimit,
        queuePriority: decision.queuePriority,
        reusedExistingAudit: true,
      }});
    }
    if (!admission.allowed) {
      if (admission.code === 'ACTIVE_AUDIT_EXISTS' && admission.auditId) {
        const existing = await auditRepository.getAudit(admission.auditId);
        if (existing) {
          return res.json({ success: true, message: 'You already have an audit in progress.', data: auditStartResponseData(existing, { reusedExistingAudit: true }) });
        }
      }
      throw admissionError(admission);
    }
  } else if (process.env.NODE_ENV === 'production') {
    throw new ApiError('AUDIT_ADMISSION_UNAVAILABLE', 'The audit service is being updated. Please try again shortly.', 503, { retryAfterSeconds: 120 });
  } else {
    const duplicateAudit = await auditRepository.findActiveDuplicateAudit({ ...ownerLookup, normalizedUrl: normalized.normalizedUrl, createdAfterIso });
    if (duplicateAudit) return res.json({ success: true, data: auditStartResponseData(duplicateAudit, { reusedExistingAudit: true }) });
    const activeAudit = await auditRepository.findActiveAuditForOwner(ownerLookup);
    if (activeAudit) return res.json({ success: true, message: 'You already have an audit in progress.', data: auditStartResponseData(activeAudit, { reusedExistingAudit: true }) });
  }

  let audit: ResourceAuditDocument;
  try {
    audit = await auditRepository.createAuditJob({
      id: admission?.auditId,
      submittedInput: String(url || '').trim(),
      normalizedUrl: normalized.normalizedUrl,
      hostname: normalized.hostname,
      mode: decision.effectiveMode,
      requestedMode: decision.requestedMode,
      effectiveMode: decision.effectiveMode,
      plan: decision.plan,
      processingTier: decision.processingTier,
      pageLimit: decision.pageLimit,
      queuePriority: decision.queuePriority,
      estimatedWaitSeconds: admission?.queueDepth ? Math.max(0, admission.queueDepth - 1) * 45 : null,
      userId: decision.userId,
      guestKeyHash: decision.userId ? null : guestIdentity.guestKeyHash,
      projectId,
    });
  } catch (error) {
    if (admission?.auditId) await releaseAuditAdmission(admission.auditId, 'AUDIT_CREATE_FAILED');
    throw error;
  }

  try {
    await consumeAuditQuota(decision.userId, audit.id, decision.effectiveMode, {
      plan: decision.plan,
      pagesLimit: decision.pageLimit,
      guestKey: guestIdentity.guestKey,
    });
    await auditRepository.updateAudit(audit.id, { quotaCounted: true });
  } catch (error) {
    await auditRepository.addInternalDiagnostic({
      auditId: audit.id,
      affectedUrl: audit.normalizedUrl,
      failureCode: 'QUOTA_COUNTER_SYNC_FAILED',
      phase: 'admission',
      attemptCount: 1,
      internalDetails: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
  }

  res.json({
    success: true,
    data: {
      ...auditStartResponseData(audit),
      quotaRemaining: decision.quotaRemaining,
      reusedExistingAudit: false,
      queueDepth: admission?.queueDepth ?? null,
      softQueueWarning: admission?.softQueueWarning ?? false,
    },
  });
}


apiRouter.post('/audit/start', asyncJsonRoute((req, res) => startQueuedAudit(req, res, 'quick')));

apiRouter.get('/audit/events/:id', asyncJsonRoute(async (req, res) => {
  const auditId = req.params.id;
  const audit = await auditRepository.getAudit(auditId);
  if (!audit || !(await canAccessAudit(req, audit))) throw new ApiError('AUDIT_NOT_FOUND', 'Audit not found.', 404);
  const requestedLimit = Number(req.query.limit || 50);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, Math.floor(requestedLimit))) : 50;
  const events = await auditRepository.getEvents(auditId, limit);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: { auditId, events } });
}));


apiRouter.get('/audit/status/:id', asyncJsonRoute(async (req, res) => {
  const liveData = await auditRepository.getLiveData(req.params.id);
  if (!liveData.audit || !(await canAccessAudit(req, liveData.audit))) throw new ApiError('AUDIT_NOT_FOUND', 'Audit not found.', 404);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: liveData });
}));

apiRouter.post('/audit/cancel/:id', asyncJsonRoute(async (req, res) => {
  const audit = await auditRepository.getAudit(req.params.id);
  if (!audit || !(await canAccessAudit(req, audit))) throw new ApiError('AUDIT_NOT_FOUND', 'Audit not found.', 404);
  if (!['queued', 'running'].includes(audit.status)) throw new ApiError('AUDIT_NOT_CANCELLABLE', 'Only an active audit can be cancelled.', 409);
  if (!(await auditRepository.cancelAudit(req.params.id))) throw new ApiError('AUDIT_NOT_CANCELLABLE', 'The audit is no longer active.', 409);
  res.json({ success: true, data: { auditId: req.params.id, status: 'cancelled' } });
}));

apiRouter.get('/audit/result/:id', asyncJsonRoute(async (req, res) => {
  const liveData = await auditRepository.getLiveData(req.params.id);
  if (!liveData.audit || !(await canAccessAudit(req, liveData.audit))) throw new ApiError('AUDIT_NOT_FOUND', 'Audit not found.', 404);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: liveData });
}));

apiRouter.get('/audit/:id/finding-workflow', asyncJsonRoute(async (req, res) => {
  const access = await requireWorkflowAudit(req, res);
  if (!access) return;
  const client = requireSupabaseAdminClient();
  const { data, error } = await client
    .from('audit_finding_workflow')
    .select('id,audit_id,finding_id,finding_key,status,priority_override,notes,due_at,resolved_at,resolved_by,created_at,updated_at,updated_by,version')
    .eq('audit_id', access.audit.id)
    .order('updated_at', { ascending: false })
    .limit(1000);
  if (error) throw error;
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: { records: (data || []).map(workflowRow), persistent: true } });
}));

apiRouter.put('/audit/:id/finding-workflow/:findingKey', durableRateLimit({ namespace: 'finding-workflow', limit: 120, windowSeconds: 60 }), asyncJsonRoute(async (req, res) => {
  const access = await requireWorkflowAudit(req, res);
  if (!access) return;
  const key = String(req.params.findingKey || '').trim().toLowerCase();
  if (!key || key.length > 512) throw new ApiError('INVALID_FINDING_KEY', 'Finding key is invalid.', 400);
  const status = req.body?.status;
  if (!isFindingWorkflowStatus(status)) throw new ApiError('INVALID_WORKFLOW_STATUS', 'Workflow status is invalid.', 400);
  const notes = String(req.body?.notes || '').trim().slice(0, 2000);
  const priorityOverride = req.body?.priorityOverride == null || req.body.priorityOverride === '' ? null : req.body.priorityOverride;
  if (priorityOverride && !isFindingPriorityOverride(priorityOverride)) throw new ApiError('INVALID_PRIORITY_OVERRIDE', 'Priority override is invalid.', 400);
  let dueAt: string | null = null;
  if (req.body?.dueAt) {
    const parsedDueAt = new Date(req.body.dueAt);
    if (!Number.isFinite(parsedDueAt.getTime())) throw new ApiError('INVALID_DUE_DATE', 'Due date is invalid.', 400);
    dueAt = parsedDueAt.toISOString();
  }

  const issues = await auditRepository.getLatestIssues(access.audit.id, 1000);
  const finding = issues.find((issue) => findingWorkflowKey(issue) === key);
  if (!finding) throw new ApiError('FINDING_NOT_FOUND', 'Finding not found for this audit.', 404);

  const client = requireSupabaseAdminClient();
  const existingResult = await client
    .from('audit_finding_workflow')
    .select('id,version')
    .eq('audit_id', access.audit.id)
    .eq('finding_key', key)
    .maybeSingle();
  if (existingResult.error) throw existingResult.error;
  const terminal = ['fixed', 'ignored', 'accepted_risk'].includes(status);
  const now = new Date().toISOString();
  let saved: any;

  if (existingResult.data) {
    const expectedVersion = Number(req.body?.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion !== Number(existingResult.data.version)) {
      throw new ApiError('WORKFLOW_CONFLICT', 'This finding changed in another tab. Reload it before saving again.', 409);
    }
    const result = await client
      .from('audit_finding_workflow')
      .update({
        finding_id: finding.id,
        status,
        priority_override: priorityOverride,
        notes,
        due_at: dueAt,
        resolved_at: terminal ? now : null,
        resolved_by: terminal ? access.requester.userId : null,
        updated_by: access.requester.userId,
        version: expectedVersion + 1,
      })
      .eq('id', existingResult.data.id)
      .eq('version', expectedVersion)
      .select('*')
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new ApiError('WORKFLOW_CONFLICT', 'This finding changed in another tab. Reload it before saving again.', 409);
    saved = result.data;
  } else {
    const result = await client.from('audit_finding_workflow').insert({
      audit_id: access.audit.id,
      finding_id: finding.id,
      finding_key: key,
      user_id: access.audit.userId,
      status,
      priority_override: priorityOverride,
      notes,
      due_at: dueAt,
      resolved_at: terminal ? now : null,
      resolved_by: terminal ? access.requester.userId : null,
      created_by: access.requester.userId,
      updated_by: access.requester.userId,
    }).select('*').single();
    if (result.error) {
      if (result.error.code === '23505') throw new ApiError('WORKFLOW_CONFLICT', 'This finding changed in another tab. Reload it before saving again.', 409);
      throw result.error;
    }
    saved = result.data;
  }
  res.json({ success: true, data: { record: workflowRow(saved) } });
}));

apiRouter.post('/audit/archive/:id', asyncJsonRoute(async (req, res) => {
  const audit = await auditRepository.getAudit(req.params.id);
  if (!audit || !(await canAccessAudit(req, audit))) throw new ApiError('AUDIT_NOT_FOUND', 'Audit not found.', 404);
  if (!isCompletedAuditStatus(audit.status) && !['failed', 'cancelled', 'abandoned'].includes(audit.status)) {
    throw new ApiError('AUDIT_NOT_ARCHIVABLE', 'Finish or cancel the audit before archiving it.', 409);
  }
  const archivedAt = req.body?.archived === false ? null : new Date().toISOString();
  await auditRepository.updateAudit(audit.id, { archivedAt });
  res.json({ success: true, data: { auditId: audit.id, archivedAt } });
}));

apiRouter.delete('/audit/:id', durableRateLimit({ namespace: 'audit-delete', limit: 20, windowSeconds: 3600 }), asyncJsonRoute(async (req, res) => {
  const audit = await auditRepository.getAudit(req.params.id);
  if (!audit || !(await canAccessAudit(req, audit))) throw new ApiError('AUDIT_NOT_FOUND', 'Audit not found.', 404);
  if (['queued', 'running'].includes(audit.status)) throw new ApiError('ACTIVE_AUDIT_DELETE_BLOCKED', 'Cancel the active audit before deleting it.', 409);
  const client = requireSupabaseAdminClient();
  const { error } = await client.from('audits').delete().eq('id', audit.id);
  if (error) throw error;
  res.json({ success: true, data: { auditId: audit.id, deleted: true } });
}));

apiRouter.get('/audits/history', asyncJsonRoute(async (req, res) => {
  const requester = await getRequester(req);
  if (!requester.userId) return res.status(401).json({ success: false, error: 'Authentication required.' });
  const allowedStatuses = new Set(['queued', 'running', 'completed', 'completed_with_warnings', 'failed', 'cancelled', 'abandoned']);
  const requestedStatus = String(req.query.status || '');
  const status = allowedStatuses.has(requestedStatus) ? requestedStatus : undefined;
  const hostname = String(req.query.hostname || '').trim().toLowerCase().slice(0, 253) || undefined;
  const data = await auditRepository.listAuditHistoryForUser({
    userId: requester.userId,
    status,
    hostname,
    includeArchived: req.query.archived === 'true',
    limit: Number(req.query.limit || 25),
    offset: Number(req.query.offset || 0),
  });
  res.json({ success: true, data });
}));

apiRouter.get('/audit/compare/:currentId/:baselineId', asyncJsonRoute(async (req, res) => {
  const [currentAudit, baselineAudit] = await Promise.all([
    auditRepository.getAudit(req.params.currentId),
    auditRepository.getAudit(req.params.baselineId),
  ]);
  if (!currentAudit || !baselineAudit) return res.status(404).json({ success: false, error: 'Audit not found' });
  if (!(await canAccessAudit(req, currentAudit)) || !(await canAccessAudit(req, baselineAudit))) {
    return res.status(404).json({ success: false, error: 'Audit not found' });
  }
  if (currentAudit.hostname !== baselineAudit.hostname) {
    return res.status(400).json({ success: false, error: 'Only audits for the same website can be compared.' });
  }
  const comparison = await auditRepository.compareAudits(currentAudit.id, baselineAudit.id);
  if (!comparison) return res.status(404).json({ success: false, error: 'Audit comparison is unavailable.' });
  res.json({ success: true, data: comparison });
}));

apiRouter.get('/audit/export/:id/:format', asyncJsonRoute(async (req, res) => {
  const { id, format } = req.params;
  const liveData = await auditRepository.getLiveData(id);
  if (!liveData.audit) return res.status(404).json({ success: false, error: 'Audit not found' });
  if (!(await canAccessAudit(req, liveData.audit))) return res.status(404).json({ success: false, error: 'Audit not found' });

  if (format === 'pdf') {
    if (!isCompletedAuditStatus(liveData.audit.status)) {
      return res.status(409).json({ success: false, error: 'PDF export is available after the audit completes.' });
    }
    const profile = getAuditProfileForDocument(liveData.audit);
    if (!profile.pdfEnabled) {
      return res.status(403).json({ success: false, error: 'PDF reports require a Full, Agency, or Admin audit.', upgradeRequired: true });
    }
    const { renderAuditPdf } = await import('../lib/report/pdf');
    const pdf = await renderAuditPdf(liveData);
    const safeHost = liveData.audit.hostname.replace(/[^a-z0-9.-]+/gi, '-').replace(/^-+|-+$/g, '') || 'website';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="crawlio-${safeHost}-audit.pdf"`);
    res.setHeader('Content-Length', String(pdf.length));
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(pdf);
  }

  if (format === 'json') {
    return res.json({ success: true, data: buildPublicAuditExport(liveData) });
  }

  if (format === 'issues.csv') {
    const header = 'severity,category,title,affectedUrl,evidence,recommendation\n';
    const rows = liveData.latestIssues.map((issue) => csvRow([issue.severity, issue.category, issue.title, issue.affectedUrl, issue.evidence, issue.recommendation])).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send(header + rows);
  }

  if (format === 'pages.csv') {
    const header = 'statusCode,url,responseTimeMs,pageSizeBytes,title,wordCount,crawlDepth,issueCount\n';
    const rows = liveData.latestPages.map((page) => csvRow([page.statusCode, page.url, page.responseTimeMs, page.pageSizeBytes, page.title, page.wordCount, page.crawlDepth, page.issueCount])).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send(header + rows);
  }

  return res.status(400).json({ success: false, error: 'Unsupported export format' });
}));

apiRouter.post('/audit/rerun/:id', asyncJsonRoute((_req, res) => res.status(409).json({ success: false, error: 'Rerun is disabled for worker-backed audits. Start a new audit instead.' })));

apiRouter.get('/domain/link-signals', asyncJsonRoute(async (req, res) => {
  const rawDomain = String(req.query?.domain || '').trim();
  if (!rawDomain || rawDomain.length > 253) throw new ApiError('INVALID_DOMAIN', 'Enter a valid public domain.', 400);
  const normalized = normalizeUserUrl(rawDomain);
  if (!normalized.isValid) throw new ApiError('INVALID_DOMAIN', normalized.error || 'Enter a valid public domain.', 400);
  const domain = normalized.hostname.replace(/^www\./, '');

  try {
    const signals = await getPublicLinkSignals(domain);
    res.setHeader('Cache-Control', signals.partial
      ? 'public, max-age=60, s-maxage=900, stale-while-revalidate=3600'
      : 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
    return res.json({ success: true, data: signals });
  } catch {
    throw new ApiError('PUBLIC_LINK_SIGNALS_UNAVAILABLE', 'External domain evidence is temporarily unavailable. Please try again later.', 503);
  }
}));

apiRouter.post('/keyword/research', asyncJsonRoute((req, res) => {
  const seed = String(req.body?.seed || '').trim();
  if (!seed || seed.length > 200) throw new ApiError('INVALID_KEYWORD_SEED', 'Enter a keyword between 1 and 200 characters.', 400);
  const keywords = generateKeywords(seed);
  res.json({ success: true, data: { keywords } });
}));

apiRouter.post('/website/analyze', asyncJsonRoute((req, res) => startQueuedAudit(req, res, 'standard')));

apiRouter.post('/clusters', asyncJsonRoute((req, res) => {
  const { keywords } = req.body || {};
  if (!Array.isArray(keywords) || !keywords.length || keywords.length > 500) throw new ApiError('INVALID_KEYWORD_LIST', 'Provide between 1 and 500 keywords.', 400);
  const clusters = clusterKeywords(keywords.slice(0, 500));
  res.json({ success: true, data: { clusters } });
}));

apiRouter.post('/content-brief', asyncJsonRoute((req, res) => {
  const { cluster } = req.body || {};
  if (!cluster || typeof cluster !== 'object') throw new ApiError('INVALID_CONTENT_CLUSTER', 'A valid keyword cluster is required.', 400);
  const brief = buildContentBrief(cluster);
  res.json({ success: true, data: { brief } });
}));

apiRouter.post('/competitor-gap', asyncJsonRoute(async (req, res) => {
  return res.status(501).json({
    success: false,
    error: 'Competitor Gap is temporarily disabled while worker-backed analysis is being enabled.',
  });
}));
