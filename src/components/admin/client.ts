import { getAuthHeaders } from '../../lib/api/auth-headers';
import type { AdminPage, AdminRecord } from '../../lib/admin/types';

const root = '/api/tools/admin/';
type ReadEntry = { controller: AbortController; promise: Promise<unknown>; subscribers: number };
const reads = new Map<string, ReadEntry>();
let sessionAuthorization: string | null = null;

async function sessionHeaders(json = false) {
  const headers = await getAuthHeaders({ 'Cache-Control': 'no-store', ...(json ? { 'Content-Type': 'application/json' } : {}) });
  const authorization = new Headers(headers).get('authorization') || '';
  if (sessionAuthorization !== authorization) {
    sessionAuthorization = authorization;
    for (const entry of reads.values()) entry.controller.abort();
    reads.clear();
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
  const { headers, authorization } = await sessionHeaders();
  signal.throwIfAborted();
  const key = JSON.stringify([authorization, path]);
  let entry = reads.get(key);
  if (!entry) {
    const controller = new AbortController();
    entry = { controller, subscribers: 0, promise: request<T>(path, { signal: controller.signal }, headers) };
    reads.set(key, entry);
    const current = entry;
    void entry.promise.finally(() => { if (reads.get(key) === current) reads.delete(key); }).catch(() => {});
  }
  const current = entry;
  current.subscribers += 1;
  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const finish = (callback: () => void) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', abort);
      current.subscribers -= 1;
      if (!current.subscribers && reads.get(key) === current) { reads.delete(key); current.controller.abort(); }
      callback();
    };
    const abort = () => finish(() => reject(new DOMException('Request cancelled', 'AbortError')));
    signal.addEventListener('abort', abort, { once: true });
    current.promise.then(value => finish(() => resolve(value as T)), error => finish(() => reject(error)));
  });
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
