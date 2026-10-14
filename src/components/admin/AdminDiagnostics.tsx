import { Activity,AlertTriangle,BarChart3,CheckCircle2,Clock3,Database,Gauge,Globe2,Loader2,ShieldAlert,Wifi,XCircle } from 'lucide-react';
import { useState } from 'react';
import { adminGet, adminPost } from './client';
import { DataNotice } from './operations-shared';
import { useAdminActionReason } from './AdminActionDialog';
import { Notice } from '../ui/page-system';
import { useAdminData } from './useAdminData';


import { Empty,Loading,Metric,Panel,SimpleTable } from './shared';
export default function AdminDiagnostics() {
  const diagnostics = useAdminData(signal => adminGet<any>('diagnostics', signal), []);
  const requestReason = useAdminActionReason();
  const [testRunning, setTestRunning] = useState(false);
  const [testMessage, setTestMessage] = useState('');
  const [testError, setTestError] = useState('');
  if (diagnostics.loading && !diagnostics.data) return <Loading />;
  if (!diagnostics.data) return <Notice tone="danger" title="Diagnostics could not load">{diagnostics.error || 'No diagnostics data was returned.'}</Notice>;
  const data: any = diagnostics.data;
  const compatibility = data.compatibility || {};
  const metrics = data.metrics || {};
  const operations = data.operations || {};
  const monitoring = data.monitoring || {};
  const operationsTone = operations.status === 'healthy' ? 'success' : operations.status === 'critical' ? 'danger' : 'warning';
  const sendTest = async () => {
    const reason = await requestReason('requesting an API monitoring verification event');
    if (!reason) return;
    setTestRunning(true);
    setTestMessage('');
    setTestError('');
    try {
      const result = await adminPost<{ initiated: boolean }>('diagnostics/sentry-test', { reason });
      setTestMessage(result.initiated
        ? `API verification event requested. Confirm delivery in Sentry. Request ID: ${result.requestId}`
        : 'Sentry API monitoring is not configured for this deployment.');
    } catch (error) {
      setTestError(error instanceof Error ? error.message : 'The verification event could not be sent.');
    } finally {
      setTestRunning(false);
    }
  };
  return (
    <div className="space-y-10">
      <DataNotice {...diagnostics} />
      <Panel title="Production health" description="Recorded signals from the last 24 hours." icon={Activity}>
        <Notice tone={operationsTone} title={`Platform status: ${operations.status || 'unknown'}`}>{operations.reasons?.length ? operations.reasons.join(' ') : 'No actionable reliability condition is active.'}</Notice>
        <div className="admin-metrics mt-8"><Metric icon={Wifi} label="Audit engines online" value={operations.activeWorkerCount ?? 0} detail={operations.lastWorkerHeartbeat ? `Last contact ${new Date(operations.lastWorkerHeartbeat).toLocaleString()}` : 'No heartbeat'} tone={operations.workerOnline ? 'success' : 'danger'} /><Metric icon={Clock3} label="Oldest queue age" value={operations.oldestQueuedAgeSeconds == null ? '--' : `${Math.round(operations.oldestQueuedAgeSeconds / 60)}m`} detail={`${operations.queuedAuditCount ?? 0} waiting`} tone={(operations.oldestQueuedAgeSeconds || 0) > 300 ? 'warning' : 'success'} /><Metric icon={CheckCircle2} label="Completion rate" value={operations.recentCompletionRate == null ? '--' : `${Math.round(operations.recentCompletionRate * 100)}%`} detail="Recent terminal audits" tone={operations.recentCompletionRate != null && operations.recentCompletionRate < 0.75 ? 'danger' : 'success'} /><Metric icon={Clock3} label="Median duration" value={operations.medianAuditDurationMs == null ? '--' : `${Math.round(operations.medianAuditDurationMs / 1000)}s`} detail={`${operations.realtimeFallbackCount ?? 0} HTTP fallback audit(s)`} /></div>
        <div className="mt-8 grid gap-4 border-t border-border pt-6 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-4"><span>Application: <code>{operations.applicationCommit || 'unknown'}</code></span><span>Audit engine: <code>{operations.workerCommit || 'unknown'}</code></span><span>Schema: database {operations.databaseSchemaVersion ?? 'unknown'} / API {operations.apiSchemaVersion ?? 'unknown'}</span><span>Deep audit: {operations.deepAuditEnabled ? 'enabled' : 'disabled'}</span></div>
      </Panel>
      <Panel title="Deployment compatibility" description="Frontend/API expectations compared with the database ledger and latest audit-engine heartbeat." icon={Gauge}>
        <Notice tone={compatibility.compatible ? 'success' : 'danger'} title={compatibility.compatible ? 'Versions are compatible' : 'Audit starts are protected'}>{compatibility.compatible ? 'Database and audit-engine contracts match the active API.' : `Compatibility status: ${compatibility.status || 'unknown'}. New audits are blocked when a known mismatch could corrupt data.`}</Notice>
        <div className="admin-metrics mt-8"><Metric icon={Clock3} label="Waiting" value={metrics.queued || 0} detail={metrics.oldestQueuedAt ? `Oldest ${new Date(metrics.oldestQueuedAt).toLocaleString()}` : 'No queued audits'} /><Metric icon={Activity} label="Checking" value={metrics.running || 0} detail={`${metrics.staleLeases || 0} stale leases`} tone={metrics.staleLeases ? 'danger' : 'success'} /><Metric icon={CheckCircle2} label="Warnings today" value={metrics.completedWithWarnings || 0} detail={`${metrics.completed || 0} clean completions`} tone="warning" /><Metric icon={XCircle} label="Failed / abandoned" value={(metrics.failed || 0) + (metrics.abandoned || 0)} detail={`${metrics.abandoned || 0} abandoned`} tone={(metrics.failed || metrics.abandoned) ? 'danger' : 'success'} /></div>
      </Panel>
      <Panel
        title="Error monitoring"
        description="Safe configuration state for browser, API, audit engine, and production source maps."
        icon={ShieldAlert}
        action={(
          <button
            type="button"
            className="quiet-button min-h-11 px-3 py-1.5 text-xs"
            onClick={sendTest}
            disabled={testRunning || !monitoring.apiConfigured}
          >
            {testRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
            Send API test
          </button>
        )}
      >
        <dl className="admin-service-grid grid grid-cols-2 gap-6 md:grid-cols-3 md:gap-x-8">{[
          { label: 'Browser', configured: monitoring.browserConfigured, detail: 'Errors and low-sample traces', icon: Activity },
          { label: 'API', configured: monitoring.apiConfigured, detail: 'Unexpected server failures', icon: Database },
          { label: 'Audit engine', configured: monitoring.workerConfigured, detail: 'Latest worker heartbeat', icon: Wifi },
          { label: 'Source maps', configured: monitoring.sourceMapsConfigured, detail: `Environment: ${monitoring.environment || 'unknown'}`, icon: Gauge },
          { label: 'Search Console', configured: monitoring.searchConsoleConfigured, detail: 'Server-only OAuth connection', icon: BarChart3, optional: true },
          { label: 'Project scheduler', configured: monitoring.projectSchedulerConfigured, detail: 'Admission only; worker crawls', icon: Clock3 },
          { label: 'Canonical app URL', configured: monitoring.canonicalAppUrlConfigured, detail: 'Public links and OAuth callbacks', icon: Globe2 },
        ].map(({ label, configured, detail, icon: Icon, optional }) => <div key={label} className="min-w-0 border-b border-border py-4"><dt className="flex items-center gap-3 text-sm font-semibold"><Icon className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />{label}</dt><dd className="mt-3"><span className={`text-sm ${configured ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground'}`}>{configured ? 'Configured' : optional ? 'Optional' : 'Not configured'}</span><p className="mt-2 text-xs leading-5 text-muted-foreground">{detail}</p></dd></div>)}</dl>
        {testMessage && <Notice tone="success" className="mt-4">{testMessage}</Notice>}
        {testError && <Notice tone="danger" className="mt-4">{testError}</Notice>}
      </Panel>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Recent API errors" description="Restricted request IDs and internal diagnostics. Never shown in customer responses." icon={ShieldAlert}>{(data.recentApiErrors || []).length ? <SimpleTable rows={data.recentApiErrors.slice(0, 20)} columns={['request_id', 'route', 'internal_code', 'created_at']} /> : <Empty text="No recent API errors." />}</Panel>
        <Panel title="Failure categories" description="Target failures grouped by stable code from audits created in the last 24 hours." icon={AlertTriangle}>{Object.keys(metrics.failuresByCode || {}).length ? <div className="grid gap-2">{Object.entries(metrics.failuresByCode).sort(([, left]: any, [, right]: any) => Number(right) - Number(left)).map(([code, count]) => <div key={code} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"><code>{code}</code><span className="font-semibold">{String(count)}</span></div>)}</div> : <Empty text="No page failure categories recorded today." />}</Panel>
      </div>
      <Panel title="Recent audit diagnostics" description="Bounded diagnostic evidence without internal payloads." icon={Database}>{(data.recentAuditDiagnostics || []).length ? <SimpleTable rows={data.recentAuditDiagnostics.slice(0, 25)} columns={['audit_id', 'failure_code', 'phase', 'attempt_count', 'request_duration_ms', 'created_at']} /> : <Empty text="No recent audit diagnostics." />}</Panel>
      <Notice tone="info">Database storage and Realtime quota totals remain provider-dashboard metrics. Crawlio labels them unavailable instead of estimating or inventing usage.</Notice>
    </div>
  );
}
