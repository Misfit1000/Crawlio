import { getAuthHeaders } from '../../lib/api/auth-headers';
import type { AdminPage, AdminRecord } from '../../lib/admin/types';
import { clearInflightReads, inflightRead } from '../../lib/http/inflight-read';

const root = '/api/tools/admin/';
let sessionAuthorization: string | null = null;

async function sessionHeaders(json = false) {
  const headers = await getAuthHeaders({ 'Cache-Control': 'no-store', ...(json ? { 'Content-Type': 'application/json' } : {}) });
  const authorization = new Headers(headers).get('authorization') || '';
  if (sessionAuthorization !== authorization) {
    sessionAuthorization = authorization;
    clearInflightReads();
  }
  return { headers, authorization };
}

async function request<T>(path: string, init: RequestInit = {}, suppliedHeaders?: Record<string, string>): Promise<T> {
  const headers = suppliedHeaders ?? (await sessionHeaders(Boolean(init.body))).headers;
  init.signal?.throwIfAborted();
  const response = await fetch(`${root}${path}`, { ...init, headers, credentials: 'same-origin', cache: 'no-store' });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(`Admin service returned an unexpected response (HTTP ${response.status}).`);
  const payload = await response.json();
  init.signal?.throwIfAborted();
  if (!response.ok || payload.success === false) throw new Error(typeof payload.error === 'string' ? payload.error : payload.error?.message || `Admin request failed (HTTP ${response.status}).`);
  if (!('data' in payload)) throw new Error('Admin service returned no data.');
  return payload.data as T;
}

export async function adminGet<T>(path: string, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const { headers } = await sessionHeaders();
  signal.throwIfAborted();
  return inflightRead(`${root}${path}`, headers, sharedSignal => request<T>(path, { signal: sharedSignal }, headers), signal);
}

export async function adminPost<T = Record<string, unknown>>(path: string, body: Record<string, unknown> = {}) {
  const requestId = typeof body.requestId === 'string' ? body.requestId : crypto.randomUUID();
  const result = await request<T>(path, { method: 'POST', body: JSON.stringify({ ...body, requestId }) });
  return { ...result, requestId, ...(typeof body.reason === 'string' ? { reason: body.reason } : {}) };
}

// Convert only record fields; diagnostic payloads and before/after evidence stay untouched.
export function adminRecord(row: AdminRecord): AdminRecord {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value])) as AdminRecord;
}
export async function adminList(path: string, signal: AbortSignal): Promise<AdminPage<AdminRecord>> {
  const page = await adminGet<AdminPage<AdminRecord>>(path, signal);
  return { ...page, rows: page.rows.map(adminRecord) };
}
export async function downloadAdminActions() {
  const { headers } = await sessionHeaders();
  const response = await fetch(`${root}actions/export`, { headers, credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok || !response.headers.get('content-type')?.includes('csv')) throw new Error('Administrator activity export could not be downloaded.');
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url; link.download = 'admin-actions-limited-1000.csv'; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
