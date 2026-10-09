import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { requireSupabaseAdminClient } from '../../lib/supabase/server';
import { ApiError } from '../../lib/api/errors';
import { publicVersionPayload } from '../../lib/platform/version';
import { customerSafeDiagnosticText } from '../../lib/audit/audit-failures';
import { classifyOperationalFailure, csvCell, presentAdminOperations, safeAdminAction } from '../../lib/operations/admin-presentation';
import { resolveSentryBuildConfiguration } from '../../lib/monitoring/sentry-build';
import { durableRateLimit } from '../../lib/api/production-controls';
import { searchConsoleConfigured } from '../../lib/search-console/server';

type AdminGuard = (req: Request, res: Response) => Promise<unknown>;
type Actor = { userId: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pendingSummaries = new Map<string, { expires: number; promise: Promise<Record<string, any>> }>();

export async function operationRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireSupabaseAdminClient().rpc(name, args);
  if (error) {
    const code = error.message.match(/\b(?:ADMIN_REQUIRED|USER_NOT_FOUND|AUDIT_NOT_FOUND|PLAN_NOT_FOUND|CONFIGURATION_NOT_FOUND|ADMIN_REASON_REQUIRED|ADMIN_REQUEST_CONFLICT|AUDIT_NOT_STALE|AUDIT_NOT_CANCELLABLE|AUDIT_NOT_RETRYABLE|INVALID_QUEUE_PRIORITY|LEGACY_PRIORITY_UNSUPPORTED|ACTIVE_RETRY_EXISTS|ACTIVE_AUDIT_EXISTS|ACCOUNT_DISABLED|AUDIT_MODE_DISABLED|SCALABLE_AUDIT_UNAVAILABLE|QUEUE_FULL|CONFIRMATION_REQUIRED|PREVIEW_EXPIRED|PREVIEW_CHANGED|SELF_ROLE_CHANGE_FORBIDDEN|LAST_ADMIN_PROTECTED|INVALID_ADMIN_UPDATE|UNSUPPORTED_ADMIN_ACTION|INVALID_RANGE)\b/)?.[0];
    if (code) throw new ApiError(code, code.toLowerCase().replace(/_/g, ' ') + '. Refresh the record and review the action.', code === 'ADMIN_REQUIRED' ? 403 : /NOT_FOUND/.test(code) ? 404 : 409);
    throw new ApiError('ADMIN_OPERATIONS_UNAVAILABLE', 'Operations are unavailable. Verify migration 028 and database connectivity.', 503);
  }
  return data as T;
}

function recordId(value: unknown) {
  const id = String(value || '');
  if (!uuid.test(id)) throw new ApiError('INVALID_RECORD_ID', 'Choose a valid record.', 400);
  return id;
}

export function adminRequestId(req: Request) {
  const value: unknown = req.body?.requestId;
  if (value === undefined) return randomUUID();
  if (typeof value !== 'string' || !uuid.test(value)) throw new ApiError('INVALID_ADMIN_REQUEST_ID', 'Provide a valid request ID.', 400);
  return value;
}

export function adminReason(req: Request) {
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  const length = Array.from(reason).length;
  if (length < 4 || length > 500) throw new ApiError('ADMIN_REASON_REQUIRED', 'Provide a reason between 4 and 500 characters.', 400);
  return reason;
}

async function snapshot(actor: string, days: number) {
  // A short process-local single flight only; authorization still runs on every request.
  const key = `${actor}:${days}`;
  const old = pendingSummaries.get(key);
  if (old && old.expires > Date.now()) return old.promise;
  if (pendingSummaries.size > 20) pendingSummaries.clear();
  const promise = operationRpc<Record<string, any>>('admin_operations_snapshot', { p_actor: actor, p_days: days });
  pendingSummaries.set(key, { promise, expires: Date.now() + 5_000 });
  promise.catch(() => { pendingSummaries.delete(key); });
  return promise;
}

export function createAdminOperationsRouter(requireAdmin: AdminGuard) {
  const router = Router();
  const rateLimit = durableRateLimit({ namespace: 'admin-operations', limit: 120, windowSeconds: 60 });
  const endpoint = (handler: (req: Request, res: Response, actor: Actor) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const actor = await requireAdmin(req, res) as Actor | null;
      if (!actor) return;
      rateLimit(req, res, error => {
        if (error) next(error);
        else void handler(req, res, actor).catch(next);
      });
    } catch (error) { next(error); }
  };
  router.get('/operations', endpoint(async (req, res, actor) => {
    const range = String(req.query.range || '7d');
    if (!['24h', '7d', '30d'].includes(range)) throw new ApiError('INVALID_RANGE', 'Choose 24 hours, 7 days, or 30 days.', 400);
    const raw = await snapshot(actor.userId, range === '24h' ? 1 : range === '30d' ? 30 : 7);
    res.json({ success: true, data: presentAdminOperations(raw, publicVersionPayload()) });
  }));
  router.get('/diagnostics', endpoint(async (_req, res, actor) => {
    const client = requireSupabaseAdminClient();
    const [raw, errors, diagnostics] = await Promise.all([
      snapshot(actor.userId, 1),
      client.from('api_error_logs').select('request_id,route,method,internal_code,deployment_version,created_at').order('created_at', { ascending: false }).limit(25),
      client.from('audit_diagnostics').select('id,audit_id,affected_url,failure_code,phase,attempt_count,request_duration_ms,worker_id,created_at').order('created_at', { ascending: false }).limit(25),
    ]);
    if (errors.error || diagnostics.error) throw new ApiError('DIAGNOSTICS_UNAVAILABLE', 'Diagnostic history could not be loaded.', 503);
    const value = presentAdminOperations(raw, publicVersionPayload());
    const build = resolveSentryBuildConfiguration(process.env, process.env.NODE_ENV || 'production');
    res.json({ success: true, data: {
      compatibility: { compatible: value.deployment.compatible, status: value.deployment.compatible ? 'compatible' : 'unknown_or_mismatch' },
      operations: { ...value, activeWorkerCount: value.workers.filter((worker: any) => worker.state === 'healthy').length,
        workerOnline: value.components.worker.status === 'healthy', queuedAuditCount: value.queue.queued,
        oldestQueuedAgeSeconds: value.queue.oldestQueuedSeconds, recentCompletionRate: value.metrics.successRate == null ? null : value.metrics.successRate / 100,
        medianAuditDurationMs: value.metrics.medianDurationSeconds == null ? null : value.metrics.medianDurationSeconds * 1000,
        applicationCommit: value.deployment.applicationCommit, workerCommit: value.deployment.workerCommit,
        databaseSchemaVersion: value.deployment.databaseSchemaVersion, apiSchemaVersion: value.deployment.expectedSchemaVersion,
        lastWorkerHeartbeat: value.workers[0]?.lastSeenAt || null, deepAuditEnabled: value.workers.some((worker: any) => worker.deepAuditEnabled) },
      metrics: { ...value.metrics, ...value.queue, completedWithWarnings: value.metrics.warnings },
      monitoring: { browserConfigured: !!process.env.VITE_SENTRY_DSN, apiConfigured: !!process.env.SENTRY_DSN,
        workerConfigured: !!raw.workers?.some((row: any) => row.value?.sentryConfigured), sourceMapsConfigured: build.sourceMapsConfigured,
        environment: build.environment, searchConsoleConfigured: searchConsoleConfigured(),
        projectSchedulerConfigured: String(process.env.CRON_SECRET || '').length >= 24, canonicalAppUrlConfigured: /^https:\/\//.test(process.env.APP_URL || '') },
      recentApiErrors: errors.data, recentAuditDiagnostics: diagnostics.data,
      workers: value.workers, adminActions: value.recentActions,
      usageAvailability: { databaseStorage: 'provider-dashboard-only', realtime: 'provider-dashboard-only' },
    } });
  }));
  router.get('/users/:id/detail', endpoint(async (req, res, actor) => {
    res.json({ success: true, data: await operationRpc('admin_user_detail', { p_actor: actor.userId, p_user: recordId(req.params.id) }) });
  }));
  router.get('/audits/:id/detail', endpoint(async (req, res) => {
    const id = recordId(req.params.id), client = requireSupabaseAdminClient();
    const { data: audit, error } = await client.from('audits').select('id,user_id,hostname,normalized_url,status,processing_version,effective_mode,plan,current_phase,pages_discovered,pages_crawled,started_at,completed_at,created_at,updated_at,error,locked_by,lease_expires_at,queue_priority,retry_of_audit_id,admin_priority_boost,admin_priority_expires_at').eq('id', id).maybeSingle();
    if (error) throw new ApiError('AUDIT_DETAIL_UNAVAILABLE', 'Audit details could not be loaded.', 503);
    if (!audit) throw new ApiError('AUDIT_NOT_FOUND', 'Audit not found.', 404);
    const [diagnostic, run] = await Promise.all([
      client.from('audit_diagnostics').select('id,failure_code,phase,attempt_count,request_duration_ms,created_at,worker_id').eq('audit_id', id).order('created_at', { ascending: false }).limit(10),
      audit.processing_version === 2 ? client.from('audit_crawl_runs').select('state,owner,generation,lease_until,attempted,analysed,failed,blocked,last_error,peak_rss_bytes').eq('audit_id', id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    if (diagnostic.error || run.error) throw new ApiError('AUDIT_DETAIL_UNAVAILABLE', 'Some diagnostic evidence could not be loaded.', 503);
    res.json({ success: true, data: { audit: { ...audit, error: customerSafeDiagnosticText(audit.error) },
      diagnostics: diagnostic.data, processing: run.data ? { ...run.data, last_error: customerSafeDiagnosticText(run.data.last_error) } : null,
      failureClass: classifyOperationalFailure(diagnostic.data?.[0]?.failure_code), retryEligible: ['failed', 'abandoned'].includes(audit.status),
      worker: { id: run.data?.owner || audit.locked_by, leaseExpiresAt: run.data?.lease_until || (audit.processing_version === 1 ? audit.lease_expires_at : null), lastHeartbeatAtFailure: null } } });
  }));
  router.post('/audits/:id/action', endpoint(async (req, res, actor) => {
    const reason = adminReason(req), requestId = adminRequestId(req);
    const result = await operationRpc<Record<string, unknown>>('admin_audit_operation', { p_actor: actor.userId, p_audit: recordId(req.params.id), p_action: String(req.body?.action || ''),
      p_reason: reason, p_request: requestId, p_level: String(req.body?.priorityLevel || 'normal') });
    pendingSummaries.clear();
    res.json({ success: true, data: { ...result, requestId } });
  }));
  const updateAccount = endpoint(async (req, res, actor) => {
    const reason = adminReason(req), requestId = adminRequestId(req);
    const id = recordId(req.params.id);
    const patch = req.path.endsWith('/reset-quota') ? { resetQuotas: true } : req.body?.patch;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length) throw new ApiError('INVALID_ADMIN_UPDATE', 'Provide supported account changes.', 400);
    if ('disabled' in patch && typeof patch.disabled !== 'boolean') throw new ApiError('INVALID_ADMIN_UPDATE', 'Account state must be a boolean.', 400);
    const client = requireSupabaseAdminClient();
    const result = await operationRpc<Record<string, unknown>>('admin_update_account', { p_actor: actor.userId, p_user: id, p_patch: patch, p_reason: reason, p_request: requestId });
    if (typeof patch.disabled === 'boolean') {
      // Database guardrails and the action log must commit before changing Auth access.
      const { error } = await client.auth.admin.updateUserById(id, { ban_duration: patch.disabled ? '876000h' : 'none' });
      if (error) result.warning = patch.disabled
        ? 'The account is disabled in Crawlio. The authentication ban needs retry.'
        : 'Crawlio access was restored. The authentication ban could not be cleared; retry restore.';
    }
    pendingSummaries.clear();
    res.json({ success: true, data: { ...result, requestId } });
  });
  router.post('/users/:id/update', updateAccount);
  router.post('/users/:id/reset-quota', updateAccount);
  router.post('/workers/wake', endpoint(async (req, res, actor) => {
    const reason = adminReason(req), requestId = adminRequestId(req);
    const configured = process.env.PRODUCTION_WORKER_HEALTH_URL;
    let url: URL;
    try { url = new URL(configured || ''); } catch { throw new ApiError('WORKER_HEALTH_NOT_CONFIGURED', 'Configure the server worker-health URL.', 503); }
    if (url.protocol !== 'https:' || url.hostname !== 'seointel-audit-worker.onrender.com' || url.pathname !== '/health' || url.username || url.password || url.search || url.hash || url.port) throw new ApiError('WORKER_HEALTH_NOT_ALLOWED', 'Worker health configuration is not on the allowed host.', 503);
    const client = requireSupabaseAdminClient();
    const resultFor = (outcome: string) => ({ requested: true, outcome, requestId, state: outcome === 'health_request_responded' ? 'verification_pending' : 'unknown' });
    // Reserve the unique request before the external call, including across API instances.
    const { data: action, error: logError } = await client.from('admin_actions').insert({ admin_user_id: actor.userId,
      action: 'worker_wake_requested', target_type: 'worker', target_id: 'audit-engine', request_id: requestId,
      metadata: { reason, outcome: 'health_request_pending' } }).select('id').single();
    if (logError?.code === '23505') {
      const { data: existing, error } = await client.from('admin_actions').select('admin_user_id,action,target_type,target_id,metadata').eq('request_id', requestId).maybeSingle();
      if (error) throw new ApiError('ACTION_LOG_UNAVAILABLE', 'The existing wake request could not be checked.', 503);
      if (!existing || existing.admin_user_id !== actor.userId || existing.action !== 'worker_wake_requested'
        || existing.target_type !== 'worker' || existing.target_id !== 'audit-engine' || existing.metadata?.reason !== reason) {
        throw new ApiError('ADMIN_REQUEST_CONFLICT', 'This request ID belongs to a different administrator action.', 409);
      }
      res.json({ success: true, data: resultFor(existing.metadata?.outcome || 'health_request_pending') });
      return;
    }
    if (logError || !action) throw new ApiError('ACTION_LOG_UNAVAILABLE', 'The wake request could not be recorded. No health request was sent.', 503);
    let outcome = 'request_timed_out';
    try {
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5_000), headers: { Accept: 'application/json' } });
      outcome = response.ok ? 'health_request_responded' : 'health_request_failed';
      await response.body?.cancel();
    } catch { /* A bounded timeout is not evidence that the worker started. */ }
    const result = resultFor(outcome);
    const { data: updated, error } = await client.from('admin_actions').update({ metadata: { reason, outcome, result } })
      .eq('id', action.id).eq('request_id', requestId).eq('admin_user_id', actor.userId).select('id').maybeSingle();
    if (error || !updated) throw new ApiError('ACTION_LOG_UNAVAILABLE', 'The wake request was recorded, but its outcome could not be saved. Check the worker heartbeat before retrying.', 503);
    pendingSummaries.clear();
    res.json({ success: true, data: result });
  }));
  router.get('/search', endpoint(async (req, res) => {
    const text = String(req.query.query || '').trim();
    if (text.length < 2 || text.length > 120 || /[\x00-\x1f*]/.test(text)) throw new ApiError('INVALID_SEARCH', 'Enter between 2 and 120 plain search characters.', 400);
    const pattern = `%${text.replace(/[\\%_]/g, '\\$&')}%`, client = requireSupabaseAdminClient();
    const userQuery = client.from('user_profiles').select('id,email,display_name,plan').limit(5);
    const auditQuery = client.from('audits').select('id,hostname,status,user_id').order('created_at', { ascending: false }).limit(5);
    const [users, audits, schedules] = await Promise.all([
      uuid.test(text) ? userQuery.eq('id', text) : userQuery.ilike('email', pattern),
      uuid.test(text) ? auditQuery.eq('id', text) : auditQuery.ilike('hostname', pattern),
      client.from('projects').select('id,name,hostname,user_id,audit_frequency').not('audit_frequency', 'is', null).neq('audit_frequency', 'none').ilike('hostname', pattern).limit(5),
    ]);
    if (users.error || audits.error || schedules.error) throw new ApiError('ADMIN_SEARCH_UNAVAILABLE', 'Search could not be completed.', 503);
    res.json({ success: true, data: { users: users.data, audits: audits.data, schedules: schedules.data } });
  }));
  router.get('/resources', endpoint(async (_req, res, actor) => {
    res.json({ success: true, data: await operationRpc('admin_resource_inventory', { p_actor: actor.userId }) });
  }));
  router.post('/retention/preview', endpoint(async (_req, res, actor) => {
    res.json({ success: true, data: await operationRpc('admin_retention_preview', { p_actor: actor.userId }) });
  }));
  router.post('/retention/apply', endpoint(async (req, res, actor) => {
    const reason = adminReason(req), requestId = adminRequestId(req);
    const fingerprint = String(req.body?.fingerprint || '');
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new ApiError('PREVIEW_REQUIRED', 'Generate a retention preview first.', 400);
    const result = await operationRpc<Record<string, unknown>>('admin_retention_apply', { p_actor: actor.userId, p_fingerprint: fingerprint,
      p_reason: reason, p_confirmation: String(req.body?.confirmation || ''), p_request: requestId });
    pendingSummaries.clear();
    res.json({ success: true, data: { ...result, requestId } });
  }));
  for (const path of ['/actions', '/actions/export']) router.get(path, endpoint(async (req, res) => {
    const limit = path.endsWith('/export') ? 1000 : Math.floor(Math.min(100, Math.max(1, Number(req.query.limit) || 50)));
    const offset = Math.min(10_000, Math.max(0, Math.floor(Number(req.query.offset) || 0)));
    const search = String(req.query.search || '').trim().slice(0, 120).replace(/[\\%_*]/g, '\\$&');
    let query = requireSupabaseAdminClient().from('admin_actions').select('id,admin_user_id,action,target_type,target_id,request_id,created_at,metadata').order('created_at', { ascending: false }).order('id', { ascending: false });
    if (search) query = query.ilike('action', `%${search}%`);
    const { data, error } = await query.range(offset, offset + limit);
    if (error) throw new ApiError('ACTION_HISTORY_UNAVAILABLE', 'Administrator activity could not be loaded.', 503);
    const rows = (data || []).slice(0, limit).map(row => ({ ...safeAdminAction(row), actorId: row.admin_user_id }));
    if (path.endsWith('/export')) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="crawlio-admin-actions-limited-1000.csv"');
      res.send(['actor,action,target_type,target_id,request_id,reason,outcome,created_at', ...rows.map(row => [row.actorId, row.action, row.targetType, row.targetId, row.requestId, row.reason, row.outcome, row.createdAt].map(csvCell).join(','))].join('\r\n'));
    } else res.json({ success: true, data: { rows, hasMore: (data?.length || 0) > limit, offset, limit } });
  }));
  return router;
}
