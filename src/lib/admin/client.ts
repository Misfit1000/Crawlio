import { getAuthHeaders } from '../api/auth-headers';
import { safeJsonFetch } from '../http/safe-json';

export type AdminRange = '24h' | '7d' | '30d';

export interface AdminPage<T> {
  items: T[];
  total: number;
  totalIsEstimate?: boolean;
  nextCursor: string | null;
}

export interface AdminUserSummary {
  id: string;
  email: string | null;
  username: string | null;
  displayName: string | null;
  role: 'user' | 'support' | 'admin';
  plan: 'free' | 'paid' | 'agency' | 'admin';
  subscriptionStatus: string;
  quota: {
    dailyUsed: number;
    monthlyUsed: number;
    dailyResetAt: string | null;
    monthlyResetAt: string | null;
  };
  disabled: boolean;
  disabledAt: string | null;
  disabledReason: string | null;
  deletionRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminDeletionRequestSummary {
  id: string;
  user_id: string;
  requester_email: string | null;
  status: 'requested' | 'processing' | 'failed';
  request_source: 'self_service';
  failure_code: string | null;
  requested_at: string;
  updated_at: string;
}

export interface AdminAuditSummary {
  id: string;
  userId: string | null;
  ownerType: 'user' | 'guest';
  normalizedUrl: string;
  status: string;
  plan: string;
  requestedMode: string;
  effectiveMode: string;
  queuePriority: number;
  currentPhase: string;
  pagesDiscovered: number;
  pagesCrawled: number;
  checksTotal: number;
  checksCompleted: number;
  issuesFound: number;
  criticalCount: number;
  highCount: number;
  leaseExpiresAt: string | null;
  hasError: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

type QueryValue = string | number | boolean | null | undefined;
const pendingAdminGets = new Map<string, Promise<unknown>>();

function queryString(values: Record<string, QueryValue>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

async function executeAdminRequest<T>(
  path: string,
  init: RequestInit = {},
  authHeaders?: Record<string, string>,
) {
  const headers = authHeaders || await getAuthHeaders(init.body ? { 'Content-Type': 'application/json' } : {});
  const response = await safeJsonFetch<{ success: boolean; data: T; error?: unknown }>(path, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
    credentials: 'same-origin',
  });
  if (response.success === false) throw new Error(response.error);
  if (response.data.success === false) throw new Error('The administrator request was rejected.');
  return response.data.data;
}

async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = String(init.method || 'GET').toUpperCase();
  const authHeaders = await getAuthHeaders(init.body ? { 'Content-Type': 'application/json' } : {});
  if (method !== 'GET') return executeAdminRequest<T>(path, init, authHeaders);

  const requestKey = `${authHeaders.Authorization || 'anonymous'}:${path}`;
  const existing = pendingAdminGets.get(requestKey);
  if (existing) return existing as Promise<T>;

  const request = (async () => {
    try {
      return await executeAdminRequest<T>(path, init, authHeaders);
    } finally {
      pendingAdminGets.delete(requestKey);
    }
  })();
  pendingAdminGets.set(requestKey, request);
  return request;
}

export function getAdminControlOverview(range: AdminRange) {
  return adminRequest<any>(`/api/tools/admin/control-center/overview${queryString({ range })}`);
}

export function getAdminControlUsers(filters: {
  query?: string;
  role?: string;
  plan?: string;
  status?: string;
  cursor?: string | null;
  limit?: number;
}) {
  return adminRequest<AdminPage<AdminUserSummary> & { deletionRequests?: AdminDeletionRequestSummary[] }>(`/api/tools/admin/control-center/users${queryString(filters)}`);
}

export function getAdminControlUser(userId: string) {
  return adminRequest<any>(`/api/tools/admin/control-center/users/${encodeURIComponent(userId)}`);
}

export function runAdminUserAction(userId: string, payload: Record<string, unknown>) {
  return adminRequest<any>(`/api/tools/admin/control-center/users/${encodeURIComponent(userId)}/action`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getAdminControlAudits(filters: {
  query?: string;
  status?: string;
  plan?: string;
  mode?: string;
  cursor?: string | null;
  limit?: number;
}) {
  return adminRequest<AdminPage<AdminAuditSummary> & { bulkLimit: number }>(`/api/tools/admin/control-center/audits${queryString(filters)}`);
}

export function runAdminAuditBulkAction(payload: Record<string, unknown>) {
  return adminRequest<any>('/api/tools/admin/control-center/audits/bulk-action', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getAdminContentHealth() {
  return adminRequest<any>('/api/tools/admin/control-center/content-health');
}

export function runAdminContentHealthAction(payload: Record<string, unknown>) {
  return adminRequest<any>('/api/tools/admin/control-center/content-health/action', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getAdminResources() {
  return adminRequest<any>('/api/tools/admin/control-center/resources');
}

export function updateAdminResourceLinks(payload: Record<string, unknown>) {
  return adminRequest<any>('/api/tools/admin/control-center/resources/links', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function previewAdminRetention(reason: string) {
  return adminRequest<any>('/api/tools/admin/control-center/retention/preview', {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function applyAdminRetention(payload: Record<string, unknown>) {
  return adminRequest<any>('/api/tools/admin/control-center/retention/apply', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getAdminActivity(filters: { query?: string; cursor?: string | null; limit?: number }) {
  return adminRequest<AdminPage<any>>(`/api/tools/admin/control-center/actions${queryString(filters)}`);
}

export async function downloadAdminExport(dataset: 'users' | 'audits' | 'actions') {
  const response = await fetch(`/api/tools/admin/control-center/exports/${dataset}`, {
    headers: await getAuthHeaders(),
    credentials: 'same-origin',
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Export failed with HTTP ${response.status}.`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `crawlio-admin-${dataset}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
