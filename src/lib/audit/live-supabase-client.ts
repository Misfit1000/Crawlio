import { API_ROUTES } from '../api/routes';
import { getAuditAccessHeaders } from '../api/auth-headers';
import { getSupabaseBrowserClient } from '../supabase/client';
import { safeJsonFetch } from '../http/safe-json';
import { AUDIT_LIMITS } from './audit-config';
import type {
  ResourceAuditDocument,
  ResourceAuditEvent,
  ResourceAuditIssue,
  ResourceAuditLiveData,
  ResourceAuditPage,
  ResourceAuditReport,
} from './resource-types';

type DbRow = Record<string, any>;
export type LiveAuditTransport = 'websocket' | 'polling';
export type LiveAuditConnectionStatus = 'connecting' | 'connected' | 'polling' | 'reconnecting' | 'error' | 'closed';

export interface LiveAuditConnectionState {
  transport: LiveAuditTransport;
  status: LiveAuditConnectionStatus;
  message: string;
  lastUpdateAt?: number;
}

function toAuditDocument(row: DbRow | null | undefined): ResourceAuditDocument | null {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id ?? null,
    guestKeyHash: row.guest_key_hash ?? null,
    projectId: row.project_id ?? null,
    submittedInput: row.submitted_input,
    normalizedUrl: row.normalized_url,
    finalUrl: row.final_url ?? null,
    hostname: row.hostname,
    mode: row.mode,
    plan: row.plan ?? 'free',
    requestedMode: row.requested_mode ?? row.mode ?? 'quick',
    effectiveMode: row.effective_mode ?? row.mode ?? 'quick',
    queuePriority: row.queue_priority ?? 10,
    processingTier: row.processing_tier ?? row.plan ?? 'free',
    quotaCounted: row.quota_counted ?? false,
    workerRuntime: row.worker_runtime ?? null,
    estimatedWaitSeconds: row.estimated_wait_seconds ?? null,
    status: row.status,
    progress: row.progress ?? 0,
    currentPhase: row.current_phase ?? 'Queued',
    currentUrl: row.current_url ?? null,
    currentCheck: row.current_check ?? null,
    pageLimit: row.page_limit ?? 0,
    pagesDiscovered: row.pages_discovered ?? 0,
    pagesCrawled: row.pages_crawled ?? 0,
    checksTotal: row.checks_total ?? 0,
    checksCompleted: row.checks_completed ?? 0,
    issuesFound: row.issues_found ?? 0,
    criticalCount: row.critical_count ?? 0,
    highCount: row.high_count ?? 0,
    mediumCount: row.medium_count ?? 0,
    lowCount: row.low_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    expiresAt: row.expires_at,
    cancelledAt: row.cancelled_at ?? null,
    error: row.error ?? null,
    lockedBy: row.locked_by ?? null,
    lockedAt: row.locked_at ?? null,
    leaseExpiresAt: row.lease_expires_at ?? null,
    usedHttpFallback: row.used_http_fallback ?? undefined,
  };
}

function toAuditEvent(row: DbRow): ResourceAuditEvent {
  return {
    id: row.id,
    type: row.type,
    timestamp: row.created_at,
    message: row.message ?? '',
    phase: row.phase ?? undefined,
    currentUrl: row.current_url ?? undefined,
    affectedUrl: row.affected_url ?? undefined,
    category: row.category ?? undefined,
    checkId: row.check_id ?? undefined,
    checkTitle: row.check_title ?? undefined,
    severity: row.severity ?? undefined,
    progress: row.progress ?? undefined,
    data: row.data ?? undefined,
  };
}

function toAuditPage(row: DbRow): ResourceAuditPage {
  return {
    id: row.id,
    url: row.url,
    statusCode: row.status_code ?? 0,
    responseTimeMs: row.response_time_ms ?? 0,
    pageSizeBytes: row.page_size_bytes ?? 0,
    title: row.title ?? '',
    metaDescription: row.meta_description ?? '',
    h1: row.h1 ?? '',
    canonicalUrl: row.canonical_url ?? '',
    siteName: row.site_name ?? '',
    faviconUrl: row.favicon_url ?? '',
    openGraphImage: row.open_graph_image ?? '',
    themeColor: row.theme_color ?? '',
    screenshotUrl: row.screenshot_url ?? '',
    wordCount: row.word_count ?? 0,
    crawlDepth: row.crawl_depth ?? 0,
    issueCount: row.issue_count ?? 0,
    crawledAt: row.crawled_at,
  };
}

function toAuditIssue(row: DbRow): ResourceAuditIssue {
  return {
    id: row.id,
    severity: row.severity,
    category: row.category,
    title: row.title,
    description: row.description,
    affectedUrl: row.affected_url,
    evidence: row.evidence ?? '',
    recommendation: row.recommendation ?? '',
    detectedAt: row.detected_at,
  };
}

function toAuditReport(row: DbRow | null | undefined): ResourceAuditReport | null {
  if (!row) return null;
  return {
    scores: row.scores ?? {},
    summary: typeof row.summary === 'string' ? row.summary : row.summary?.text ?? '',
    topIssues: row.top_issues ?? [],
    pages: row.pages ?? [],
    exports: row.exports ?? { json: '', issuesCsv: '', pagesCsv: '' },
    generatedAt: row.generated_at,
  };
}

function upsertById<T extends { id: string }>(items: T[], item: T, limit: number) {
  const next = items.filter((current) => current.id !== item.id);
  next.push(item);
  return next.slice(-limit);
}

function pollAuditLiveData(
  auditId: string,
  callback: (data: ResourceAuditLiveData) => void,
  onError?: (error: Error) => void,
  onConnectionChange?: (state: LiveAuditConnectionState) => void,
  reason = 'Using HTTP polling for live audit updates.',
) {
  let cancelled = false;
  onConnectionChange?.({
    transport: 'polling',
    status: 'polling',
    message: reason,
  });

  const poll = async () => {
    try {
      const response = await safeJsonFetch<any>(API_ROUTES.auditStatus(auditId), { headers: await getAuditAccessHeaders() });
      if (!cancelled && response.success) {
        callback(response.data.data || response.data);
        onConnectionChange?.({
          transport: 'polling',
          status: 'polling',
          message: reason,
          lastUpdateAt: Date.now(),
        });
      } else if (!cancelled && !response.success) {
        const message = (response as any).error || 'Audit status polling failed.';
        onConnectionChange?.({
          transport: 'polling',
          status: 'error',
          message,
          lastUpdateAt: Date.now(),
        });
        onError?.(new Error(message));
      }
    } catch (error: any) {
      const nextError = error instanceof Error ? error : new Error(String(error));
      onConnectionChange?.({
        transport: 'polling',
        status: 'error',
        message: nextError.message,
        lastUpdateAt: Date.now(),
      });
      onError?.(nextError);
    }
  };
  const interval = window.setInterval(poll, AUDIT_LIMITS.livePollIntervalMs);
  poll();
  return () => {
    cancelled = true;
    window.clearInterval(interval);
  };
}

// Browser-only live subscription client. Server and worker writes use the Supabase audit repository.
export function subscribeToAuditLiveData(
  auditId: string,
  callback: (data: ResourceAuditLiveData) => void,
  onError?: (error: Error) => void,
  onConnectionChange?: (state: LiveAuditConnectionState) => void,
) {
  const client = getSupabaseBrowserClient();

  if (!client) {
    return pollAuditLiveData(
      auditId,
      callback,
      onError,
      onConnectionChange,
      'Supabase browser env vars are missing, so live updates are using HTTP polling.',
    );
  }

  let liveData: ResourceAuditLiveData = {
    audit: null,
    latestEvents: [],
    latestPages: [],
    latestIssues: [],
    finalReport: null,
  };

  const emit = () => callback(liveData);
  let closed = false;
  let fallbackUnsubscribe: (() => void) | null = null;
  let websocketConnected = false;

  onConnectionChange?.({
    transport: 'websocket',
    status: 'connecting',
    message: 'Opening Supabase Realtime WebSocket for this audit.',
  });

  const emitLiveData = () => {
    emit();
    const usingFallback = Boolean(fallbackUnsubscribe);
    onConnectionChange?.({
      transport: usingFallback ? 'polling' : 'websocket',
      status: usingFallback ? 'polling' : websocketConnected ? 'connected' : 'connecting',
      message: usingFallback
        ? 'Receiving live audit updates by HTTP polling.'
        : websocketConnected
          ? 'Receiving live audit updates over WebSocket.'
          : 'Loaded the audit snapshot. Waiting for the WebSocket subscription.',
      lastUpdateAt: Date.now(),
    });
  };

  const startPollingFallback = (message: string) => {
    if (closed || fallbackUnsubscribe) return;
    fallbackUnsubscribe = pollAuditLiveData(auditId, callback, onError, onConnectionChange, message);
  };

  getAuditAccessHeaders()
    .then((headers) => safeJsonFetch<any>(API_ROUTES.auditStatus(auditId), { headers }))
    .then((response) => {
      if (!closed && response.success) {
        liveData = response.data.data || response.data;
        emitLiveData();
        if (!liveData.audit?.userId) {
          startPollingFallback('Guest audit updates use secure HTTP polling. Sign in to use owner-scoped Realtime updates.');
        }
      } else if (!closed && !response.success) {
        onError?.(new Error((response as any).error || 'Failed to load audit status snapshot.'));
      }
    })
    .catch((error: any) => onError?.(error instanceof Error ? error : new Error(String(error))));

  const channel = client
    .channel(`audit-live:${auditId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'audits', filter: `id=eq.${auditId}` }, (payload) => {
      liveData = { ...liveData, audit: toAuditDocument(payload.new as DbRow) };
      emitLiveData();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_events', filter: `audit_id=eq.${auditId}` }, (payload) => {
      liveData = {
        ...liveData,
        latestEvents: upsertById(liveData.latestEvents, toAuditEvent(payload.new as DbRow), 50),
      };
      emitLiveData();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'audit_pages', filter: `audit_id=eq.${auditId}` }, (payload) => {
      if (payload.eventType === 'DELETE') return;
      liveData = {
        ...liveData,
        latestPages: upsertById(liveData.latestPages, toAuditPage(payload.new as DbRow), 100),
      };
      emitLiveData();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_issues', filter: `audit_id=eq.${auditId}` }, (payload) => {
      liveData = {
        ...liveData,
        latestIssues: upsertById(liveData.latestIssues, toAuditIssue(payload.new as DbRow), 100),
      };
      emitLiveData();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'audit_reports', filter: `audit_id=eq.${auditId}` }, (payload) => {
      if (payload.eventType === 'DELETE') return;
      liveData = { ...liveData, finalReport: toAuditReport(payload.new as DbRow) };
      emitLiveData();
    })
    .subscribe((status, error) => {
      if (error) {
        onError?.(error);
      }
      if (status === 'SUBSCRIBED') {
        websocketConnected = true;
        onConnectionChange?.({
          transport: 'websocket',
          status: 'connected',
          message: 'Supabase Realtime WebSocket is connected.',
          lastUpdateAt: Date.now(),
        });
      }
      if (status === 'CHANNEL_ERROR') {
        websocketConnected = false;
        onError?.(new Error('Supabase Realtime channel error'));
        onConnectionChange?.({
          transport: 'websocket',
          status: 'error',
          message: 'Supabase Realtime channel error. Falling back to HTTP polling.',
          lastUpdateAt: Date.now(),
        });
        startPollingFallback('Supabase Realtime channel failed, so live updates are using HTTP polling.');
      }
      if (status === 'TIMED_OUT') {
        websocketConnected = false;
        onConnectionChange?.({
          transport: 'websocket',
          status: 'reconnecting',
          message: 'Supabase Realtime timed out. Falling back to HTTP polling while it reconnects.',
          lastUpdateAt: Date.now(),
        });
        startPollingFallback('Supabase Realtime timed out, so live updates are using HTTP polling.');
      }
      if (status === 'CLOSED' && !closed) {
        websocketConnected = false;
        onConnectionChange?.({
          transport: 'websocket',
          status: 'closed',
          message: 'Supabase Realtime channel closed. Falling back to HTTP polling.',
          lastUpdateAt: Date.now(),
        });
        startPollingFallback('Supabase Realtime closed, so live updates are using HTTP polling.');
      }
    });

  return () => {
    closed = true;
    fallbackUnsubscribe?.();
    client.removeChannel(channel);
  };
}
