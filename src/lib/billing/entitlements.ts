import type { User as SupabaseAuthUser } from '@supabase/supabase-js';
import type { AuditMode, UserPlan } from '../audit/resource-types';
import { getSupabaseAdminClient, requireSupabaseAdminClient } from '../supabase/server';

export type UserRole = 'user' | 'admin' | 'support';
export type SubscriptionStatus = 'inactive' | 'trialing' | 'active' | 'past_due' | 'cancelled';

export interface PlanLimits {
  plan: UserPlan;
  label: string;
  dailyAudits: number;
  monthlyAudits: number;
  maxPagesQuick: number;
  maxPagesStandard: number;
  maxPagesDeep: number;
  allowedModes: AuditMode[];
  auditTimeoutSeconds: number;
  concurrency: number;
  maxEventsPerAudit: number;
  maxIssuesPerAudit: number;
  priority: number;
  exportsEnabled: boolean;
  pdfEnabled: boolean;
  whiteLabelEnabled: boolean;
  embedEnabled: boolean;
  apiEnabled: boolean;
  scheduledAuditsEnabled: boolean;
}

export interface UserProfileEntitlement {
  id: string;
  email: string | null;
  fullName: string | null;
  role: UserRole;
  plan: UserPlan;
  subscriptionStatus: SubscriptionStatus;
  auditQuotaUsedDaily: number;
  auditQuotaUsedMonthly: number;
  disabled: boolean;
}

export interface AuditStartDecision {
  userId: string | null;
  plan: UserPlan;
  role: UserRole;
  subscriptionStatus: SubscriptionStatus;
  requestedMode: AuditMode;
  effectiveMode: AuditMode;
  processingTier: UserPlan;
  pageLimit: number;
  queuePriority: number;
  quotaRemaining: {
    daily: number;
    monthly: number;
  };
  limits: PlanLimits;
}

export class EntitlementError extends Error {
  status: number;
  upgradeRequired: boolean;

  constructor(message: string, options: { status?: number; upgradeRequired?: boolean } = {}) {
    super(message);
    this.name = 'EntitlementError';
    this.status = options.status ?? 403;
    this.upgradeRequired = options.upgradeRequired ?? false;
  }
}

export const DEFAULT_PLAN_LIMITS: Record<UserPlan, PlanLimits> = {
  free: {
    plan: 'free',
    label: 'Free',
    dailyAudits: 3,
    monthlyAudits: 30,
    maxPagesQuick: 5,
    maxPagesStandard: 0,
    maxPagesDeep: 0,
    allowedModes: ['quick'],
    auditTimeoutSeconds: 5,
    concurrency: 1,
    maxEventsPerAudit: 100,
    maxIssuesPerAudit: 150,
    priority: 10,
    exportsEnabled: true,
    pdfEnabled: false,
    whiteLabelEnabled: false,
    embedEnabled: false,
    apiEnabled: false,
    scheduledAuditsEnabled: false,
  },
  paid: {
    plan: 'paid',
    label: 'Paid Full Audit',
    dailyAudits: 25,
    monthlyAudits: 500,
    maxPagesQuick: 50,
    maxPagesStandard: 50,
    maxPagesDeep: 0,
    allowedModes: ['quick', 'standard'],
    auditTimeoutSeconds: 8,
    concurrency: 2,
    maxEventsPerAudit: 300,
    maxIssuesPerAudit: 1000,
    priority: 50,
    exportsEnabled: true,
    pdfEnabled: true,
    whiteLabelEnabled: true,
    embedEnabled: false,
    apiEnabled: false,
    scheduledAuditsEnabled: false,
  },
  agency: {
    plan: 'agency',
    label: 'Agency',
    dailyAudits: 100,
    monthlyAudits: 3000,
    maxPagesQuick: 50,
    maxPagesStandard: 50,
    maxPagesDeep: 75,
    allowedModes: ['quick', 'standard', 'deep'],
    auditTimeoutSeconds: 10,
    concurrency: 3,
    maxEventsPerAudit: 500,
    maxIssuesPerAudit: 3000,
    priority: 100,
    exportsEnabled: true,
    pdfEnabled: true,
    whiteLabelEnabled: true,
    embedEnabled: true,
    apiEnabled: true,
    scheduledAuditsEnabled: true,
  },
  admin: {
    plan: 'admin',
    label: 'Admin Full Audit',
    dailyAudits: 1000,
    monthlyAudits: 100000,
    maxPagesQuick: 50,
    maxPagesStandard: 50,
    maxPagesDeep: 100,
    allowedModes: ['quick', 'standard', 'deep'],
    auditTimeoutSeconds: 10,
    concurrency: 3,
    maxEventsPerAudit: 1000,
    maxIssuesPerAudit: 5000,
    priority: 999,
    exportsEnabled: true,
    pdfEnabled: true,
    whiteLabelEnabled: true,
    embedEnabled: true,
    apiEnabled: true,
    scheduledAuditsEnabled: true,
  },
};

function nextDailyResetMs() {
  const date = new Date();
  date.setUTCHours(24, 0, 0, 0);
  return date.getTime();
}

function nextMonthlyResetMs() {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() + 1, 1);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function normalizeRole(value: unknown): UserRole {
  if (value === 'admin') return 'admin';
  if (value === 'support' || value === 'staff') return 'support';
  return 'user';
}

export function normalizePlan(value: unknown): UserPlan {
  if (value === 'paid' || value === 'agency' || value === 'admin') return value;
  return 'free';
}

function normalizeSubscriptionStatus(value: unknown): SubscriptionStatus {
  if (value === 'trialing' || value === 'active' || value === 'past_due' || value === 'cancelled') return value;
  return 'inactive';
}

function getAdminEmailSet() {
  return new Set(
    String(process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isBootstrapAdminEmail(email: string | null | undefined) {
  if (!email) return false;
  return getAdminEmailSet().has(email.trim().toLowerCase());
}

function rowToPlanLimits(row: any): PlanLimits {
  const fallback = DEFAULT_PLAN_LIMITS[normalizePlan(row?.plan)];
  return {
    plan: fallback.plan,
    label: row?.label ?? fallback.label,
    dailyAudits: row?.daily_audits ?? fallback.dailyAudits,
    monthlyAudits: row?.monthly_audits ?? fallback.monthlyAudits,
    maxPagesQuick: row?.max_pages_quick ?? fallback.maxPagesQuick,
    maxPagesStandard: row?.max_pages_standard ?? fallback.maxPagesStandard,
    maxPagesDeep: row?.max_pages_deep ?? fallback.maxPagesDeep,
    allowedModes: (row?.allowed_modes ?? fallback.allowedModes) as AuditMode[],
    auditTimeoutSeconds: row?.audit_timeout_seconds ?? fallback.auditTimeoutSeconds,
    concurrency: row?.concurrency ?? fallback.concurrency,
    maxEventsPerAudit: row?.max_events_per_audit ?? fallback.maxEventsPerAudit,
    maxIssuesPerAudit: row?.max_issues_per_audit ?? fallback.maxIssuesPerAudit,
    priority: row?.priority ?? fallback.priority,
    exportsEnabled: row?.exports_enabled ?? fallback.exportsEnabled,
    pdfEnabled: row?.pdf_enabled ?? fallback.pdfEnabled,
    whiteLabelEnabled: row?.white_label_enabled ?? fallback.whiteLabelEnabled,
    embedEnabled: row?.embed_enabled ?? fallback.embedEnabled,
    apiEnabled: row?.api_enabled ?? fallback.apiEnabled,
    scheduledAuditsEnabled: row?.scheduled_audits_enabled ?? fallback.scheduledAuditsEnabled,
  };
}

function rowToProfile(row: any): UserProfileEntitlement {
  return {
    id: row.id,
    email: row.email ?? null,
    fullName: row.full_name ?? row.display_name ?? null,
    role: normalizeRole(row.role),
    plan: normalizePlan(row.plan),
    subscriptionStatus: normalizeSubscriptionStatus(row.subscription_status),
    auditQuotaUsedDaily: Number(row.audit_quota_used_daily ?? 0),
    auditQuotaUsedMonthly: Number(row.audit_quota_used_monthly ?? 0),
    disabled: Boolean(row.disabled),
  };
}

export async function getAuthenticatedUserFromRequest(req: any) {
  const header = String(req.headers?.authorization || req.headers?.Authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!token) return null;
  const client = getSupabaseAdminClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

export async function ensureUserProfileFromAuthUser(user: SupabaseAuthUser) {
  const client = requireSupabaseAdminClient();
  const email = user.email ?? null;
  const isAdminEmail = isBootstrapAdminEmail(email);
  const timestamp = new Date().toISOString();
  const metadata = user.user_metadata || {};
  const fullName = metadata.full_name || metadata.display_name || (email ? email.split('@')[0] : 'User');
  const { data: existing, error: readError } = await client
    .from('user_profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  if (readError) throw readError;
  if (existing?.disabled) throw new EntitlementError('This account is temporarily unavailable.', { status: 403 });

  const nextRole = isAdminEmail ? 'admin' : normalizeRole(existing?.role);
  const nextPlan = isAdminEmail ? 'admin' : normalizePlan(existing?.plan);
  const nextSubscriptionStatus = existing
    ? normalizeSubscriptionStatus(existing.subscription_status)
    : nextPlan === 'free' ? 'inactive' : 'active';

  if (existing && existing.email === email && existing.role === nextRole && existing.plan === nextPlan && existing.full_name) {
    return rowToProfile(existing);
  }

  const { data, error } = await client
    .from('user_profiles')
    .upsert(
      {
        id: user.id,
        email,
        full_name: existing?.full_name ?? fullName,
        role: nextRole,
        plan: nextPlan,
        subscription_status: nextSubscriptionStatus,
        terms_accepted_at: existing?.terms_accepted_at ?? metadata.terms_accepted_at ?? null,
        privacy_accepted_at: existing?.privacy_accepted_at ?? metadata.privacy_accepted_at ?? null,
        legal_version: existing?.legal_version ?? metadata.legal_consent_version ?? null,
        quota_reset_daily_at: existing?.quota_reset_daily_at ?? new Date(nextDailyResetMs()).toISOString(),
        quota_reset_monthly_at: existing?.quota_reset_monthly_at ?? new Date(nextMonthlyResetMs()).toISOString(),
        updated_at: timestamp,
      },
      { onConflict: 'id' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return rowToProfile(data);
}

export async function getPlanLimits(plan: UserPlan): Promise<PlanLimits> {
  const fallback = DEFAULT_PLAN_LIMITS[normalizePlan(plan)];
  const client = getSupabaseAdminClient();
  if (!client) return fallback;
  const { data, error } = await client.from('plan_limits').select('*').eq('plan', fallback.plan).maybeSingle();
  if (error || !data) return fallback;
  return rowToPlanLimits(data);
}

export async function getUserEntitlements(userId: string): Promise<{ profile: UserProfileEntitlement; limits: PlanLimits }> {
  const client = requireSupabaseAdminClient();
  await resetQuotaIfNeeded(userId);
  const { data, error } = await client.from('user_profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new EntitlementError('User profile not found.', { status: 401 });
  const profile = rowToProfile(data);
  if (profile.disabled) throw new EntitlementError('This account is temporarily unavailable.', { status: 403 });
  return { profile, limits: await getPlanLimits(profile.plan) };
}

export function resolveEffectiveAuditMode(
  userPlan: UserPlan,
  requestedMode: AuditMode,
  options: { deepAuditEnabled?: boolean } = {},
): AuditMode {
  const plan = normalizePlan(userPlan);
  if (plan === 'free' && requestedMode !== 'quick') {
    throw new EntitlementError('Standard and Deep audits require a paid plan.', { upgradeRequired: true });
  }
  if (plan === 'paid' && requestedMode === 'deep') {
    throw new EntitlementError('Deep Audit requires an agency plan.', { upgradeRequired: true });
  }
  if ((plan === 'agency' || plan === 'admin') && requestedMode === 'deep' && !options.deepAuditEnabled) {
    throw new EntitlementError('Deep Audit requires a dedicated always-on worker.', { upgradeRequired: plan !== 'admin' });
  }
  if ((plan === 'paid' || plan === 'agency' || plan === 'admin') && requestedMode === 'quick') {
    return 'standard';
  }
  return requestedMode;
}

function pageLimitForMode(limits: PlanLimits, mode: AuditMode) {
  if (mode === 'deep') return limits.maxPagesDeep;
  if (mode === 'standard') return limits.maxPagesStandard;
  return limits.maxPagesQuick;
}

async function getActiveAuditCount(userId: string) {
  const client = requireSupabaseAdminClient();
  const { count, error } = await client
    .from('audits')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('status', ['queued', 'running']);
  if (error) throw error;
  return count ?? 0;
}

export async function canStartAudit(
  userId: string | null,
  requestedMode: AuditMode,
  options: { guestKey?: string; deepAuditEnabled?: boolean } = {},
): Promise<AuditStartDecision> {
  const effectiveMode = resolveEffectiveAuditMode(userId ? (await getUserEntitlements(userId)).profile.plan : 'free', requestedMode, options);
  if (!userId) {
    const limits = DEFAULT_PLAN_LIMITS.free;
    return {
      userId: null,
      plan: 'free',
      role: 'user',
      subscriptionStatus: 'inactive',
      requestedMode,
      effectiveMode,
      processingTier: 'free',
      pageLimit: limits.maxPagesQuick,
      queuePriority: limits.priority,
      quotaRemaining: {
        daily: limits.dailyAudits,
        monthly: limits.monthlyAudits,
      },
      limits,
    };
  }

  const { profile, limits } = await getUserEntitlements(userId);
  const finalMode = resolveEffectiveAuditMode(profile.plan, requestedMode, options);
  if (!limits.allowedModes.includes(finalMode)) {
    throw new EntitlementError('This audit mode is not enabled for your plan.', { upgradeRequired: true });
  }
  if (profile.plan === 'free' && (await getActiveAuditCount(userId)) > 0) {
    throw new EntitlementError('You already have an audit in progress. Please wait for it to finish.', { status: 429 });
  }
  if (profile.plan !== 'admin') {
    if (profile.auditQuotaUsedDaily >= limits.dailyAudits || profile.auditQuotaUsedMonthly >= limits.monthlyAudits) {
      throw new EntitlementError('You have reached your free audit limit. Upgrade for more audits.', {
        status: 429,
        upgradeRequired: profile.plan === 'free',
      });
    }
  }

  return {
    userId,
    plan: profile.plan,
    role: profile.role,
    subscriptionStatus: profile.subscriptionStatus,
    requestedMode,
    effectiveMode: finalMode,
    processingTier: profile.plan,
    pageLimit: pageLimitForMode(limits, finalMode),
    queuePriority: limits.priority,
    quotaRemaining: {
      daily: Math.max(0, limits.dailyAudits - profile.auditQuotaUsedDaily - 1),
      monthly: Math.max(0, limits.monthlyAudits - profile.auditQuotaUsedMonthly - 1),
    },
    limits,
  };
}

export async function consumeAuditQuota(
  userId: string | null,
  auditId: string,
  mode: AuditMode,
  options: { plan?: UserPlan; pagesLimit?: number; guestKey?: string } = {},
) {
  if (!userId) {
    return;
  }

  const client = requireSupabaseAdminClient();
  const { error } = await client.rpc('consume_user_audit_quota', {
    p_user_id: userId,
    p_audit_id: auditId,
    p_plan: normalizePlan(options.plan),
    p_mode: mode,
    p_pages_limit: options.pagesLimit ?? null,
  });
  if (error) throw error;
}

export async function resetQuotaIfNeeded(userId: string) {
  const client = requireSupabaseAdminClient();
  const { data, error } = await client
    .from('user_profiles')
    .select('quota_reset_daily_at,quota_reset_monthly_at')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) {
    if (error) throw error;
    return;
  }

  const now = Date.now();
  const patch: Record<string, any> = {};
  if (!data.quota_reset_daily_at || new Date(data.quota_reset_daily_at).getTime() <= now) {
    patch.audit_quota_used_daily = 0;
    patch.quota_reset_daily_at = new Date(nextDailyResetMs()).toISOString();
  }
  if (!data.quota_reset_monthly_at || new Date(data.quota_reset_monthly_at).getTime() <= now) {
    patch.audit_quota_used_monthly = 0;
    patch.quota_reset_monthly_at = new Date(nextMonthlyResetMs()).toISOString();
  }
  if (Object.keys(patch).length) {
    patch.updated_at = new Date().toISOString();
    const { error: updateError } = await client.from('user_profiles').update(patch).eq('id', userId);
    if (updateError) throw updateError;
  }
}

export async function isAdmin(userId: string) {
  const { profile } = await getUserEntitlements(userId);
  return profile.role === 'admin';
}

export async function requireAdmin(userId: string) {
  if (!(await isAdmin(userId))) {
    throw new EntitlementError('Admin access required.', { status: 403 });
  }
}
