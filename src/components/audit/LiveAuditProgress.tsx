import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock, FileDown, Loader2, Radio, ShieldAlert, StopCircle, Wifi, WifiOff } from 'lucide-react';
import type { ResourceAuditLiveData } from '../../lib/audit/resource-types';
import type { LiveAuditConnectionState } from '../../lib/audit/live-supabase-client';
import { AUDIT_LIMITS, getAuditModeLabel } from '../../lib/audit/audit-config';
import { API_ROUTES } from '../../lib/api/routes';
import { safeJsonFetch } from '../../lib/http/safe-json';

interface Props {
  auditId: string;
  onComplete?: () => void;
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function elapsed(createdAt?: string) {
  if (!createdAt) return '0s';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function severityClass(severity: string) {
  if (severity === 'critical') return 'bg-red-500/10 text-red-500 border-red-500/20';
  if (severity === 'high') return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
  if (severity === 'medium') return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20';
  return 'bg-muted text-muted-foreground border-border';
}

function formatLastUpdate(lastUpdateAt: number | undefined, now: number) {
  if (!lastUpdateAt) return 'waiting for first update';
  const seconds = Math.max(0, Math.floor((now - lastUpdateAt) / 1000));
  if (seconds < 2) return 'updated now';
  if (seconds < 60) return `updated ${seconds}s ago`;
  return `updated ${Math.floor(seconds / 60)}m ago`;
}

export function LiveAuditProgress({ auditId, onComplete }: Props) {
  const [data, setData] = useState<ResourceAuditLiveData>({ audit: null, latestEvents: [], latestPages: [], latestIssues: [] });
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [connection, setConnection] = useState<LiveAuditConnectionState>({
    transport: 'websocket',
    status: 'connecting',
    message: 'Opening live audit connection.',
  });
  const [now, setNow] = useState(Date.now());
  const [isCancelling, setIsCancelling] = useState(false);

  useEffect(() => {
    let isActive = true;
    let unsubscribe = () => {};
    setWarning(null);
    setConnection({
      transport: 'websocket',
      status: 'connecting',
      message: 'Opening live audit connection.',
    });

    import('../../lib/audit/live-supabase-client')
      .then(({ subscribeToAuditLiveData }) => {
        if (!isActive) return;
        unsubscribe = subscribeToAuditLiveData(
          auditId,
          (nextData) => {
            setData(nextData);
            if (nextData.audit?.status === 'completed' || nextData.audit?.status === 'failed' || nextData.audit?.status === 'cancelled') {
              onComplete?.();
            }
          },
          (err) => setWarning(err.message),
          (nextConnection) => {
            setConnection(nextConnection);
            if (nextConnection.status !== 'error') {
              setWarning(null);
            }
          },
        );
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load live audit client'));

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [auditId, onComplete]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const audit = data.audit;
  const latestEvent = data.latestEvents[data.latestEvents.length - 1];
  const currentWork = useMemo(() => {
    if (!audit) {
      return {
        phase: 'Connecting',
        action: 'Loading audit snapshot',
        target: auditId,
        message: connection.message,
      };
    }

    if (audit.status === 'completed') {
      return {
        phase: 'Completed',
        action: 'Final report is ready',
        target: audit.finalUrl || audit.normalizedUrl,
        message: latestEvent?.message || 'Audit completed.',
      };
    }

    if (audit.status === 'failed') {
      return {
        phase: 'Failed',
        action: audit.error || 'Audit failed',
        target: audit.currentUrl || audit.normalizedUrl,
        message: latestEvent?.message || audit.error || 'The worker stopped before completing this audit.',
      };
    }

    if (audit.status === 'cancelled') {
      return {
        phase: 'Cancelled',
        action: 'Audit stopped',
        target: audit.currentUrl || audit.normalizedUrl,
        message: latestEvent?.message || 'The audit was cancelled.',
      };
    }

    return {
      phase: audit.currentPhase || latestEvent?.phase || 'Queued',
      action: audit.currentCheck || latestEvent?.checkTitle || latestEvent?.message || 'Waiting for worker',
      target: audit.currentUrl || latestEvent?.currentUrl || latestEvent?.affectedUrl || audit.normalizedUrl,
      message: latestEvent?.message || (audit.status === 'queued' ? 'Queued for the audit worker.' : 'Worker is updating live progress.'),
    };
  }, [audit, auditId, connection.message, latestEvent]);

  const queuedTooLong = useMemo(() => {
    if (!audit || audit.status !== 'queued') return false;
    return now - new Date(audit.createdAt).getTime() > AUDIT_LIMITS.noWorkerWarningMs;
  }, [audit, now]);

  const cancelAudit = async () => {
    setIsCancelling(true);
    try {
      const response = await safeJsonFetch(API_ROUTES.auditCancel(auditId), { method: 'POST' });
      if (!response.success) throw new Error((response as any).error || 'Failed to cancel audit');
    } catch (err: any) {
      setError(err.message || 'Failed to cancel audit');
    } finally {
      setIsCancelling(false);
    }
  };

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl flex items-center gap-2">
        <AlertTriangle className="w-5 h-5" /> {error}
      </div>
    );
  }

  if (!audit) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
            <div>
              <div className="font-medium text-foreground">Connecting to live audit...</div>
              <div className="text-sm break-all">Audit ID: {auditId}</div>
            </div>
          </div>
          <ConnectionBadge connection={connection} now={now} />
        </div>
        <CurrentWorkCard currentWork={currentWork} connection={connection} now={now} />
        {warning && (
          <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-700 text-sm">
            {warning}
          </div>
        )}
      </div>
    );
  }

  const progress = Math.max(0, Math.min(100, audit.progress || 0));

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Currently Auditing</h2>
            <p className="text-muted-foreground break-all">{audit.normalizedUrl}</p>
          </div>
          <div className="flex items-center gap-2">
            <ConnectionBadge connection={connection} now={now} />
            {data.finalReport && (
              <a href={API_ROUTES.auditExport(auditId, 'json')} className="px-3 py-2 rounded-lg border border-border text-sm flex items-center gap-2 hover:bg-muted">
                <FileDown className="w-4 h-4" /> JSON
              </a>
            )}
            {audit.status === 'queued' || audit.status === 'running' ? (
              <button
                type="button"
                onClick={cancelAudit}
                disabled={isCancelling}
                className="px-3 py-2 rounded-lg border border-red-500/30 text-red-500 text-sm flex items-center gap-2 hover:bg-red-500/10 disabled:opacity-50"
              >
                {isCancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <StopCircle className="w-4 h-4" />}
                Stop Audit
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-5 h-3 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-accent transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
          <span>{audit.currentPhase || 'Queued'}</span>
          <span className="font-mono text-foreground">{Math.round(progress)}%</span>
        </div>

        <CurrentWorkCard currentWork={currentWork} connection={connection} now={now} />

        {warning && (
          <div className="mt-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-700 text-sm">
            {warning}
          </div>
        )}

        {queuedTooLong && (
          <div className="mt-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-700 text-sm">
            Audit is queued. The audit worker has not picked it up yet. Start the worker with <span className="font-mono">npm run worker:audit</span> or deploy the worker service.
          </div>
        )}

        <div className="mt-6 grid md:grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
          <Info label="Submitted input" value={audit.submittedInput} />
          <Info label="Normalized URL" value={audit.normalizedUrl} />
          <Info label="Final URL" value={audit.finalUrl || 'Waiting for first fetch'} />
          <Info label="Hostname" value={audit.hostname} />
          <Info label="Mode" value={getAuditModeLabel(audit.mode)} />
          <Info label="Status" value={audit.status} />
          <Info label="Current page" value={audit.currentUrl || 'Waiting for worker'} />
          <Info label="Current check" value={audit.currentCheck || 'Queued'} />
          <Info label="Pages" value={`${audit.pagesCrawled} / ${audit.pageLimit}`} />
          <Info label="Issues" value={String(audit.issuesFound)} />
          <Info label="Elapsed" value={elapsed(audit.createdAt)} />
          <Info label="Security" value="Passive checks only" />
        </div>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <Metric icon={<Clock />} label="Pages Crawled" value={`${audit.pagesCrawled}/${audit.pageLimit}`} />
        <Metric icon={<ShieldAlert />} label="Critical/High" value={`${audit.criticalCount}/${audit.highCount}`} />
        <Metric icon={<AlertTriangle />} label="Total Issues" value={String(audit.issuesFound)} />
        <Metric icon={audit.status === 'completed' ? <CheckCircle2 /> : <Loader2 className="animate-spin" />} label="Status" value={audit.status} />
      </div>

      <section className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold">Live Pages</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">URL</th>
                <th className="text-left p-3">Response</th>
                <th className="text-left p-3">Size</th>
                <th className="text-left p-3">Title</th>
                <th className="text-left p-3">Words</th>
                <th className="text-left p-3">Depth</th>
                <th className="text-left p-3">Issues</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.latestPages.length === 0 ? (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No pages crawled yet.</td></tr>
              ) : data.latestPages.map((page) => (
                <tr key={page.id}>
                  <td className="p-3 font-mono">{page.statusCode}</td>
                  <td className="p-3 break-all max-w-md">{page.url}</td>
                  <td className="p-3">{page.responseTimeMs}ms</td>
                  <td className="p-3">{formatBytes(page.pageSizeBytes)}</td>
                  <td className="p-3 max-w-xs truncate">{page.title || 'Missing'}</td>
                  <td className="p-3">{page.wordCount}</td>
                  <td className="p-3">{page.crawlDepth}</td>
                  <td className="p-3">{page.issueCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border">
            <h3 className="font-semibold">Live Issues</h3>
          </div>
          <div className="divide-y divide-border max-h-[520px] overflow-y-auto">
            {data.latestIssues.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground">Issues appear here as soon as they are detected.</div>
            ) : data.latestIssues.map((issue) => (
              <article key={issue.id} className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <h4 className="font-semibold">{issue.title}</h4>
                  <span className={`text-xs px-2 py-1 rounded-md border capitalize ${severityClass(issue.severity)}`}>{issue.severity}</span>
                </div>
                <p className="text-sm text-muted-foreground">{issue.description}</p>
                <p className="text-xs break-all"><span className="text-muted-foreground">URL:</span> {issue.affectedUrl}</p>
                {issue.evidence && <p className="text-xs bg-muted/50 border border-border rounded p-2">{issue.evidence}</p>}
                <p className="text-sm"><span className="font-medium">Recommendation:</span> {issue.recommendation}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border">
            <h3 className="font-semibold">Timeline</h3>
          </div>
          <div className="divide-y divide-border max-h-[520px] overflow-y-auto">
            {data.latestEvents.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground">Waiting for audit worker...</div>
            ) : data.latestEvents.map((event) => (
              <div key={event.id} className="p-3 flex gap-3 text-sm">
                <span className="text-muted-foreground font-mono shrink-0">{new Date(event.timestamp).toLocaleTimeString()}</span>
                <div>
                  <div className="font-medium">{event.type}</div>
                  <div className="text-muted-foreground break-all">{event.message || event.affectedUrl || event.currentUrl}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function ConnectionBadge({ connection, now }: { connection: LiveAuditConnectionState; now: number }) {
  const isWebSocket = connection.transport === 'websocket';
  const isHealthy = connection.status === 'connected' || connection.status === 'polling';
  const isConnecting = connection.status === 'connecting' || connection.status === 'reconnecting';
  const Icon = isWebSocket ? Wifi : isHealthy ? Radio : WifiOff;
  const label = isWebSocket
    ? connection.status === 'connected'
      ? 'WebSocket live'
      : connection.status === 'connecting'
        ? 'WebSocket connecting'
        : connection.status === 'reconnecting'
          ? 'WebSocket reconnecting'
          : 'WebSocket issue'
    : 'Polling fallback';

  const colorClass = isHealthy
    ? 'border-green-500/20 bg-green-500/10 text-green-700'
    : isConnecting
      ? 'border-blue-500/20 bg-blue-500/10 text-blue-700'
      : 'border-yellow-500/20 bg-yellow-500/10 text-yellow-700';

  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${colorClass}`} title={connection.message}>
      <div className="flex items-center gap-2 font-medium whitespace-nowrap">
        <Icon className="w-4 h-4" />
        {label}
      </div>
      <div className="mt-0.5 text-[11px] opacity-80">{formatLastUpdate(connection.lastUpdateAt, now)}</div>
    </div>
  );
}

function CurrentWorkCard({
  currentWork,
  connection,
  now,
}: {
  currentWork: { phase: string; action: string; target: string; message: string };
  connection: LiveAuditConnectionState;
  now: number;
}) {
  return (
    <div className="mt-5 rounded-xl border border-border bg-muted/20 p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2 font-semibold">
          <Activity className="w-4 h-4 text-accent" />
          Working now
        </div>
        <div className="text-xs text-muted-foreground">{formatLastUpdate(connection.lastUpdateAt, now)}</div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3 text-sm">
        <Info label="Phase" value={currentWork.phase} />
        <Info label="Action" value={currentWork.action} />
        <Info label="Target" value={currentWork.target || 'Waiting for worker'} />
      </div>
      <div className="mt-3 rounded-lg border border-border bg-background/70 p-3 text-sm text-muted-foreground break-all">
        {currentWork.message}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 min-w-0">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium break-all">{value}</div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
      <div className="text-accent [&>svg]:w-5 [&>svg]:h-5">{icon}</div>
      <div>
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="font-semibold capitalize">{value}</div>
      </div>
    </div>
  );
}
