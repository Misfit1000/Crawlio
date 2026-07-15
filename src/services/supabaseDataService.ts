import { getSupabaseBrowserClient } from '../lib/supabase/client';
import { getAuthHeaders } from '../lib/api/auth-headers';
import { safeJsonFetch } from '../lib/http/safe-json';

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: any;
}

export interface SavedKeyword {
  id: string;
  term: string;
  projectId?: string;
  group?: string;
  searchVolume: number;
  keywordDifficulty: number;
  cpc?: number;
  intent?: string;
  createdAt: any;
}

export interface Competitor {
  id: string;
  domainUrl: string;
  niche?: string;
  createdAt: any;
}

function clientOrNull() {
  return getSupabaseBrowserClient();
}

function assertClient() {
  const client = clientOrNull();
  if (!client) {
    throw new Error('Supabase browser configuration is missing.');
  }
  return client;
}

async function adminApi(path: string, body: Record<string, unknown>) {
  const response = await safeJsonFetch<any>(path, {
    method: 'POST',
    headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  if (response.success === false) throw new Error(response.error);
  return response.data.data || response.data;
}

function toCamelRow(row: any) {
  return {
    ...row,
    userId: row.user_id ?? row.userId,
    projectId: row.project_id ?? row.projectId,
    domainUrl: row.domain_url ?? row.domainUrl,
    searchVolume: row.search_volume ?? row.searchVolume,
    keywordDifficulty: row.keyword_difficulty ?? row.keywordDifficulty,
    displayName: row.display_name ?? row.displayName,
    fullName: row.full_name ?? row.fullName,
    photoURL: row.photo_url ?? row.photoURL,
    platformName: row.platform_name ?? row.platformName,
    supportEmail: row.support_email ?? row.supportEmail,
    guestKeyHash: row.guest_key_hash ?? row.guestKeyHash,
    requireEmailVerification: row.require_email_verification ?? row.requireEmailVerification,
    publicRegistration: row.public_registration ?? row.publicRegistration,
    subscriptionStatus: row.subscription_status ?? row.subscriptionStatus,
    auditQuotaUsedDaily: row.audit_quota_used_daily ?? row.auditQuotaUsedDaily,
    auditQuotaUsedMonthly: row.audit_quota_used_monthly ?? row.auditQuotaUsedMonthly,
    quotaResetDailyAt: row.quota_reset_daily_at ?? row.quotaResetDailyAt,
    quotaResetMonthlyAt: row.quota_reset_monthly_at ?? row.quotaResetMonthlyAt,
    submittedInput: row.submitted_input ?? row.submittedInput,
    normalizedUrl: row.normalized_url ?? row.normalizedUrl,
    requestedMode: row.requested_mode ?? row.requestedMode,
    effectiveMode: row.effective_mode ?? row.effectiveMode,
    queuePriority: row.queue_priority ?? row.queuePriority,
    processingTier: row.processing_tier ?? row.processingTier,
    lockedBy: row.locked_by ?? row.lockedBy,
    leaseExpiresAt: row.lease_expires_at ?? row.leaseExpiresAt,
    dailyAudits: row.daily_audits ?? row.dailyAudits,
    monthlyAudits: row.monthly_audits ?? row.monthlyAudits,
    maxPagesQuick: row.max_pages_quick ?? row.maxPagesQuick,
    maxPagesStandard: row.max_pages_standard ?? row.maxPagesStandard,
    maxPagesDeep: row.max_pages_deep ?? row.maxPagesDeep,
    allowedModes: row.allowed_modes ?? row.allowedModes,
    auditTimeoutSeconds: row.audit_timeout_seconds ?? row.auditTimeoutSeconds,
    maxEventsPerAudit: row.max_events_per_audit ?? row.maxEventsPerAudit,
    maxIssuesPerAudit: row.max_issues_per_audit ?? row.maxIssuesPerAudit,
    exportsEnabled: row.exports_enabled ?? row.exportsEnabled,
    pdfEnabled: row.pdf_enabled ?? row.pdfEnabled,
    whiteLabelEnabled: row.white_label_enabled ?? row.whiteLabelEnabled,
    embedEnabled: row.embed_enabled ?? row.embedEnabled,
    apiEnabled: row.api_enabled ?? row.apiEnabled,
    scheduledAuditsEnabled: row.scheduled_audits_enabled ?? row.scheduledAuditsEnabled,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
  };
}

function profileToRow(data: any) {
  return {
    email: data.email,
    username: data.username,
    display_name: data.displayName,
    full_name: data.fullName,
    bio: data.bio,
    photo_url: data.photoURL,
    role: data.role,
    plan: data.plan,
    updated_at: new Date().toISOString(),
  };
}

function keywordToRow(uid: string, data: Omit<SavedKeyword, 'id' | 'createdAt'>) {
  return {
    user_id: uid,
    term: data.term,
    project_id: data.projectId,
    group: data.group,
    search_volume: data.searchVolume,
    keyword_difficulty: data.keywordDifficulty,
    cpc: data.cpc,
    intent: data.intent,
  };
}

function competitorToRow(uid: string, data: Omit<Competitor, 'id' | 'createdAt'>) {
  return {
    user_id: uid,
    domain_url: data.domainUrl,
    niche: data.niche,
  };
}

export const initUserProfile = async (uid: string, data: any) => {
  const client = assertClient();
  const { data: existing, error: readError } = await client.from('user_profiles').select('id').eq('id', uid).maybeSingle();
  if (readError) throw readError;
  if (!existing) {
    const { error } = await client.from('user_profiles').insert({
      id: uid,
      email: data.email,
      display_name: data.displayName,
      plan: 'free',
      role: 'user',
      subscription_status: 'inactive',
      terms_accepted_at: data.termsAcceptedAt ?? null,
      privacy_accepted_at: data.privacyAcceptedAt ?? null,
      legal_version: data.legalVersion ?? null,
    });
    if (error) throw error;
  }
};

export const getUserProfile = async (uid: string) => {
  const client = clientOrNull();
  if (!client) return null;
  const { data, error } = await client.from('user_profiles').select('*').eq('id', uid).maybeSingle();
  if (error) throw error;
  return data ? toCamelRow(data) : null;
};

export const updateUserProfileData = async (uid: string, data: any) => {
  const client = assertClient();
  const { error } = await client.from('user_profiles').upsert({
    id: uid,
    ...profileToRow(data),
  }, { onConflict: 'id' });
  if (error) throw error;
};

export const makeUserAdmin = async (uid: string) => {
  throw new Error(`Protected administrator action required for ${uid}.`);
};

export const getAllUsers = async (limit = 100) => {
  const client = clientOrNull();
  if (!client) return [];
  const { data, error } = await client.from('user_profiles').select('*').order('created_at', { ascending: false }).limit(Math.max(1, Math.min(200, limit)));
  if (error) throw error;
  return (data ?? []).map(toCamelRow);
};

export const updateUserRole = async (uid: string, role: string) => {
  throw new Error(`Protected administrator action required to assign ${role} to ${uid}.`);
};

export const updateUserAdminFields = async (uid: string, patch: any, _adminUserId?: string, reason = '') => {
  if (patch.resetQuotas) {
    return adminApi(`/api/tools/admin/users/${encodeURIComponent(uid)}/reset-quota`, { reason });
  }
  return adminApi(`/api/tools/admin/users/${encodeURIComponent(uid)}/update`, { reason, patch });
};

export const deleteUserDoc = async (uid: string) => {
  const client = assertClient();
  const { error } = await client.from('user_profiles').delete().eq('id', uid);
  if (error) throw error;
};

export const getAllProjects = async () => {
  const client = clientOrNull();
  if (!client) return [];
  const { data, error } = await client.from('projects').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  return (data ?? []).map(toCamelRow);
};

export const getAdminAudits = async (limit = 50) => {
  const client = clientOrNull();
  if (!client) return [];
  const { data, error } = await client
    .from('audits')
    .select('id,user_id,guest_key_hash,submitted_input,normalized_url,status,plan,requested_mode,effective_mode,queue_priority,processing_tier,current_phase,locked_by,lease_expires_at,error,created_at,updated_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(toCamelRow);
};

export const getAdminWorkers = async () => {
  const client = clientOrNull();
  if (!client) return [];
  const { data, error } = await client
    .from('platform_settings')
    .select('id,key,value,updated_at')
    .like('id', 'audit_worker:%')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toCamelRow);
};

export const getPlanLimits = async () => {
  const client = clientOrNull();
  if (!client) return [];
  const { data, error } = await client.from('plan_limits').select('*').order('priority', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toCamelRow);
};

export const updatePlanLimit = async (plan: string, patch: any, _adminUserId?: string, reason = '') => {
  const row: any = {};
  for (const [key, value] of Object.entries(patch)) {
    const snake = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    row[snake] = value;
  }
  return adminApi(`/api/tools/admin/plans/${encodeURIComponent(plan)}`, { reason, patch: row });
};

export const updateAuditAdminAction = async (auditId: string, patch: any, _adminUserId?: string, reason = '') => {
  const action = patch.status === 'cancelled' ? 'cancel'
    : patch.status === 'abandoned' ? 'abandon'
      : 'queuePriority' in patch ? 'priority'
      : /recover/i.test(String(patch.currentPhase || '')) ? 'requeue'
        : 'retry';
  return adminApi(`/api/tools/admin/audits/${encodeURIComponent(auditId)}/action`, { reason, action, queuePriority: patch.queuePriority });
};

export const getAdminActions = async (limit = 50) => {
  const client = clientOrNull();
  if (!client) return [];
  const { data, error } = await client.from('admin_actions').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).map(toCamelRow);
};

export const getAdminDiagnostics = async () => {
  const response = await safeJsonFetch<any>('/api/tools/admin/diagnostics', {
    headers: await getAuthHeaders(),
    credentials: 'same-origin',
  });
  if (response.success === false) throw new Error(response.error);
  return response.data.data || response.data;
};

export const logAdminAction = async (adminUserId: string | undefined, action: string, targetType?: string, targetId?: string, metadata: any = {}) => {
  const client = clientOrNull();
  if (!client || !adminUserId) return;
  const { error } = await client.from('admin_actions').insert({
    admin_user_id: adminUserId,
    action,
    target_type: targetType,
    target_id: targetId,
    metadata,
  });
  if (error) throw error;
};

export const getAllKeywords = async () => {
  const client = clientOrNull();
  if (!client) return [];
  const { data, error } = await client.from('keywords').select('*').order('created_at', { ascending: false }).limit(1000);
  if (error) throw error;
  return (data ?? []).map(toCamelRow);
};

export const getAllCompetitors = async () => {
  const client = clientOrNull();
  if (!client) return [];
  const { data, error } = await client.from('competitors').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) throw error;
  return (data ?? []).map(toCamelRow);
};

export const deleteAnyDocument = async (path: string) => {
  const client = assertClient();
  const [, , collectionName, id] = path.split('/');
  const tableByCollection: Record<string, string> = {
    projects: 'projects',
    keywords: 'keywords',
    competitors: 'competitors',
  };
  const table = tableByCollection[collectionName];
  if (!table || !id) throw new Error(`Unsupported data path: ${path}`);
  const { error } = await client.from(table).delete().eq('id', id);
  if (error) throw error;
};

export const getPlatformSettings = async () => {
  const client = clientOrNull();
  if (!client) {
    return {
      platformName: 'Crawlio Audit',
      supportEmail: 'support@keywordintelligence.com',
      requireEmailVerification: false,
      publicRegistration: true,
    };
  }
  const { data, error } = await client.from('platform_settings').select('*').eq('id', 'settings').maybeSingle();
  if (error) throw error;
  return data ? toCamelRow(data) : {
    platformName: 'Crawlio Audit',
    supportEmail: 'support@keywordintelligence.com',
    requireEmailVerification: false,
    publicRegistration: true,
  };
};

export const updatePlatformSettings = async (data: any, reason = '') => {
  return adminApi('/api/tools/admin/platform/settings', { reason, patch: data });
};

export const getProjects = async (uid: string): Promise<Project[]> => {
  const client = clientOrNull();
  if (!client) return [];
  const { data, error } = await client.from('projects').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []).map(toCamelRow) as Project[];
};

export const addProject = async (uid: string, data: Omit<Project, 'id' | 'createdAt'>) => {
  const client = assertClient();
  const { data: inserted, error } = await client
    .from('projects')
    .insert({ user_id: uid, name: data.name, description: data.description })
    .select('*')
    .single();
  if (error) throw error;
  return toCamelRow(inserted) as Project;
};

export const deleteProject = async (uid: string, projectId: string) => {
  const client = assertClient();
  const { error } = await client.from('projects').delete().eq('user_id', uid).eq('id', projectId);
  if (error) throw error;
};

export const getSavedKeywords = async (uid: string): Promise<SavedKeyword[]> => {
  const client = clientOrNull();
  if (!client) return [];
  const { data, error } = await client.from('keywords').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(1000);
  if (error) throw error;
  return (data ?? []).map(toCamelRow) as SavedKeyword[];
};

export const addSavedKeyword = async (uid: string, data: Omit<SavedKeyword, 'id' | 'createdAt'>) => {
  const client = assertClient();
  const { data: inserted, error } = await client.from('keywords').insert(keywordToRow(uid, data)).select('*').single();
  if (error) throw error;
  return toCamelRow(inserted) as SavedKeyword;
};

export const deleteSavedKeyword = async (uid: string, keywordId: string) => {
  const client = assertClient();
  const { error } = await client.from('keywords').delete().eq('user_id', uid).eq('id', keywordId);
  if (error) throw error;
};

export const getCompetitors = async (uid: string): Promise<Competitor[]> => {
  const client = clientOrNull();
  if (!client) return [];
  const { data, error } = await client.from('competitors').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  return (data ?? []).map(toCamelRow) as Competitor[];
};

export const addCompetitor = async (uid: string, data: Omit<Competitor, 'id' | 'createdAt'>) => {
  const client = assertClient();
  const { data: inserted, error } = await client.from('competitors').insert(competitorToRow(uid, data)).select('*').single();
  if (error) throw error;
  return toCamelRow(inserted) as Competitor;
};

export const deleteCompetitor = async (uid: string, competitorId: string) => {
  const client = assertClient();
  const { error } = await client.from('competitors').delete().eq('user_id', uid).eq('id', competitorId);
  if (error) throw error;
};
