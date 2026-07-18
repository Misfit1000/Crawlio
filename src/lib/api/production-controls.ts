import type { NextFunction, Request, Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { ApiError } from './errors';
import { getSupabaseAdminClient, requireSupabaseAdminClient } from '../supabase/server';
import { MINIMUM_AUDIT_DATABASE_SCHEMA_VERSION, deploymentVersionRow, publicVersionPayload } from '../platform/version';

export type AuditAdmissionDecision = {
  allowed: boolean;
  code: string;
  auditId: string;
  reusedExistingAudit: boolean;
  retryAfterSeconds: number;
  queueDepth: number;
  softQueueWarning: boolean;
};

const DEFAULT_DOMAIN_DAILY_AUDIT_LIMIT = 2;

let lastApiVersionWriteAt = 0;

function positiveInteger(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function resolveDomainDailyAuditLimit(input: {
  plan: string;
  ownerDailyLimit: number;
  configuredFreeLimit?: number;
}) {
  const ownerDailyLimit = positiveInteger(input.ownerDailyLimit, 1);
  const configuredFreeLimit = positiveInteger(
    Number(input.configuredFreeLimit),
    DEFAULT_DOMAIN_DAILY_AUDIT_LIMIT,
  );
  const plan = String(input.plan || 'free').toLowerCase();

  // Authenticated paid plans already have durable account quotas. Applying the
  // guest/free repeat-target cap to them makes the advertised daily quota unusable.
  if (plan === 'paid' || plan === 'agency' || plan === 'admin') {
    return ownerDailyLimit;
  }

  return Math.min(ownerDailyLimit, configuredFreeLimit);
}

export function privacyHash(value: string) {
  const secret = process.env.RATE_LIMIT_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'crawlio-local-rate-limit';
  return createHash('sha256').update(`${secret}:${value}`).digest('hex');
}

export function requestNetworkHash(req: Request) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const address = forwarded || req.ip || req.socket.remoteAddress || 'unknown';
  return privacyHash(address);
}

export async function consumeDurableRateLimit(input: {
  namespace: string;
  identifierHash: string;
  limit: number;
  windowSeconds: number;
}) {
  const client = getSupabaseAdminClient();
  if (!client) {
    if (process.env.NODE_ENV === 'production') throw new ApiError('REQUEST_CONTROLS_UNAVAILABLE', 'Request controls are temporarily unavailable. Please try again.', 503);
    return { allowed: true, localDevelopmentBypass: true };
  }
  const { data, error } = await client.rpc('consume_api_rate_limit', {
    p_namespace: input.namespace,
    p_identifier_hash: input.identifierHash,
    p_limit: input.limit,
    p_window_seconds: input.windowSeconds,
  });
  if (error) throw new ApiError('REQUEST_CONTROLS_UNAVAILABLE', 'Request controls are temporarily unavailable. Please try again.', 503);
  const result = data as { allowed?: boolean; retry_after_seconds?: number } | null;
  if (!result?.allowed) {
    const retryAfterSeconds = Math.max(1, Number(result?.retry_after_seconds || input.windowSeconds));
    throw new ApiError('RATE_LIMITED', 'Too many requests. Please try again later.', 429, { retryAfterSeconds });
  }
  return result;
}

export function durableRateLimit(options: { namespace: string; limit: number; windowSeconds: number; identity?: (req: Request) => string }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const identity = options.identity?.(req) || requestNetworkHash(req);
      await consumeDurableRateLimit({ ...options, identifierHash: privacyHash(identity) });
      next();
    } catch (error) {
      next(error);
    }
  };
}

export async function admitAuditSubmission(input: {
  auditId?: string;
  userId: string | null;
  guestKeyHash: string | null;
  ipHash: string;
  normalizedDomain: string;
  normalizedUrl: string;
  auditMode: string;
  plan: string;
  dailyLimit: number;
  domainDailyLimit: number;
  activeLimit: number;
  globalActiveLimit: number;
  botVerified?: boolean;
}) {
  const client = requireSupabaseAdminClient('Audit admission is temporarily unavailable.');
  const auditId = input.auditId || randomUUID();
  const { data, error } = await client.rpc('admit_audit_submission', {
    p_audit_id: auditId,
    p_user_id: input.userId,
    p_guest_key_hash: input.guestKeyHash,
    p_ip_hash: input.ipHash,
    p_normalized_domain: input.normalizedDomain,
    p_normalized_url: input.normalizedUrl,
    p_audit_mode: input.auditMode,
    p_plan: input.plan,
    p_daily_limit: input.dailyLimit,
    p_domain_daily_limit: input.domainDailyLimit,
    p_active_limit: input.activeLimit,
    p_global_active_limit: input.globalActiveLimit,
    p_bot_verified: Boolean(input.botVerified),
  });
  if (error) throw new ApiError('AUDIT_ADMISSION_UNAVAILABLE', 'The audit service is being updated. Please try again shortly.', 503);
  return data as AuditAdmissionDecision;
}

export async function verifyBotToken(token: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !token) return false;
  const body = new URLSearchParams({ secret, response: token.slice(0, 4096) });
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return false;
    const result = await response.json() as { success?: boolean };
    return result.success === true;
  } catch {
    return false;
  }
}

export async function releaseAuditAdmission(auditId: string, reason: string) {
  const client = getSupabaseAdminClient();
  if (!client) return;
  await client.rpc('release_audit_admission', { p_audit_id: auditId, p_reason: reason.slice(0, 120) });
}

export async function getDeploymentCompatibility() {
  const expected = publicVersionPayload();
  const client = getSupabaseAdminClient();
  if (!client) {
    return { compatible: false, status: 'database_unavailable', expected, database: null, worker: null };
  }

  if (Date.now() - lastApiVersionWriteAt > 60_000) {
    const deployment = await client.from('deployment_versions').upsert(deploymentVersionRow('api'), { onConflict: 'component' });
    if (!deployment.error) lastApiVersionWriteAt = Date.now();
  }

  const [{ data: databaseRow, error: databaseError }, { data: workerRows }] = await Promise.all([
    client.from('deployment_versions').select('*').eq('component', 'database').maybeSingle(),
    client.from('platform_settings').select('value,updated_at').like('key', 'audit_worker:%').order('updated_at', { ascending: false }).limit(1),
  ]);
  if (databaseError || !databaseRow) {
    return { compatible: false, status: 'migration_required', expected, database: null, worker: null };
  }
  const worker = Array.isArray(workerRows) ? workerRows[0]?.value || null : null;
  const databaseCompatible = Number(databaseRow.api_schema_version || 0) >= MINIMUM_AUDIT_DATABASE_SCHEMA_VERSION;
  const workerCompatible = !worker || (
    String(worker.auditEngineVersion || '') === expected.auditEngineVersion
    && String(worker.scoringVersion || '') === expected.scoringVersion
    && String(worker.checkRegistryVersion || '') === expected.checkRegistryVersion
  );
  return {
    compatible: databaseCompatible && workerCompatible,
    status: databaseCompatible ? (workerCompatible ? 'compatible' : 'worker_version_mismatch') : 'migration_required',
    expected,
    database: databaseRow,
    worker,
  };
}

export async function assertAuditDeploymentCompatible() {
  const result = await getDeploymentCompatibility();
  if (!result.compatible) {
    throw new ApiError('AUDIT_SERVICE_UPDATING', 'The audit service is being updated. Please try again shortly.', 503, { retryAfterSeconds: 120 });
  }
  return result;
}
