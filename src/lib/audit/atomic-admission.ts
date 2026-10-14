import { randomUUID } from 'node:crypto';
import { ApiError } from '../api/errors';
import { requireSupabaseAdminClient } from '../supabase/server';
import { toAuditDocument } from '../supabase/audit-repository';
import type { AuditScope } from './audit-scope';
import type { AuditMode, ResourceAuditDocument } from './resource-types';
import { allowedWorkerControlUrl } from './worker-wake';

export interface AtomicAdmissionResult {
  allowed: boolean;
  code: string;
  auditId?: string;
  reusedExistingAudit?: boolean;
  retryAfterSeconds?: number;
  queueDepth?: number;
  softQueueWarning?: boolean;
  quotaRemaining?: { daily: number; monthly: number };
  audit?: ResourceAuditDocument | null;
}

export async function submitAtomicAudit(input: {
  userId: string | null; guestKeyHash: string | null; ipHash: string;
  submittedInput: string; normalizedUrl: string; hostname: string; mode: AuditMode;
  scope?: AuditScope; projectId?: string | null; botVerified: boolean;
}): Promise<AtomicAdmissionResult> {
  const client = requireSupabaseAdminClient();
  if (process.env.SCALABLE_AUDITS_ENABLED !== 'true') throw new ApiError('SCALABLE_AUDIT_UNAVAILABLE', 'Resumable audit processing is not enabled. Please contact the administrator.', 503);
  const { data, error } = await client.rpc('submit_audit_job', {
    p_audit_id: randomUUID(), p_user_id: input.userId, p_guest_key_hash: input.guestKeyHash,
    p_ip_hash: input.ipHash, p_submitted_input: input.submittedInput, p_normalized_url: input.normalizedUrl,
    p_hostname: input.hostname, p_mode: input.mode, p_scope: input.scope || null,
    p_project_id: input.projectId || null, p_bot_verified: input.botVerified,
    p_guest_daily_limit: Number(process.env.GUEST_DAILY_AUDIT_LIMIT || 2),
    p_domain_daily_limit: Number(process.env.DOMAIN_DAILY_AUDIT_LIMIT || 2),
    p_global_active_limit: Number(process.env.GLOBAL_ACTIVE_AUDIT_LIMIT || 50),
    p_allow_sleeping: Boolean(allowedWorkerControlUrl(process.env.AUDIT_WORKER_WAKE_URL, 'render') && (process.env.AUDIT_WORKER_CONTROL_SECRET?.length || 0)>=32)
      || Boolean(allowedWorkerControlUrl(process.env.SECONDARY_AUDIT_WORKER_URL, 'cloudflare') && (process.env.SECONDARY_AUDIT_CONTROL_SECRET?.length || 0)>=32),
  }).abortSignal(AbortSignal.timeout(8_000));
  if (error) throw new ApiError('AUDIT_ADMISSION_UNAVAILABLE', ['PGRST202', '42883'].includes(error.code)
    ? 'Audit startup requires migration 037. Please ask the administrator to check the deployment.'
    : 'Audit startup could not be confirmed. Retry to reopen any accepted audit.', 503);
  const result = data as Omit<AtomicAdmissionResult, 'audit'> & { audit?: Record<string, unknown> | null };
  if (!result || typeof result.allowed !== 'boolean') throw new ApiError('AUDIT_ADMISSION_UNAVAILABLE', 'Audit startup could not be confirmed. Retry to reopen any accepted audit.', 503);
  return { ...result, audit: result.audit ? toAuditDocument(result.audit) : null };
}

export function atomicAdmissionError(result: AtomicAdmissionResult): ApiError {
  const errors: Record<string, [number, string]> = {
    ACCOUNT_SUSPENDED: [403, 'This account is temporarily unavailable.'],
    PROFILE_REQUIRED: [503, 'Account setup is incomplete. Sign in again and retry.'],
    PLAN_CONFIGURATION_UNAVAILABLE: [503, 'The plan configuration is unavailable. Please contact the administrator.'],
    PLAN_MODE_UNAVAILABLE: [403, 'This audit depth is not available on your current plan.'],
    PROJECT_NOT_FOUND: [404, 'The project was not found or does not match this website.'],
    MIGRATION_REQUIRED: [503, 'The audit database requires an update. Please contact the administrator.'],
    COMPATIBLE_WORKER_UNAVAILABLE: [503, 'No compatible audit worker is available. Your selected checks were not changed.'],
    DAILY_QUOTA_REACHED: [429, "You have reached today's audit limit."],
    MONTHLY_QUOTA_REACHED: [429, "You have reached this month's audit limit."],
    DOMAIN_DAILY_LIMIT: [429, 'This website has reached its audit limit for today.'],
    QUEUE_FULL: [429, 'The audit queue is full. Please try again later.'],
    MAINTENANCE: [503, 'The audit service is temporarily unavailable for maintenance.'],
    FREE_SUBMISSIONS_PAUSED: [503, 'New Free audits are temporarily paused.'],
    GUEST_AUDITS_DISABLED: [403, 'Guest audits are unavailable. Sign in and try again.'],
    AUDIT_MODE_DISABLED: [503, 'This audit depth is temporarily unavailable.'],
    BOT_VERIFICATION_REQUIRED: [403, 'Complete the verification check before starting another audit.'],
    ACTIVE_AUDIT_EXISTS: [409, 'Another audit is active. Open it or wait for it to finish.'],
  };
  const [status, message] = errors[result.code] || [503, 'The audit could not be accepted. Please retry shortly.'];
  return new ApiError(result.code === 'ACTIVE_AUDIT_EXISTS' ? 'ACTIVE_AUDIT_CONFLICT' : result.code, message, status, {
    retryAfterSeconds: result.retryAfterSeconds || 60,
    ...(result.code === 'ACTIVE_AUDIT_EXISTS' && result.auditId ? { activeAuditId: result.auditId } : {}),
  });
}
