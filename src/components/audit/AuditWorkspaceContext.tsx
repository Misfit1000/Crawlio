import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { API_ROUTES } from '../../lib/api/routes';
import { getAuditAccessHeaders } from '../../lib/api/auth-headers';
import { createEmptyAuditLiveData, isFinalReportPending, mergeAuditLiveData, waitForPersistedFinalReport } from '../../lib/audit/audit-lifecycle';
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
  reportPending: boolean;
  reportRetrying: boolean;
  refresh: () => Promise<ResourceAuditLiveData | null>;
  retryFinalReport: () => void;
}

const AuditWorkspaceContext = createContext<AuditWorkspaceValue | null>(null);

async function loadStoredAuditSnapshot(auditId: string) {
  const response = await safeJsonFetch<any>(API_ROUTES.auditResult(auditId), { headers: await getAuditAccessHeaders() });
  if (!response.success) throw new Error((response as any).error || 'Audit workspace is unavailable.');
  return (response.data.data || response.data) as ResourceAuditLiveData;
}

export function AuditWorkspaceProvider({ auditId, children }: { auditId: string; children: React.ReactNode }) {
  const [data, setData] = useState<ResourceAuditLiveData>(() => createEmptyAuditLiveData());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportRetryKey, setReportRetryKey] = useState(0);
  const [reportRetryExhausted, setReportRetryExhausted] = useState(false);
  const [connection, setConnection] = useState<LiveAuditConnectionState>({
    transport: 'websocket',
    status: 'connecting',
    message: 'Loading audit workspace.',
  });
  const dataRef = useRef(data);
  const unsubscribeRef = useRef<() => void>(() => {});
  const reportPending = isFinalReportPending(data);

  const applySnapshot = (snapshot: ResourceAuditLiveData) => {
    const merged = mergeAuditLiveData(dataRef.current, snapshot);
    dataRef.current = merged;
    setData(merged);
    return merged;
  };

  const refresh = async () => {
    try {
      const next = applySnapshot(await loadStoredAuditSnapshot(auditId));
      setError(null);
      return next;
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : 'Audit workspace is unavailable.';
      setError(message);
      throw refreshError;
    }
  };

  useEffect(() => {
    let active = true;
    dataRef.current = createEmptyAuditLiveData();
    setData(dataRef.current);
    setLoading(true);
    setError(null);
    setReportRetryExhausted(false);
    setConnection({ transport: 'websocket', status: 'connecting', message: 'Loading audit workspace.' });

    const closeUpdates = (message: string) => {
      unsubscribeRef.current();
      unsubscribeRef.current = () => {};
      if (active) setConnection({ transport: 'polling', status: 'closed', message, lastUpdateAt: Date.now() });
    };

    loadStoredAuditSnapshot(auditId)
      .then(async (snapshot) => {
        if (!active) return;
        const merged = applySnapshot(snapshot);
        setLoading(false);

        if (!merged.audit || isTerminalAuditStatus(merged.audit.status)) {
          closeUpdates(isFinalReportPending(merged) ? 'Checks finished. Loading the saved report.' : 'Stored audit result loaded.');
          return;
        }

        const { subscribeToAuditLiveData } = await import('../../lib/audit/live-supabase-client');
        if (!active) return;
        unsubscribeRef.current = subscribeToAuditLiveData(
          auditId,
          (next) => {
            if (!active) return;
            const liveSnapshot = applySnapshot(next);
            if (liveSnapshot.audit && isTerminalAuditStatus(liveSnapshot.audit.status)) {
              closeUpdates(isFinalReportPending(liveSnapshot) ? 'Checks finished. Loading the saved report.' : 'Audit updates finished.');
            }
          },
          (nextError) => active && setError(nextError.message),
          (nextConnection) => {
            if (!active) return;
            setConnection(nextConnection);
            if (nextConnection.status !== 'error') setError(null);
          },
        );
      })
      .catch((nextError) => {
        if (!active) return;
        setError(nextError instanceof Error ? nextError.message : 'Audit workspace is unavailable.');
        setLoading(false);
        closeUpdates('Audit workspace is unavailable.');
      });

    return () => {
      active = false;
      unsubscribeRef.current();
      unsubscribeRef.current = () => {};
    };
  }, [auditId]);

  useEffect(() => {
    if (!reportPending) return;
    let active = true;
    setReportRetryExhausted(false);

    waitForPersistedFinalReport(dataRef.current, () => loadStoredAuditSnapshot(auditId), {
      isActive: () => active,
      onSnapshot: (snapshot) => {
        if (active) applySnapshot(snapshot);
      },
    }).then((result) => {
      if (active) setReportRetryExhausted(result.exhausted);
    });

    return () => {
      active = false;
    };
  }, [auditId, reportPending, reportRetryKey]);

  return (
    <AuditWorkspaceContext.Provider value={{
      auditId,
      data,
      loading,
      error,
      connection,
      reportPending,
      reportRetrying: reportPending && !reportRetryExhausted,
      refresh,
      retryFinalReport: () => setReportRetryKey((value) => value + 1),
    }}>
      {children}
    </AuditWorkspaceContext.Provider>
  );
}

export function useAuditWorkspace() {
  const value = useContext(AuditWorkspaceContext);
  if (!value) throw new Error('useAuditWorkspace must be used inside AuditWorkspaceProvider.');
  return value;
}
