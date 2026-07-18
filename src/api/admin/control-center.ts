import { Router } from 'express';
import { ApiError } from '../../lib/api/errors';
import {
  ADMIN_BULK_AUDIT_MAX,
  boundedPageSize,
  canApplyAuditAction,
  decodeAdminCursor,
  encodeAdminCursor,
  getUserActionGuard,
  normalizeAdminResourceLinks,
  retentionFingerprint,
  retentionPreviewIsUsable,
  RETENTION_PREVIEW_TTL_MS,
  rowsToCsv,
  validateBulkAuditSelection,
  type AdminAuditBulkAction,
  type AdminUserRole,
} from '../../lib/admin/control-center';
import {
  invalidateAdminReadCache,
  readCachedAdminData,
} from '../../lib/admin/read-cache';
import {
  ensureUserProfileFromAuthUser,
  getAuthenticatedUserFromRequest,
} from '../../lib/billing/entitlements';
import { API_SCHEMA_VERSION, getCommitIdentifier } from '../../lib/platform/version';
import { requireSupabaseAdminClient } from '../../lib/supabase/server';

type AdminRequester = {
  userId: string;
  email: string | null;
};

const router = Router();
const USER_LIST_FIELDS = 'id,email,username,display_name,full_name,role,plan,subscription_status,audit_quota_used_daily,audit_quota_used_monthly,quota_reset_daily_at,quota_reset_monthly_at,disabled,disabled_at,disabled_by,disabled_reason,deletion_requested_at,created_at,updated_at';
const AUDIT_LIST_FIELDS = 'id,user_id,guest_key_hash,normalized_url,status,plan,requested_mode,effective_mode,queue_priority,current_phase,pages_discovered,pages_crawled,checks_total,checks_completed,issues_found,critical_count,high_count,medium_count,low_count,locked_by,lease_expires_at,error,created_at,updated_at,started_at,completed_at';
const ACTIVE_BLOG_JOB_STATES = ['queued', 'discovering', 'researching', 'briefing', 'drafting', 'validating', 'checking_originality', 'optimising', 'sourcing_images', 'prerendering', 'publishing'];
const ADMIN_CACHE_TTL = {
  overview: 10_000,
  workers: 10_000,
  plans: 60_000,
  settings: 60_000,
  contentHealth: 30_000,
  resources: 60_000,
} as const;

function asyncAdminRoute(handler: (req: any, res: any, requester: AdminRequester) => Promise<void>) {
  return async (req: any, res: any, next: any) => {
    try {
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      const authUser = await getAuthenticatedUserFromRequest(req);
      if (!authUser) throw new ApiError('AUTHENTICATION_REQUIRED', 'Authentication is required.', 401);
      req.requesterUserId = authUser.id;
      const profile = await ensureUserProfileFromAuthUser(authUser);
      if (profile.disabled) throw new ApiError('ACCOUNT_SUSPENDED', 'This account is suspended.', 403);
      if (profile.role !== 'admin') throw new ApiError('ADMIN_ACCESS_REQUIRED', 'Administrator access is required.', 403);
      await handler(req, res, { userId: authUser.id, email: authUser.email ?? null });
    } catch (error) {
      next(error);
    }
  };
}

function normalizedSearch(value: unknown) {
  return String(value || '')
    .trim()
    .slice(0, 100)
    .replace(/[(),]/g, ' ')
    .replace(/[%_]/g, '\\$&');
}

function requiredReason(value: unknown) {
  const reason = String(value || '').trim();
  if (reason.length < 4 || reason.length > 500) {
    throw new ApiError('ADMIN_REASON_REQUIRED', 'Provide a reason between 4 and 500 characters.', 400);
  }
  return reason;
}

function integerRange(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
}

async function cachedAdminResponse<T>(
  res: any,
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
) {
  const result = await readCachedAdminData(key, ttlMs, loader);
  res.setHeader('X-Crawlio-Admin-Cache', result.status);
  return result.value;
}

async function logAdminAction(
  adminUserId: string,
  action: string,
  targetType: string,
  targetId: string,
  reason: string,
  before: unknown,
  after: unknown,
) {
  const client = requireSupabaseAdminClient();
  const { error } = await client.from('admin_actions').insert({
    admin_user_id: adminUserId,
    action,
    target_type: targetType,
    target_id: targetId,
    metadata: { reason, before, after },
  });
  if (error) throw error;
}

function mapUser(row: any) {
  return {
    id: row.id,
    email: row.email ?? null,
    username: row.username ?? null,
    displayName: row.display_name ?? row.full_name ?? null,
    role: row.role,
    plan: row.plan,
    subscriptionStatus: row.subscription_status,
    quota: {
      dailyUsed: Number(row.audit_quota_used_daily || 0),
      monthlyUsed: Number(row.audit_quota_used_monthly || 0),
      dailyResetAt: row.quota_reset_daily_at ?? null,
      monthlyResetAt: row.quota_reset_monthly_at ?? null,
    },
    disabled: Boolean(row.disabled),
    disabledAt: row.disabled_at ?? null,
    disabledReason: row.disabled_reason ?? null,
    deletionRequestedAt: row.deletion_requested_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAudit(row: any) {
  return {
    id: row.id,
    userId: row.user_id ?? null,
    ownerType: row.user_id ? 'user' : 'guest',
    normalizedUrl: row.normalized_url,
    status: row.status,
    plan: row.plan,
    requestedMode: row.requested_mode,
    effectiveMode: row.effective_mode,
    queuePriority: Number(row.queue_priority || 0),
    currentPhase: row.current_phase,
    pagesDiscovered: Number(row.pages_discovered || 0),
    pagesCrawled: Number(row.pages_crawled || 0),
    checksTotal: Number(row.checks_total || 0),
    checksCompleted: Number(row.checks_completed || 0),
    issuesFound: Number(row.issues_found || 0),
    criticalCount: Number(row.critical_count || 0),
    highCount: Number(row.high_count || 0),
    leaseExpiresAt: row.lease_expires_at ?? null,
    hasError: Boolean(row.error),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
  };
}

function nextCursor(rows: any[]) {
  const last = rows.at(-1);
  return last ? encodeAdminCursor(last.created_at, last.id) : null;
}

function failureCategory(row: any) {
  const phase = String(row.current_phase || '').toLowerCase();
  const error = String(row.error || '').toLowerCase();
  if (/timeout|timed out|abort/.test(error)) return 'timeout';
  if (/dns|enotfound|name resolution/.test(error)) return 'dns';
  if (/ssl|tls|certificate/.test(error)) return 'tls';
  if (/rate|429|too many/.test(error)) return 'rate_limited';
  if (/lease|stale/.test(phase) || row.status === 'abandoned') return 'worker_lease';
  if (/report/.test(phase)) return 'report_generation';
  return 'other';
}

router.get('/overview', asyncAdminRoute(async (req, res) => {
  const range = ['24h', '7d', '30d'].includes(String(req.query.range)) ? String(req.query.range) : '24h';
  const hours = range === '30d' ? 720 : range === '7d' ? 168 : 24;
  const data = await cachedAdminResponse(res, `overview:${range}`, ADMIN_CACHE_TTL.overview, async () => {
    const client = requireSupabaseAdminClient();
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const planNames = ['free', 'paid', 'agency', 'admin'];
    const [timeSeriesResult, recentAuditsResult, workersResult, deploymentsResult, planUseResult] = await Promise.all([
      client.rpc('admin_operations_timeseries', { p_window_hours: hours }),
      client.from('audits').select('status,current_phase,error').gte('created_at', since).order('created_at', { ascending: false }).limit(1000),
      client.from('platform_settings').select('id,key,value,updated_at').like('key', 'audit_worker:%').order('updated_at', { ascending: false }).limit(20),
      client.from('deployment_versions').select('component,application_version,commit_identifier,api_schema_version,audit_engine_version,scoring_version,updated_at'),
      client.rpc('admin_user_plan_distribution'),
    ]);

    const error = [
      timeSeriesResult.error,
      recentAuditsResult.error,
      workersResult.error,
      deploymentsResult.error,
      planUseResult.error,
    ].find(Boolean);
    if (error) throw error;

    const failures: Record<string, number> = {};
    (recentAuditsResult.data || [])
      .filter((row: any) => ['failed', 'abandoned', 'cancelled'].includes(row.status))
      .forEach((row: any) => {
        const category = failureCategory(row);
        failures[category] = (failures[category] || 0) + 1;
      });

    const series = (timeSeriesResult.data || []).map((row: any) => ({
      bucket: row.bucket,
      queued: Number(row.queued || 0),
      running: Number(row.running || 0),
      completed: Number(row.completed || 0),
      failed: Number(row.failed || 0),
      averageDurationSeconds: row.average_duration_seconds == null ? null : Number(row.average_duration_seconds),
      pagesCrawled: Number(row.pages_crawled || 0),
    }));
    const totals = series.reduce((summary: any, row: any) => ({
      queued: summary.queued + row.queued,
      running: summary.running + row.running,
      completed: summary.completed + row.completed,
      failed: summary.failed + row.failed,
      pagesCrawled: summary.pagesCrawled + row.pagesCrawled,
    }), { queued: 0, running: 0, completed: 0, failed: 0, pagesCrawled: 0 });
    const finished = totals.completed + totals.failed;
    const planUse = Object.fromEntries(planNames.map((plan) => [plan, 0]));
    for (const row of planUseResult.data || []) {
      if (planNames.includes(row.plan)) planUse[row.plan] = Number(row.account_count || 0);
    }

    return {
      range,
      totals: {
        ...totals,
        activeUsers: Object.values(planUse).reduce((sum: number, count) => sum + Number(count), 0),
        completionRate: finished ? Math.round((totals.completed / finished) * 1000) / 10 : null,
      },
      planUse,
      failureCategories: Object.entries(failures).map(([category, count]) => ({ category, count })),
      timeSeries: series,
      workers: workersResult.data || [],
      deployments: deploymentsResult.data || [],
    };
  });
  res.json({ success: true, data });
}));

router.get('/workers', asyncAdminRoute(async (_req, res) => {
  const data = await cachedAdminResponse(res, 'workers', ADMIN_CACHE_TTL.workers, async () => {
    const client = requireSupabaseAdminClient();
    const result = await client
      .from('platform_settings')
      .select('id,key,value,updated_at')
      .like('key', 'audit_worker:%')
      .order('updated_at', { ascending: false })
      .limit(50);
    if (result.error) throw result.error;
    return { items: result.data || [] };
  });
  res.json({ success: true, data });
}));

router.get('/plans', asyncAdminRoute(async (_req, res) => {
  const data = await cachedAdminResponse(res, 'plans', ADMIN_CACHE_TTL.plans, async () => {
    const client = requireSupabaseAdminClient();
    const result = await client.from('plan_limits').select('*').order('priority', { ascending: true });
    if (result.error) throw result.error;
    return { items: result.data || [] };
  });
  res.json({ success: true, data });
}));

router.get('/platform-settings', asyncAdminRoute(async (_req, res) => {
  const data = await cachedAdminResponse(res, 'platform-settings', ADMIN_CACHE_TTL.settings, async () => {
    const client = requireSupabaseAdminClient();
    const result = await client.from('platform_settings').select('id,key,platform_name,support_email,require_email_verification,public_registration,value,updated_at').eq('id', 'settings').maybeSingle();
    if (result.error) throw result.error;
    return { settings: result.data || null };
  });
  res.json({ success: true, data });
}));

router.get('/users', asyncAdminRoute(async (req, res) => {
  const client = requireSupabaseAdminClient();
  const limit = boundedPageSize(req.query.limit);
  const cursor = decodeAdminCursor(req.query.cursor);
  const search = normalizedSearch(req.query.query);
  const role = ['user', 'support', 'admin'].includes(String(req.query.role)) ? String(req.query.role) : '';
  const plan = ['free', 'paid', 'agency', 'admin'].includes(String(req.query.plan)) ? String(req.query.plan) : '';
  const status = ['active', 'suspended', 'deletion_requested'].includes(String(req.query.status)) ? String(req.query.status) : '';

  let query = client.from('user_profiles').select(USER_LIST_FIELDS, { count: 'planned' });
  if (search) query = query.or(`email.ilike.%${search}%,username.ilike.%${search}%,display_name.ilike.%${search}%,full_name.ilike.%${search}%`);
  if (role) query = query.eq('role', role);
  if (plan) query = query.eq('plan', plan);
  if (status === 'active') query = query.eq('disabled', false);
  if (status === 'suspended') query = query.eq('disabled', true);
  if (status === 'deletion_requested') query = query.not('deletion_requested_at', 'is', null);
  if (cursor) query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  const { data, error, count } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
  if (error) throw error;
  const rows = data || [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  let deletionRequests;
  if (!cursor) {
    const deletionResult = await client
      .from('account_deletion_requests')
      .select('id,user_id,requester_email,status,request_source,failure_code,requested_at,updated_at')
      .eq('request_source', 'self_service')
      .in('status', ['requested', 'processing', 'failed'])
      .order('requested_at', { ascending: false })
      .limit(20);
    if (deletionResult.error) throw deletionResult.error;
    deletionRequests = deletionResult.data || [];
  }

  res.json({
    success: true,
    data: {
      items: page.map(mapUser),
      total: count || 0,
      totalIsEstimate: true,
      nextCursor: hasMore ? nextCursor(page) : null,
      ...(deletionRequests ? { deletionRequests } : {}),
    },
  });
}));

router.get('/users/:id', asyncAdminRoute(async (req, res) => {
  const client = requireSupabaseAdminClient();
  const [profileResult, auditsResult, projectsResult, notesResult, deletionResult, authResult] = await Promise.all([
    client.from('user_profiles').select(USER_LIST_FIELDS).eq('id', req.params.id).maybeSingle(),
    client.from('audits').select(AUDIT_LIST_FIELDS).eq('user_id', req.params.id).order('created_at', { ascending: false }).limit(12),
    client.from('projects').select('id', { count: 'exact', head: true }).eq('user_id', req.params.id),
    client.from('admin_user_notes').select('id,note,admin_user_id,created_at').eq('user_id', req.params.id).order('created_at', { ascending: false }).limit(25),
    client.from('account_deletion_requests').select('id,status,request_source,failure_code,requested_at,processing_started_at,completed_at,updated_at').eq('user_id', req.params.id).order('requested_at', { ascending: false }).limit(5),
    client.auth.admin.getUserById(req.params.id),
  ]);
  const error = [profileResult.error, auditsResult.error, projectsResult.error, notesResult.error, deletionResult.error].find(Boolean);
  if (error) throw error;
  if (!profileResult.data) throw new ApiError('USER_NOT_FOUND', 'User not found.', 404);

  const authUser = authResult.data?.user;
  res.json({
    success: true,
    data: {
      user: mapUser(profileResult.data),
      account: {
        emailConfirmedAt: authUser?.email_confirmed_at ?? null,
        lastSignInAt: authUser?.last_sign_in_at ?? null,
        bannedUntil: authUser?.banned_until ?? null,
      },
      projectCount: projectsResult.count || 0,
      recentAudits: (auditsResult.data || []).map(mapAudit),
      notes: notesResult.data || [],
      deletionRequests: deletionResult.data || [],
    },
  });
}));

router.post('/users/:id/action', asyncAdminRoute(async (req, res, requester) => {
  const client = requireSupabaseAdminClient();
  const action = String(req.body?.action || '');
  const reason = requiredReason(req.body?.reason);
  const guardedActions = new Set(['suspend', 'restore', 'update_access', 'process_deletion']);
  if (!guardedActions.has(action) && !['reset_quota', 'add_note'].includes(action)) {
    throw new ApiError('UNSUPPORTED_ADMIN_ACTION', 'This user action is not supported.', 400);
  }
  if (action === 'suspend' && req.body?.confirmation !== 'SUSPEND') {
    throw new ApiError('SUSPENSION_CONFIRMATION_REQUIRED', 'Type SUSPEND to confirm this action.', 400);
  }
  if (action === 'process_deletion' && req.body?.confirmation !== 'DELETE ACCOUNT') {
    throw new ApiError('DELETION_CONFIRMATION_REQUIRED', 'Type DELETE ACCOUNT to confirm this action.', 400);
  }

  const { data: target, error: targetError } = await client.from('user_profiles').select(USER_LIST_FIELDS).eq('id', req.params.id).maybeSingle();
  if (targetError) throw targetError;
  const { count: activeAdminCount, error: countError } = await client.from('user_profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('disabled', false);
  if (countError) throw countError;

  if (action === 'process_deletion') {
    const { data: deletionRequest, error: requestError } = await client
      .from('account_deletion_requests')
      .select('*')
      .eq('user_id', req.params.id)
      .eq('request_source', 'self_service')
      .in('status', ['requested', 'failed'])
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (requestError) throw requestError;
    if (!deletionRequest) {
      throw new ApiError('DELETION_REQUEST_REQUIRED', 'This account has no user-requested deletion to process.', 409);
    }
    const guard = getUserActionGuard({
      actorId: requester.userId,
      targetId: req.params.id,
      targetRole: (target?.role || 'user') as AdminUserRole,
      activeAdminCount: activeAdminCount || 0,
      action: 'process_deletion',
    });
    if (!guard.allowed) throw new ApiError(guard.code, guard.message, 409);

    const startedAt = new Date().toISOString();
    const processingUpdate = await client.from('account_deletion_requests').update({
      status: 'processing',
      processing_started_at: startedAt,
      processed_by: requester.userId,
      failure_code: null,
      failure_message: null,
    }).eq('id', deletionRequest.id).in('status', ['requested', 'failed']).select('id').maybeSingle();
    if (processingUpdate.error) throw processingUpdate.error;
    if (!processingUpdate.data) {
      throw new ApiError('DELETION_REQUEST_STATE_CONFLICT', 'This deletion request is already being processed.', 409);
    }

    try {
      await client.from('admin_user_notes').delete().eq('user_id', req.params.id);
      const cleanup = await client.rpc('delete_user_owned_data', { p_user_id: req.params.id });
      if (cleanup.error) throw cleanup.error;
      const authDelete = await client.auth.admin.deleteUser(req.params.id);
      if (authDelete.error && authDelete.error.status !== 404) throw authDelete.error;
      await client.from('account_deletion_requests').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      }).eq('id', deletionRequest.id);
      invalidateAdminReadCache('overview:', 'resources');
      await logAdminAction(requester.userId, 'process_account_deletion', 'user', req.params.id, reason, { requestId: deletionRequest.id }, { completed: true });
      res.json({ success: true, data: { userId: req.params.id, requestId: deletionRequest.id, completed: true } });
    } catch (error) {
      await client.from('account_deletion_requests').update({
        status: 'failed',
        failure_code: 'ACCOUNT_DELETION_FAILED',
        failure_message: 'The deletion could not be completed. Review server diagnostics before retrying.',
      }).eq('id', deletionRequest.id);
      throw error;
    }
    return;
  }

  if (!target) throw new ApiError('USER_NOT_FOUND', 'User not found.', 404);
  if (guardedActions.has(action)) {
    const guard = getUserActionGuard({
      actorId: requester.userId,
      targetId: target.id,
      targetRole: target.role,
      activeAdminCount: activeAdminCount || 0,
      action: action as 'suspend' | 'restore' | 'update_access',
      nextRole: req.body?.patch?.role as AdminUserRole | undefined,
    });
    if (!guard.allowed) throw new ApiError(guard.code, guard.message, 409);
  }

  if (action === 'add_note') {
    const note = String(req.body?.note || '').trim();
    if (note.length < 4 || note.length > 4000) throw new ApiError('INVALID_ADMIN_NOTE', 'Notes must contain 4 to 4,000 characters.', 400);
    const { data, error } = await client.from('admin_user_notes').insert({
      user_id: target.id,
      admin_user_id: requester.userId,
      note,
    }).select('id,note,admin_user_id,created_at').single();
    if (error) throw error;
    await logAdminAction(requester.userId, 'add_user_note', 'user', target.id, reason, null, { noteId: data.id });
    res.json({ success: true, data });
    return;
  }

  if (action === 'reset_quota') {
    const before = { daily: target.audit_quota_used_daily, monthly: target.audit_quota_used_monthly };
    const { error } = await client.from('user_profiles').update({
      audit_quota_used_daily: 0,
      audit_quota_used_monthly: 0,
      updated_at: new Date().toISOString(),
    }).eq('id', target.id);
    if (error) throw error;
    await logAdminAction(requester.userId, 'reset_user_quota', 'user', target.id, reason, before, { daily: 0, monthly: 0 });
    res.json({ success: true, data: { userId: target.id, quota: { daily: 0, monthly: 0 } } });
    return;
  }

  if (action === 'update_access') {
    const allowed = {
      role: new Set(['user', 'support', 'admin']),
      plan: new Set(['free', 'paid', 'agency', 'admin']),
      subscription_status: new Set(['inactive', 'trialing', 'active', 'past_due', 'cancelled']),
    };
    const patch: Record<string, string> = {};
    for (const [key, values] of Object.entries(allowed)) {
      if (key in (req.body?.patch || {})) {
        const value = String(req.body.patch[key]);
        if (!values.has(value)) throw new ApiError('INVALID_ADMIN_UPDATE', `Invalid ${key.replace(/_/g, ' ')} value.`, 400);
        patch[key] = value;
      }
    }
    if (!Object.keys(patch).length) throw new ApiError('EMPTY_ADMIN_UPDATE', 'No supported access fields were provided.', 400);
    const before = { role: target.role, plan: target.plan, subscription_status: target.subscription_status };
    const { error } = await client.from('user_profiles').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', target.id);
    if (error) throw error;
    invalidateAdminReadCache('overview:');
    await logAdminAction(requester.userId, 'update_user_access', 'user', target.id, reason, before, patch);
    res.json({ success: true, data: { userId: target.id, before, after: patch } });
    return;
  }

  if (action === 'suspend' || action === 'restore') {
    const suspend = action === 'suspend';
    const authUpdate = await client.auth.admin.updateUserById(target.id, { ban_duration: suspend ? '876000h' : 'none' });
    if (authUpdate.error) throw authUpdate.error;
    const patch = suspend
      ? { disabled: true, disabled_at: new Date().toISOString(), disabled_by: requester.userId, disabled_reason: reason }
      : { disabled: false, disabled_at: null, disabled_by: null, disabled_reason: null };
    const { error } = await client.from('user_profiles').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', target.id);
    if (error) {
      await client.auth.admin.updateUserById(target.id, { ban_duration: suspend ? 'none' : '876000h' });
      throw error;
    }
    invalidateAdminReadCache('overview:');
    await logAdminAction(requester.userId, suspend ? 'suspend_user' : 'restore_user', 'user', target.id, reason, { disabled: target.disabled }, patch);
    res.json({ success: true, data: { userId: target.id, disabled: suspend } });
    return;
  }

}));

router.get('/audits', asyncAdminRoute(async (req, res) => {
  const client = requireSupabaseAdminClient();
  const limit = boundedPageSize(req.query.limit);
  const cursor = decodeAdminCursor(req.query.cursor);
  const search = normalizedSearch(req.query.query);
  const status = String(req.query.status || '');
  const plan = String(req.query.plan || '');
  const mode = String(req.query.mode || '');
  let query = client.from('audits').select(AUDIT_LIST_FIELDS, { count: 'planned' });
  if (search) query = query.ilike('normalized_url', `%${search}%`);
  if (['queued', 'running', 'completed', 'completed_with_warnings', 'failed', 'cancelled', 'abandoned'].includes(status)) query = query.eq('status', status);
  if (['free', 'paid', 'agency', 'admin'].includes(plan)) query = query.eq('plan', plan);
  if (['quick', 'standard', 'deep'].includes(mode)) query = query.eq('effective_mode', mode);
  if (cursor) query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  const { data, error, count } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
  if (error) throw error;
  const rows = data || [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  res.json({
    success: true,
    data: {
      items: page.map(mapAudit),
      total: count || 0,
      totalIsEstimate: true,
      nextCursor: hasMore ? nextCursor(page) : null,
      bulkLimit: ADMIN_BULK_AUDIT_MAX,
    },
  });
}));

router.post('/audits/bulk-action', asyncAdminRoute(async (req, res, requester) => {
  const selection = validateBulkAuditSelection(req.body?.auditIds);
  if (!selection.valid) throw new ApiError(selection.code, selection.message, 400);
  const reason = requiredReason(req.body?.reason);
  const action = String(req.body?.action || '') as AdminAuditBulkAction;
  if (!['cancel', 'retry', 'recover_stale', 'priority'].includes(action)) {
    throw new ApiError('UNSUPPORTED_ADMIN_ACTION', 'This bulk audit action is not supported.', 400);
  }
  const client = requireSupabaseAdminClient();
  const { data: audits, error } = await client.from('audits').select(AUDIT_LIST_FIELDS).in('id', selection.ids);
  if (error) throw error;
  if ((audits || []).length !== selection.ids.length) throw new ApiError('AUDIT_NOT_FOUND', 'One or more selected audits no longer exist.', 404);
  const invalid = (audits || []).filter((audit: any) => !canApplyAuditAction(audit.status, action, audit.lease_expires_at));
  if (invalid.length) {
    throw new ApiError('AUDIT_STATE_CONFLICT', `${invalid.length} selected audit(s) cannot accept this action in their current state.`, 409);
  }

  const priority = integerRange(req.body?.queuePriority, 0, 1000, 50);
  const now = new Date().toISOString();
  const patch = action === 'cancel'
    ? { status: 'cancelled', current_phase: 'Cancelled by administrator', cancelled_at: now, locked_by: null, locked_at: null, lease_expires_at: null }
    : action === 'priority'
      ? { queue_priority: priority }
      : { status: 'queued', current_phase: action === 'retry' ? 'Retry queued' : 'Recovered and requeued', error: null, progress: 0, locked_by: null, locked_at: null, lease_expires_at: null, completed_at: null, cancelled_at: null };
  const operation = await client.rpc('admin_bulk_audit_operation', {
    p_audit_ids: selection.ids,
    p_action: action,
    p_priority: action === 'priority' ? priority : null,
  });
  if (operation.error) {
    const message = String(operation.error.message || '');
    if (message.includes('AUDIT_STATE_CONFLICT')) {
      throw new ApiError('AUDIT_STATE_CONFLICT', 'One or more selected audits changed state before the action was applied.', 409);
    }
    if (message.includes('AUDIT_NOT_FOUND')) {
      throw new ApiError('AUDIT_NOT_FOUND', 'One or more selected audits no longer exist.', 404);
    }
    throw operation.error;
  }
  const updated = Array.isArray(operation.data?.updated) ? operation.data.updated : [];
  invalidateAdminReadCache('overview:', 'resources');
  await logAdminAction(requester.userId, `bulk_audit_${action}`, 'audit_batch', selection.ids.join(','), reason, {
    audits: (audits || []).map((audit: any) => ({ id: audit.id, status: audit.status, queuePriority: audit.queue_priority })),
  }, { patch: { ...patch, updated_at: now }, count: updated.length });
  res.json({ success: true, data: { action, updated } });
}));

router.get('/content-health', asyncAdminRoute(async (_req, res) => {
  const data = await cachedAdminResponse(res, 'content-health', ADMIN_CACHE_TTL.contentHealth, async () => {
    const client = requireSupabaseAdminClient();
    const [postsResult, jobsResult] = await Promise.all([
      client.from('blog_posts').select('id,title,slug,status,seo_title,meta_description,robots_directive,quality_status,originality_status,source_status,prerender_status,image_status,scheduled_at,published_at,updated_at,created_at').order('updated_at', { ascending: false }).limit(500),
      client.from('blog_generation_jobs').select('id,article_id,state,topic,attempt_count,max_attempts,error,lease_expires_at,scheduled_for,created_at,updated_at').order('updated_at', { ascending: false }).limit(300),
    ]);
    const error = postsResult.error || jobsResult.error;
    if (error) throw error;
    const now = Date.now();
    const items: any[] = [];

    for (const post of postsResult.data || []) {
      const ageDays = Math.floor((now - new Date(post.updated_at).getTime()) / 86_400_000);
      if (['draft', 'review', 'needs_review'].includes(post.status) && ageDays >= 7) {
        items.push({ kind: 'draft_review', severity: 'review', entity: 'post', id: post.id, title: post.title, detail: `Waiting for review for ${ageDays} days.`, action: 'open_post' });
      }
      if (post.status === 'scheduled' && post.scheduled_at && new Date(post.scheduled_at).getTime() < now) {
        items.push({ kind: 'overdue_schedule', severity: 'high', entity: 'post', id: post.id, title: post.title, detail: 'Scheduled publication time has passed.', action: 'hold_publication' });
      }
      const missing = [
        !String(post.slug || '').trim() && 'slug',
        !String(post.seo_title || '').trim() && 'SEO title',
        !String(post.meta_description || '').trim() && 'meta description',
      ].filter(Boolean);
      if (missing.length) {
        items.push({ kind: 'missing_seo', severity: 'high', entity: 'post', id: post.id, title: post.title, detail: `Missing ${missing.join(', ')}.`, action: 'open_post' });
      }
      const blocked = ['quality_status', 'originality_status', 'source_status', 'prerender_status'].filter((field) => ['blocked', 'needs_review'].includes(String((post as any)[field])));
      if (blocked.length) {
        items.push({ kind: 'publication_gate', severity: 'high', entity: 'post', id: post.id, title: post.title, detail: `Publication gates require review: ${blocked.map((field) => field.replace(/_/g, ' ')).join(', ')}.`, action: 'validate_post' });
      }
      if (['blocked', 'needs_review'].includes(post.image_status)) {
        items.push({ kind: 'image_licence', severity: 'review', entity: 'post', id: post.id, title: post.title, detail: 'Image or licence details require editorial review.', action: 'open_post' });
      }
      if (post.status === 'published' && post.published_at && now - new Date(post.published_at).getTime() > 180 * 86_400_000) {
        items.push({ kind: 'stale_article', severity: 'review', entity: 'post', id: post.id, title: post.title, detail: 'Published more than 180 days ago. Review accuracy and sources.', action: 'open_post' });
      }
    }

    for (const job of jobsResult.data || []) {
      const stale = ACTIVE_BLOG_JOB_STATES.includes(job.state) && now - new Date(job.updated_at).getTime() > 30 * 60_000;
      if (stale || job.state === 'failed') {
        items.push({
          kind: stale ? 'stalled_job' : 'failed_job',
          severity: 'high',
          entity: 'job',
          id: job.id,
          articleId: job.article_id,
          title: job.topic || 'Blog generation job',
          detail: stale ? 'No progress has been recorded for more than 30 minutes.' : 'The content job failed and may be eligible for recovery.',
          action: 'recover_job',
          recoverable: Number(job.attempt_count || 0) < Number(job.max_attempts || 0),
        });
      }
    }

    const counts = items.reduce((result: Record<string, number>, item) => {
      result[item.kind] = (result[item.kind] || 0) + 1;
      return result;
    }, {});
    return { counts, items: items.slice(0, 150), inspected: { posts: postsResult.data?.length || 0, jobs: jobsResult.data?.length || 0 } };
  });
  res.json({ success: true, data });
}));

router.post('/content-health/action', asyncAdminRoute(async (req, res, requester) => {
  const client = requireSupabaseAdminClient();
  const action = String(req.body?.action || '');
  const id = String(req.body?.id || '');
  const reason = requiredReason(req.body?.reason);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError('INVALID_CONTENT_ID', 'The content identifier is invalid.', 400);

  if (action === 'hold_publication') {
    const { data: before, error: readError } = await client.from('blog_posts').select('id,status,robots_directive').eq('id', id).maybeSingle();
    if (readError) throw readError;
    if (!before) throw new ApiError('BLOG_POST_NOT_FOUND', 'Blog post not found.', 404);
    const after = { status: 'needs_review', robots_directive: 'noindex,nofollow' };
    const { error } = await client.from('blog_posts').update({ ...after, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    invalidateAdminReadCache('content-health');
    await logAdminAction(requester.userId, 'hold_blog_publication', 'blog_post', id, reason, before, after);
    res.json({ success: true, data: { id, ...after } });
    return;
  }

  if (action === 'recover_job') {
    const { data: before, error: readError } = await client.from('blog_generation_jobs').select('id,state,attempt_count,max_attempts,updated_at').eq('id', id).maybeSingle();
    if (readError) throw readError;
    if (!before) throw new ApiError('BLOG_JOB_NOT_FOUND', 'Blog job not found.', 404);
    const stale = ACTIVE_BLOG_JOB_STATES.includes(before.state) && Date.now() - new Date(before.updated_at).getTime() > 30 * 60_000;
    if (!(before.state === 'failed' || stale) || Number(before.attempt_count || 0) >= Number(before.max_attempts || 0)) {
      throw new ApiError('BLOG_JOB_NOT_RECOVERABLE', 'This job is not currently eligible for recovery.', 409);
    }
    const after = { state: 'queued', locked_by: null, locked_at: null, lease_expires_at: null, error: '', scheduled_for: new Date().toISOString() };
    const { error } = await client.from('blog_generation_jobs').update({ ...after, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    invalidateAdminReadCache('content-health');
    await logAdminAction(requester.userId, 'recover_blog_job', 'blog_job', id, reason, before, after);
    res.json({ success: true, data: { id, ...after } });
    return;
  }

  if (action === 'validate_post') {
    const { data: post, error } = await client.from('blog_posts').select('id,title,slug,seo_title,meta_description,quality_status,originality_status,source_status,prerender_status,image_status').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!post) throw new ApiError('BLOG_POST_NOT_FOUND', 'Blog post not found.', 404);
    const findings = [
      !String(post.title || '').trim() && 'Title is missing.',
      !String(post.slug || '').trim() && 'Slug is missing.',
      !String(post.seo_title || '').trim() && 'SEO title is missing.',
      !String(post.meta_description || '').trim() && 'Meta description is missing.',
      ...['quality_status', 'originality_status', 'source_status', 'prerender_status', 'image_status']
        .filter((field) => ['blocked', 'needs_review'].includes(String((post as any)[field])))
        .map((field) => `${field.replace(/_/g, ' ')} requires review.`),
    ].filter(Boolean);
    await logAdminAction(requester.userId, 'validate_blog_post', 'blog_post', id, reason, null, { findingCount: findings.length });
    res.json({ success: true, data: { id, passed: findings.length === 0, findings } });
    return;
  }

  throw new ApiError('UNSUPPORTED_ADMIN_ACTION', 'This content action is not supported.', 400);
}));

router.get('/resources', asyncAdminRoute(async (_req, res) => {
  const data = await cachedAdminResponse(res, 'resources', ADMIN_CACHE_TTL.resources, async () => {
    const client = requireSupabaseAdminClient();
    const [inventoryResult, settingsResult, workersResult, deploymentsResult] = await Promise.all([
      client.rpc('admin_resource_inventory'),
      client.from('platform_settings').select('value,updated_at').eq('id', 'admin_resources').maybeSingle(),
      client.from('platform_settings').select('key,value,updated_at').like('key', 'audit_worker:%').order('updated_at', { ascending: false }).limit(10),
      client.from('deployment_versions').select('component,commit_identifier,application_version,api_schema_version,updated_at'),
    ]);
    const error = inventoryResult.error || settingsResult.error || workersResult.error || deploymentsResult.error;
    if (error) throw error;
    const currentCommit = getCommitIdentifier();
    const workerRows = workersResult.data || [];
    const latestWorker = workerRows[0];
    const databaseDeployment = (deploymentsResult.data || []).find((row: any) => row.component === 'database');
    const workerCommit = latestWorker?.value?.commitIdentifier || latestWorker?.value?.commit || null;

    return {
      inventory: (inventoryResult.data || []).map((row: any) => ({
        resourceName: row.resource_name,
        approximateRows: Number(row.approximate_rows || 0),
        totalBytes: Number(row.total_bytes || 0),
        oldestRecordAt: row.oldest_record_at,
        retentionPolicy: row.retention_policy,
        cleanupEligible: Number(row.cleanup_eligible || 0),
      })),
      serviceReadiness: {
        supabase: { configured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY), healthy: true },
        vercel: { configured: Boolean(process.env.VERCEL || process.env.VERCEL_URL), healthy: true },
        renderWorker: { configured: workerRows.length > 0, healthy: Boolean(latestWorker && Date.now() - new Date(latestWorker.updated_at).getTime() < 3 * 60_000) },
        sentry: { configured: Boolean(process.env.SENTRY_DSN || process.env.VITE_SENTRY_DSN), healthy: Boolean(process.env.SENTRY_DSN || process.env.VITE_SENTRY_DSN) },
        github: { configured: Boolean(settingsResult.data?.value?.github), healthy: null },
      },
      versions: {
        currentCommit,
        databaseCommit: databaseDeployment?.commit_identifier || null,
        workerCommit,
        databaseApiSchema: databaseDeployment?.api_schema_version ?? null,
        expectedApiSchema: API_SCHEMA_VERSION,
        matching: {
          database: databaseDeployment?.api_schema_version === API_SCHEMA_VERSION,
          worker: !workerCommit || workerCommit === currentCommit,
        },
      },
      links: settingsResult.data?.value || {},
      usageAvailability: {
        databaseStorage: 'provider-dashboard-only',
        realtimeQuota: 'provider-dashboard-only',
        deploymentUsage: 'provider-dashboard-only',
      },
    };
  });
  res.json({ success: true, data });
}));

router.post('/resources/links', asyncAdminRoute(async (req, res, requester) => {
  const client = requireSupabaseAdminClient();
  const reason = requiredReason(req.body?.reason);
  const links = normalizeAdminResourceLinks(req.body?.links);
  if (!links) throw new ApiError('INVALID_RESOURCE_LINK', 'Resource links must use an allowlisted HTTPS provider URL.', 400);
  const { data: before, error: readError } = await client.from('platform_settings').select('value').eq('id', 'admin_resources').maybeSingle();
  if (readError) throw readError;
  const row = {
    id: 'admin_resources',
    key: 'admin_resources',
    value: links,
    updated_at: new Date().toISOString(),
  };
  const { error } = await client.from('platform_settings').upsert(row, { onConflict: 'id' });
  if (error) throw error;
  invalidateAdminReadCache('resources');
  await logAdminAction(requester.userId, 'update_admin_resource_links', 'platform_settings', 'admin_resources', reason, before?.value || {}, links);
  res.json({ success: true, data: { links } });
}));

router.post('/retention/preview', asyncAdminRoute(async (req, res, requester) => {
  const client = requireSupabaseAdminClient();
  const reason = requiredReason(req.body?.reason);
  const previewResult = await client.rpc('run_data_retention_cleanup', { p_apply: false });
  if (previewResult.error) throw previewResult.error;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + RETENTION_PREVIEW_TTL_MS).toISOString();
  const fingerprint = retentionFingerprint(previewResult.data, requester.userId, createdAt);
  const { data, error } = await client.from('admin_operation_previews').insert({
    admin_user_id: requester.userId,
    operation: 'retention_cleanup',
    fingerprint,
    preview: previewResult.data,
    expires_at: expiresAt,
    reason,
    created_at: createdAt,
  }).select('id,preview,fingerprint,expires_at,created_at').single();
  if (error) throw error;
  await logAdminAction(requester.userId, 'preview_data_retention', 'retention', data.id, reason, null, { fingerprint, expiresAt });
  res.json({ success: true, data });
}));

router.post('/retention/apply', asyncAdminRoute(async (req, res, requester) => {
  const client = requireSupabaseAdminClient();
  const reason = requiredReason(req.body?.reason);
  const previewId = String(req.body?.previewId || '');
  if (!/^[0-9a-f-]{36}$/i.test(previewId)) throw new ApiError('INVALID_RETENTION_PREVIEW', 'The retention preview identifier is invalid.', 400);
  const { data: preview, error: previewError } = await client.from('admin_operation_previews').select('*').eq('id', previewId).eq('admin_user_id', requester.userId).maybeSingle();
  if (previewError) throw previewError;
  if (!preview) throw new ApiError('RETENTION_PREVIEW_NOT_FOUND', 'Retention preview not found.', 404);
  const expectedFingerprint = retentionFingerprint(preview.preview, preview.admin_user_id, preview.created_at);
  if (preview.fingerprint !== expectedFingerprint) {
    throw new ApiError('RETENTION_PREVIEW_INTEGRITY_FAILED', 'The stored retention preview failed its integrity check.', 409);
  }
  const validation = retentionPreviewIsUsable({
    expiresAt: preview.expires_at,
    appliedAt: preview.applied_at,
    expectedFingerprint,
    suppliedFingerprint: String(req.body?.fingerprint || ''),
    confirmation: String(req.body?.confirmation || ''),
    reason,
  });
  if (!validation.valid) throw new ApiError(validation.code, validation.message, 409);
  const claimedAt = new Date().toISOString();
  const claim = await client.from('admin_operation_previews').update({
    applied_at: claimedAt,
    reason,
  }).eq('id', preview.id).is('applied_at', null).select('id').maybeSingle();
  if (claim.error) throw claim.error;
  if (!claim.data) throw new ApiError('RETENTION_PREVIEW_ALREADY_USED', 'This retention preview has already been applied.', 409);

  const result = await client.rpc('run_data_retention_cleanup', { p_apply: true });
  if (result.error) {
    await client.from('admin_operation_previews').update({ apply_result: { applied: false, errorCode: 'RETENTION_APPLY_FAILED' } }).eq('id', preview.id);
    throw result.error;
  }
  await client.from('admin_operation_previews').update({ apply_result: result.data }).eq('id', preview.id);
  invalidateAdminReadCache('resources', 'overview:');
  await logAdminAction(requester.userId, 'apply_data_retention', 'retention', preview.id, reason, preview.preview, result.data);
  res.json({ success: true, data: { previewId: preview.id, appliedAt: claimedAt, result: result.data } });
}));

router.get('/actions', asyncAdminRoute(async (req, res) => {
  const client = requireSupabaseAdminClient();
  const limit = boundedPageSize(req.query.limit);
  const cursor = decodeAdminCursor(req.query.cursor);
  const search = normalizedSearch(req.query.query);
  let query = client.from('admin_actions').select('id,admin_user_id,action,target_type,target_id,metadata,created_at', { count: 'planned' });
  if (search) query = query.or(`action.ilike.%${search}%,target_type.ilike.%${search}%,target_id.ilike.%${search}%`);
  if (cursor) query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  const { data, error, count } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
  if (error) throw error;
  const rows = data || [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).map((row: any) => ({
    id: row.id,
    adminUserId: row.admin_user_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    summary: {
      reason: row.metadata?.reason || null,
      before: row.metadata?.before || null,
      after: row.metadata?.after || null,
    },
    createdAt: row.created_at,
  }));
  res.json({ success: true, data: { items: page, total: count || 0, totalIsEstimate: true, nextCursor: hasMore ? nextCursor(rows.slice(0, limit)) : null } });
}));

router.get('/exports/:dataset', asyncAdminRoute(async (req, res) => {
  const client = requireSupabaseAdminClient();
  const dataset = String(req.params.dataset || '');
  let rows: Array<Record<string, unknown>> = [];
  let columns: string[] = [];
  if (dataset === 'users') {
    const result = await client.from('user_profiles').select(USER_LIST_FIELDS).order('created_at', { ascending: false }).limit(5000);
    if (result.error) throw result.error;
    rows = (result.data || []).map((row: any) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      plan: row.plan,
      subscriptionStatus: row.subscription_status,
      suspended: row.disabled,
      deletionRequestedAt: row.deletion_requested_at,
      createdAt: row.created_at,
    }));
    columns = ['id', 'email', 'role', 'plan', 'subscriptionStatus', 'suspended', 'deletionRequestedAt', 'createdAt'];
  } else if (dataset === 'audits') {
    const result = await client.from('audits').select(AUDIT_LIST_FIELDS).order('created_at', { ascending: false }).limit(5000);
    if (result.error) throw result.error;
    rows = (result.data || []).map(mapAudit);
    columns = ['id', 'userId', 'ownerType', 'normalizedUrl', 'status', 'plan', 'requestedMode', 'effectiveMode', 'queuePriority', 'pagesDiscovered', 'pagesCrawled', 'checksTotal', 'checksCompleted', 'issuesFound', 'criticalCount', 'highCount', 'createdAt', 'completedAt'];
  } else if (dataset === 'actions') {
    const result = await client.from('admin_actions').select('id,admin_user_id,action,target_type,target_id,metadata,created_at').order('created_at', { ascending: false }).limit(5000);
    if (result.error) throw result.error;
    rows = (result.data || []).map((row: any) => ({
      id: row.id,
      adminUserId: row.admin_user_id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      reason: row.metadata?.reason || '',
      before: row.metadata?.before || null,
      after: row.metadata?.after || null,
      createdAt: row.created_at,
    }));
    columns = ['id', 'adminUserId', 'action', 'targetType', 'targetId', 'reason', 'before', 'after', 'createdAt'];
  } else {
    throw new ApiError('UNSUPPORTED_ADMIN_EXPORT', 'This administrator export is not supported.', 404);
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="crawlio-admin-${dataset}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(`\uFEFF${rowsToCsv(rows, columns)}`);
}));

export const adminControlCenterRouter = router;
