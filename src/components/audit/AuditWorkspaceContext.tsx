import React, { createContext, useContext, useEffect, useState } from 'react';
import { API_ROUTES } from '../../lib/api/routes';
import { getAuditAccessHeaders } from '../../lib/api/auth-headers';
import { isTerminalAuditStatus } from '../../lib/audit/audit-time';
import type { LiveAuditConnectionState } from '../../lib/audit/live-supabase-client';
import type { ResourceAuditLiveData } from '../../lib/audit/resource-types';
import { safeJsonFetch } from '../../lib/http/safe-json';

interface AuditWorkspaceValue {
  auditId: string;
  data: ResourceAuditLiveData;
  loading: boolean;
  error: string | null;
  connection: LiveAuditConnectionState;
  refresh: () => Promise<ResourceAuditLiveData | null>;
}

const AuditWorkspaceContext = createContext<AuditWorkspaceValue | null>(null);
const emptyData: ResourceAuditLiveData = { audit: null, latestEvents: [], latestPages: [], latestIssues: [], finalReport: null };

export function AuditWorkspaceProvider({ auditId, children }: { auditId: string; children: React.ReactNode }) {
  const [data, setData] = useState<ResourceAuditLiveData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<LiveAuditConnectionState>({
    transport: 'websocket',
    status: 'connecting',
    message: 'Loading audit workspace.',
  });

  const refresh = async () => {
    const response = await safeJsonFetch<any>(API_ROUTES.auditResult(auditId), { headers: await getAuditAccessHeaders() });
    if (!response.success) throw new Error((response as any).error || 'Audit workspace is unavailable.');
    const next = (response.data.data || response.data) as ResourceAuditLiveData;
    setData(next);
    return next;
  };

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    setLoading(true);
    setError(null);
    setData(emptyData);

    refresh()
      .then(async (snapshot) => {
        if (!active || !snapshot?.audit || isTerminalAuditStatus(snapshot.audit.status)) {
          setConnection({ transport: 'polling', status: 'closed', message: 'Stored audit result loaded.' });
          return;
        }
        const { subscribeToAuditLiveData } = await import('../../lib/audit/live-supabase-client');
        if (!active) return;
        unsubscribe = subscribeToAuditLiveData(
          auditId,
          (next) => {
            if (!active) return;
            setData(next);
            if (next.audit && isTerminalAuditStatus(next.audit.status)) {
              window.setTimeout(() => unsubscribe(), 0);
            }
          },
          (nextError) => active && setError(nextError.message),
          (nextConnection) => active && setConnection(nextConnection),
        );
      })
      .catch((nextError) => active && setError(nextError instanceof Error ? nextError.message : 'Audit workspace is unavailable.'))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
      unsubscribe();
    };
  }, [auditId]);

  return (
    <AuditWorkspaceContext.Provider value={{ auditId, data, loading, error, connection, refresh }}>
      {children}
    </AuditWorkspaceContext.Provider>
  );
}

export function useAuditWorkspace() {
  const value = useContext(AuditWorkspaceContext);
  if (!value) throw new Error('useAuditWorkspace must be used inside AuditWorkspaceProvider.');
  return value;
}
