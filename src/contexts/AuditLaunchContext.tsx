import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from '../app/router';
import type { AuditWorkspaceSection } from '../app/routes';
import { useAuth } from './AuthContext';
import { API_ROUTES } from '../lib/api/routes';
import { getAuditStartHeaders } from '../lib/api/auth-headers';
import { safeJsonFetch } from '../lib/http/safe-json';
import { normalizeAuditTarget } from '../lib/url/normalize-audit-target';
import type { AuditMode } from '../lib/audit/audit-config';
import { makeAuditScope, normalizeAuditScope, type AuditScope } from '../lib/audit/audit-scope';
import type { ResourceAuditLiveData } from '../lib/audit/resource-types';
import { snapshotFromAdmission, type AuditStartResult } from '../lib/audit/audit-admission';
import { loadLiveAuditScreen } from '../lib/audit/live-screen-loader';
import { AuditLaunchView, type AuditLaunchState } from '../components/audit/AuditLaunchView';

export interface AuditLaunchRequest {
  url: string;
  mode: AuditMode;
  scope?: AuditScope;
  projectId?: string | null;
  section?: AuditWorkspaceSection;
}

const Context = createContext<{
  startAudit: (request: AuditLaunchRequest) => Promise<void>;
  initialSnapshotFor: (id: string) => ResourceAuditLiveData | undefined;
} | null>(null);

export function AuditLaunchProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const [launch, setLaunch] = useState<AuditLaunchState | null>(null);
  const pending = useRef<AbortController | null>(null);
  const requestRef = useRef<AuditLaunchRequest | null>(null);
  const accepted = useRef<{ id: string; snapshot: ResourceAuditLiveData; at: number } | null>(null);
  const originPath = useRef(pathname);
  const userId = user?.id;
  const previousUserId = useRef(userId);

  useEffect(() => {
    const previous = previousUserId.current;
    previousUserId.current = userId;
    // Initial hydration can finish while admission is already using the same session.
    if (!previous || previous === userId) return;
    accepted.current = null;
    pending.current?.abort();
    pending.current = null;
    setLaunch(null);
  }, [userId]);
  useEffect(() => {
    if (pending.current && pathname !== originPath.current) {
      pending.current.abort();
      pending.current = null;
      setLaunch(null);
    }
  }, [pathname]);
  useEffect(() => () => pending.current?.abort(), []);

  const startAudit = useCallback(async (request: AuditLaunchRequest) => {
    if (pending.current) return;
    const normalized = normalizeAuditTarget(request.url);
    if (!normalized.isValid) throw new Error(normalized.error || 'Enter a valid public website.');
    const scope = normalizeAuditScope(request.scope) || makeAuditScope();
    const current = new AbortController();
    pending.current = current;
    requestRef.current = { ...request, url: normalized.normalizedUrl, scope };
    originPath.current = pathname;
    performance.mark('crawlio:audit-submit-click');
    setLaunch({ phase: 'submitting', url: normalized.normalizedUrl, mode: request.mode, scope });
    void loadLiveAuditScreen().catch(() => undefined);
    const timeout = window.setTimeout(() => current.abort('timeout'), 30_000);
    try {
      const response = await safeJsonFetch<{ success: boolean; data: AuditStartResult; error?: string }>(API_ROUTES.auditStart, {
        method: 'POST', headers: await getAuditStartHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ url: normalized.normalizedUrl, mode: request.mode, scope, projectId: request.projectId || null }),
        signal: current.signal,
      });
      if (pending.current !== current) return;
      if (current.signal.aborted) throw new Error('Startup could not be confirmed. Try again to reopen any audit already received, or edit your request.');
      if (response.success === false) {
        setLaunch({ phase: 'error', url: normalized.normalizedUrl, mode: request.mode, scope, error: response.error, code: response.code, activeAuditId: response.activeAuditId });
        return;
      }
      if (!response.data.success || !response.data.data?.auditId) throw new Error(response.data.error || 'Startup could not be confirmed. Please try again.');
      const result = response.data.data;
      const snapshot = snapshotFromAdmission(result);
      accepted.current = snapshot ? { id: result.auditId, snapshot, at: Date.now() } : null;
      performance.mark('crawlio:audit-admitted');
      pending.current = null;
      setLaunch(null);
      navigate(`/audit/live/${encodeURIComponent(result.auditId)}${request.section ? `?section=${request.section}` : ''}`);
    } catch (error) {
      if (pending.current !== current) return;
      setLaunch({ phase: 'error', url: normalized.normalizedUrl, mode: request.mode, scope, error: error instanceof Error ? error.message : 'The audit could not start. Try again.' });
    } finally {
      window.clearTimeout(timeout);
      if (pending.current === current) pending.current = null;
    }
  }, [navigate, pathname]);

  return <Context.Provider value={{ startAudit, initialSnapshotFor: id => accepted.current?.id === id && Date.now() - accepted.current.at < 60_000 ? accepted.current.snapshot : undefined }}>
    {launch && <AuditLaunchView state={launch} onRetry={() => { if (requestRef.current) void startAudit(requestRef.current); }} onEdit={() => setLaunch(null)} onOpenCurrentAudit={() => {
      if (!launch.activeAuditId) return;
      const id = launch.activeAuditId;
      setLaunch(null);
      navigate(`/audit/live/${encodeURIComponent(id)}`);
    }} />}
    <div hidden={Boolean(launch)}>{children}</div>
  </Context.Provider>;
}

export function useAuditLaunch() {
  const value = useContext(Context);
  if (!value) throw new Error('AuditLaunchProvider is required.');
  return value;
}
