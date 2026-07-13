import { createHash } from 'node:crypto';
import { Router } from 'express';
import { normalizeDomainInput, normalizeUserUrl } from '../lib/seo/url-utils';
import { isCompletedAuditStatus } from '../lib/audit/audit-time';
import { generateKeywords } from '../lib/keywords/generator';
import { clusterKeywords } from '../lib/keywords/clustering';
import { buildContentBrief } from '../lib/keywords/content-brief';
import { auditStore } from '../lib/audit/audit-store';
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
import { NVIDIA_DEFAULT_BLOG_MODEL } from '../lib/blog/nvidia';
import { normalizeBlogArticleType } from '../lib/blog/length-policy';
import { validateCalendarMove } from '../lib/blog/freshness';
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
apiRouter.use('/admin/blog/jobs', durableRateLimit({ namespace: 'blog-jobs', limit: 20, windowSeconds: 3600 }));
apiRouter.use('/admin/blog/batches', durableRateLimit({ namespace: 'blog-batches', limit: 5, windowSeconds: 3600 }));
apiRouter.use('/admin/blog/images/import', durableRateLimit({ namespace: 'blog-images', limit: 10, windowSeconds: 3600 }));
apiRouter.use('/admin/blog/provider/test', durableRateLimit({ namespace: 'blog-provider-test', limit: 5, windowSeconds: 3600 }));
apiRouter.use('/admin/blog/sections', durableRateLimit({ namespace: 'blog-section-regeneration', limit: 10, windowSeconds: 3600 }));
apiRouter.use('/blog/scheduler', durableRateLimit({ namespace: 'blog-scheduler', limit: 10, windowSeconds: 300 }));
apiRouter.use('/audit/export', durableRateLimit({ namespace: 'report-export', limit: 10, windowSeconds: 300 }));
apiRouter.use('/audit/cancel', durableRateLimit({ namespace: 'audit-cancel', limit: 10, windowSeconds: 300 }));

function firstHeaderValue(value: unknown) {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function hashGuestValue(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function schedulerRequestAllowed(req: any) {
  const expected = String(process.env.BLOG_SCHEDULER_SECRET || process.env.CRON_SECRET || '');
  const supplied = firstHeaderValue(req.headers?.authorization).replace(/^Bearer\s+/i, '') || firstHeaderValue(req.headers?.['x-blog-scheduler-secret']);
  if (expected.length < 24 || supplied.length < 24) return false;
  return createHash('sha256').update(expected).digest('hex') === createHash('sha256').update(supplied).digest('hex');
}

function getCookieValue(req: any, name: string) {
  if (req.cookies?.[name]) return String(req.cookies[name]);
  const cookieHeader = firstHeaderValue(req.headers?.cookie);
  const match = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

function guestIdentityForRequest(req: any) {
  const explicitGuestId = firstHeaderValue(req.headers?.['x-seointel-guest-id']) || getCookieValue(req, 'seointel_guest_id');
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

async function canAccessAudit(req: any, audit: ResourceAuditDocument) {
  const requester = await getRequester(req);
  if (requester.profile?.role === 'admin') return true;
  if (audit.userId) return requester.userId === audit.userId;
  if (audit.guestKeyHash) return guestIdentityForRequest(req).guestKeyHash === audit.guestKeyHash;
  return false;
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
  res.setHeader('Content-Disposition', 'attachment; filename="seointel-account-export.json"');
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({
    exportedAt: new Date().toISOString(),
    profile: profile.data,
    audits: audits.data || [],
    projects: projects.data || [],
    keywords: keywords.data || [],
    competitors: competitors.data || [],
    storageNotice: 'SEOIntel stores audit summaries and findings, not complete raw HTML.',
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
  await client.from('user_profiles').update({ deletion_requested_at: new Date().toISOString() }).eq('id', authUser.id);
  const { data, error } = await client.rpc('delete_user_owned_data', { p_user_id: authUser.id });
  if (error) throw error;
  const { error: authDeleteError } = await client.auth.admin.deleteUser(authUser.id);
  if (authDeleteError) throw authDeleteError;
  res.setHeader('Clear-Site-Data', '"cache", "cookies", "storage"');
  res.json({ success: true, data });
}));

apiRouter.get('/version', asyncJsonRoute(async (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.json({ success: true, data: publicVersionPayload() });
}));

apiRouter.get('/admin/diagnostics', asyncJsonRoute(async (req, res) => {
  if (!(await requireAdminRequester(req, res))) return;
  const client = requireSupabaseAdminClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [compatibility, auditsResult, workersResult, errorsResult, diagnosticsResult, actionsResult] = await Promise.all([
    getDeploymentCompatibility(),
    client.from('audits').select('id,status,created_at,started_at,completed_at,lease_expires_at,warning_count,failure_counts,pages_discovered,pages_crawled').gte('created_at', since).order('created_at', { ascending: false }).limit(500),
    client.from('platform_settings').select('key,value,updated_at').like('key', 'audit_worker:%').order('updated_at', { ascending: false }).limit(20),
    client.from('api_error_logs').select('request_id,route,method,user_id,internal_code,internal_details,deployment_version,created_at').order('created_at', { ascending: false }).limit(50),
    client.from('audit_diagnostics').select('id,audit_id,affected_url,failure_code,phase,attempt_count,request_duration_ms,worker_id,internal_details,created_at').order('created_at', { ascending: false }).limit(100),
    client.from('admin_actions').select('*').order('created_at', { ascending: false }).limit(50),
  ]);
  const error = [auditsResult.error, workersResult.error, errorsResult.error, diagnosticsResult.error, actionsResult.error].find(Boolean);
  if (error) throw error;
  const rows = auditsResult.data || [];
  const durations = rows.map((row: any) => row.started_at && row.completed_at ? new Date(row.completed_at).getTime() - new Date(row.started_at).getTime() : 0).filter((value) => value > 0);
  const waits = rows.map((row: any) => row.started_at ? new Date(row.started_at).getTime() - new Date(row.created_at).getTime() : 0).filter((value) => value >= 0);
  const failureGroups: Record<string, number> = {};
  rows.forEach((row: any) => Object.entries(row.failure_counts || {}).forEach(([code, count]) => { failureGroups[code] = (failureGroups[code] || 0) + Number(count || 0); }));
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: {
    compatibility,
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
  }});
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
  const { data: before, error: readError } = await client.from('user_profiles').select('role,plan,subscription_status').eq('id', req.params.id).maybeSingle();
  if (readError) throw readError;
  if (!before) throw new ApiError('USER_NOT_FOUND', 'User not found.', 404);
  const { error } = await client.from('user_profiles').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', req.params.id);
  if (error) throw error;
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
    platform_name: String(patch.platformName || before?.platform_name || 'SEOIntel').slice(0, 100),
    support_email: String(patch.supportEmail || before?.support_email || '').slice(0, 254),
    require_email_verification: Boolean(patch.requireEmailVerification ?? before?.require_email_verification),
    public_registration: Boolean(patch.publicRegistration ?? before?.public_registration ?? true),
    value: typeof patch.value === 'object' && patch.value ? patch.value : before?.value || {},
    updated_at: new Date().toISOString(),
  };
  const { error } = await client.from('platform_settings').upsert(row, { onConflict: 'id' });
  if (error) throw error;
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
  const [publishedIds, settings] = await Promise.all([blogRepository.publishDueScheduled(10), blogAutomationRepository.getSettings()]);
  let discoveryJob = null;
  if (settings.enabled && Array.isArray(settings.approved_feed_urls) && settings.approved_feed_urls.length) {
    const now = new Date();
    const sixHourBucket = `${now.toISOString().slice(0, 10)}-${Math.floor(now.getUTCHours() / 6)}`;
    discoveryJob = await blogAutomationRepository.createJob({
      origin: 'autopilot',
      payload: { jobType: 'discover_trends', feedUrls: settings.approved_feed_urls },
      idempotencyKey: blogJobIdempotencyKey({ origin: 'autopilot', topic: 'scheduled-discovery', dateBucket: sixHourBucket }),
    });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: { publishedCount: publishedIds.length, publishedIds, discoveryJobId: discoveryJob?.id || null } });
});
apiRouter.get('/blog/scheduler/run', runBlogScheduler);
apiRouter.post('/blog/scheduler/run', runBlogScheduler);

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
  res.json({ success: true, data: { overview, jobs, discoveries, provider: { provider: 'NVIDIA NIM', enabled: Boolean(settings.provider_enabled), configured: Boolean(settings.provider_last_success_at), model: NVIDIA_DEFAULT_BLOG_MODEL, baseUrlHost: 'integrate.api.nvidia.com', health: settings.provider_last_error_code ? 'attention required' : settings.provider_last_success_at ? 'connected' : 'not tested', lastSuccessAt: settings.provider_last_success_at || null, lastErrorCode: settings.provider_last_error_code || '', lastDurationMs: settings.provider_last_duration_ms ?? null, liveVerificationStatus: settings.provider_live_verification_status || 'not_run' } } });
}));

apiRouter.post('/admin/blog/provider/test', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const job = await blogAutomationRepository.createJob({ origin: 'admin_manual', topic: 'NVIDIA provider connectivity test', requestedBy: requester.userId, payload: { jobType: 'provider_test' }, idempotencyKey: blogJobIdempotencyKey({ origin: 'admin_manual', topic: 'nvidia-provider-test', dateBucket: new Date().toISOString().slice(0, 16) }) });
  await logBlogAction(requester.userId, 'queue_blog_provider_test', 'nvidia_nim', { jobId: job.id });
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(202).json({ success: true, data: { result: { status: 'queued', model: NVIDIA_DEFAULT_BLOG_MODEL, host: 'integrate.api.nvidia.com', durationMs: null, errorCode: null }, job } });
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
  if (feedUrls.some((value) => { try { return new URL(value).protocol !== 'https:'; } catch { return true; } })) throw new ApiError('INVALID_BLOG_FEED', 'Approved feeds must use valid public HTTPS URLs.', 400);
  const timezone = String(req.body?.timezone || 'UTC');
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); } catch { throw new ApiError('INVALID_TIMEZONE', 'Enter a valid IANA timezone.', 400); }
  const settings = await blogAutomationRepository.updateSettings({ ...req.body, timezone, approved_feed_urls: feedUrls }, requester.userId);
  await logBlogAction(requester.userId, 'update_blog_autopilot_settings', 'default', { enabled: settings.enabled, timezone });
  res.json({ success: true, data: { settings } });
}));

apiRouter.post('/admin/blog/jobs', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const mode = String(req.body?.mode || 'manual');
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
    },
    idempotencyKey: blogJobIdempotencyKey({ origin, topic, customHeadline: headline, dateBucket }),
  });
  await logBlogAction(requester.userId, 'queue_blog_job', job.id, { origin, mode, batchId: null });
  res.status(202).json({ success: true, data: { job } });
}));

apiRouter.post('/admin/blog/jobs/:id/retry', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const job = await blogAutomationRepository.retryJob(req.params.id);
  if (!job) throw new ApiError('BLOG_JOB_NOT_RETRYABLE', 'This job is not in a retryable state.', 409);
  await logBlogAction(requester.userId, 'retry_blog_job', job.id, { provider: job.provider, model: job.model });
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
  const idempotencyKey = blogJobIdempotencyKey({ origin: 'editor_update', topic: `${existing.id}:${sectionKey}:${sectionAction}`, dateBucket: String(existing.updatedAt) });
  const job = await blogAutomationRepository.createJob({ origin: 'editor_update', topic: existing.title, requestedBy: requester.userId, payload: { jobType: 'regenerate_section', articleId: existing.id, sectionKey, sectionAction }, idempotencyKey });
  await logBlogAction(requester.userId, 'queue_blog_section_regeneration', existing.id, { jobId: job.id, sectionKey, sectionAction });
  res.status(202).json({ success: true, data: { job } });
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
  const resourceAudit = await auditRepository.getAudit(auditId);
  if (!resourceAudit || !(await canAccessAudit(req, resourceAudit))) throw new ApiError('AUDIT_NOT_FOUND', 'Audit not found.', 404);
  const audit = typeof auditStore.getAudit === 'function' ? auditStore.getAudit(auditId) : auditStore.getJob(auditId);
  
  if (!audit) {
    return res.status(404).json({ success: false, error: 'Audit not found' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  
  const sendEvent = (eventType, data) => {
    res.write(`event: ${eventType}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Send existing history
  const history = typeof auditStore.getAuditEvents === 'function' ? auditStore.getAuditEvents(auditId) : [];
  for (const ev of history) {
    sendEvent('audit-event', ev);
  }

  // Subscribe to new events
  const onEvent = (ev) => {
    sendEvent('audit-event', ev);
    if (ev.type === 'audit_completed') {
      sendEvent('audit-complete', { auditId, resultAvailable: true });
    } else if (ev.type === 'audit_failed') {
      sendEvent('audit-error', { auditId, error: ev.message });
    }
  };

  if (typeof auditStore.subscribeToAudit === 'function') {
    auditStore.subscribeToAudit(auditId, onEvent);
  }

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    if (typeof auditStore.unsubscribeFromAudit === 'function') {
      auditStore.unsubscribeFromAudit(auditId, onEvent);
    }
  });
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
  await auditRepository.cancelAudit(req.params.id);
  res.json({ success: true, data: { auditId: req.params.id, status: 'cancelled' } });
}));

apiRouter.get('/audit/result/:id', asyncJsonRoute(async (req, res) => {
  const liveData = await auditRepository.getLiveData(req.params.id);
  if (!liveData.audit || !(await canAccessAudit(req, liveData.audit))) throw new ApiError('AUDIT_NOT_FOUND', 'Audit not found.', 404);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: liveData });
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
    res.setHeader('Content-Disposition', `attachment; filename="seointel-${safeHost}-audit.pdf"`);
    res.setHeader('Content-Length', String(pdf.length));
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(pdf);
  }

  if (format === 'json') {
    return res.json({ success: true, data: liveData.finalReport || liveData });
  }

  if (format === 'issues.csv') {
    const header = 'severity,category,title,affectedUrl,evidence,recommendation\n';
    const rows = liveData.latestIssues.map((issue) => [issue.severity, issue.category, issue.title, issue.affectedUrl, issue.evidence, issue.recommendation]
      .map((value) => `"${String(value || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send(header + rows);
  }

  if (format === 'pages.csv') {
    const header = 'statusCode,url,responseTimeMs,pageSizeBytes,title,wordCount,crawlDepth,issueCount\n';
    const rows = liveData.latestPages.map((page) => [page.statusCode, page.url, page.responseTimeMs, page.pageSizeBytes, page.title, page.wordCount, page.crawlDepth, page.issueCount]
      .map((value) => `"${String(value || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send(header + rows);
  }

  return res.status(400).json({ success: false, error: 'Unsupported export format' });
}));

apiRouter.post('/audit/rerun/:id', asyncJsonRoute((_req, res) => res.status(409).json({ success: false, error: 'Rerun is disabled for worker-backed audits. Start a new audit instead.' })));

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
