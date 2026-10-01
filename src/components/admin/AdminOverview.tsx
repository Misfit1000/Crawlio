import { Activity, AlertTriangle, BarChart3, CheckCircle2, Clock3, Gauge, ShieldAlert } from 'lucide-react';
import { useAdminFilter } from './useAdminFilter';
import { Link } from '../../app/router';
import type { OperationsData, OperationsRange } from '../../lib/admin/types';
import { Notice } from '../ui/page-system';
import { adminGet } from './client';
import { useAdminData } from './useAdminData';
import { Empty, Loading, Metric, Panel } from './shared';
import { DataNotice, duration, HealthBadge, healthTone, QuietNotice, timestamp } from './operations-shared';
import { WorkerStatus, WorkerWake } from './AdminWorkers';
import { AuditDetailDrawer } from './AdminDetails';
import { useState } from 'react';
import AdminActions from './AdminActions';

export default function AdminOverview() {
  const [rangeValue, setRange] = useAdminFilter('range', '7d');
  const range: OperationsRange = ['24h', '7d', '30d'].includes(rangeValue) ? rangeValue as OperationsRange : '7d';
  const operations = useAdminData(signal => adminGet<OperationsData>(`operations?range=${range}`, signal), [range]);
  const [auditId, setAuditId] = useState<string | null>(null);
  const data = operations.data;
  if (operations.loading && !data) return <Loading />;
  return <div className="min-w-0 space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-h-11 items-center gap-2 text-sm font-semibold"><Activity className="h-4 w-4" /> Observe{data && <HealthBadge status={data.status} />}</div>
      <div role="group" aria-label="Operations time range" className="flex flex-wrap gap-1">{(['24h', '7d', '30d'] as const).map(value => <button type="button" key={value} aria-pressed={range === value} onClick={() => setRange(value)} className={`min-h-11 min-w-14 rounded-md px-3 text-sm font-semibold ${range === value ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'}`}>{value === '24h' ? '24 hours' : value === '7d' ? '7 days' : '30 days'}</button>)}</div>
    </div>
    <DataNotice {...operations} />
    {!data ? <Notice tone="danger">Operations data is unavailable. Use the refresh control to try again.</Notice> : <>
      <QuietNotice tone={healthTone(data.status)} title={`Platform: ${data.status}`}><ul className="space-y-1">{data.reasons.length ? data.reasons.map((reason, index) => <li key={index}>{reason}</li>) : <li>No actionable condition reported.</li>}</ul><p className="mt-2 text-xs">Observed: {timestamp(data.observedAt)}</p></QuietNotice>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={BarChart3} label="Audit volume" value={data.metrics.audits} detail={`${data.metrics.completed} clean / ${data.metrics.warnings} with warnings`} />
        <Metric icon={CheckCircle2} label="Success rate" value={data.metrics.successRate == null ? 'Unavailable' : `${data.metrics.successRate.toFixed(1)}%`} detail={`Server-calculated for ${range}`} tone={data.metrics.successRate == null ? 'accent' : data.metrics.successRate < 90 ? 'warning' : 'success'} />
        <Metric icon={Clock3} label="Median duration" value={duration(data.metrics.medianDurationSeconds)} detail="Completed audit duration" />
        <Metric icon={AlertTriangle} label="Failed / abandoned" value={data.metrics.failed + data.metrics.abandoned} detail={`${data.metrics.failed} failed / ${data.metrics.abandoned} abandoned`} tone={data.metrics.failed + data.metrics.abandoned ? 'danger' : 'success'} />
      </div>
      <Panel title="Component health" description="Diagnose" icon={Gauge}>
        <dl className="grid min-w-0 gap-x-5 sm:grid-cols-2 xl:grid-cols-5">{Object.entries(data.components).map(([name, component]) => <div className="min-w-0 border-b border-border py-3" key={name}><dt className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm font-semibold capitalize">{name}<HealthBadge status={component.status} /></dt><dd className="break-words text-sm text-muted-foreground">{component.reason || 'No reason reported.'}</dd></div>)}</dl>
      </Panel>
      <div className="grid min-w-0 gap-5 xl:grid-cols-2">
        <Panel title="Queue pressure" icon={Clock3} action={<Link to="/admin/queue" className="quiet-button min-h-11">Inspect queue</Link>}>
          <dl className="grid gap-4 sm:grid-cols-2">{[['Queued', data.queue.queued], ['Running', data.queue.running], ['Oldest queued', duration(data.queue.oldestQueuedSeconds)], ['Median wait', duration(data.queue.medianWaitSeconds)], ['Stale leases', data.queue.staleLeases]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold">{value}</dd></div>)}</dl>
          <div className="mt-5 grid gap-5 border-t border-border pt-4 sm:grid-cols-2">{[['By mode', data.queue.byMode], ['By plan', data.queue.byPlan]].map(([label, breakdown]) => <div key={String(label)}><h3 className="text-sm font-semibold">{String(label)}</h3>{Object.entries(breakdown).length ? <dl className="mt-2 space-y-2">{Object.entries(breakdown).map(([key, value]) => <div key={key} className="flex justify-between gap-3 text-sm"><dt className="capitalize text-muted-foreground">{key}</dt><dd>{value}</dd></div>)}</dl> : <p className="mt-2 text-sm text-muted-foreground">No queued work.</p>}</div>)}</div>
        </Panel>
        <Panel title="Deployment evidence" icon={ShieldAlert}>
          <div className="mb-4 flex flex-wrap gap-2"><HealthBadge status={data.deployment.compatible == null ? 'unknown' : data.deployment.compatible ? 'compatible' : 'incompatible'} /><HealthBadge status={data.deployment.commitMismatch == null ? 'unknown' : data.deployment.commitMismatch ? 'commit mismatch' : 'commits match'} /></div>
          <dl className="space-y-3 text-sm">{[['Application commit', data.deployment.applicationCommit], ['Worker commit', data.deployment.workerCommit], ['Expected schema', data.deployment.expectedSchemaVersion], ['Database schema', data.deployment.databaseSchemaVersion], ['Applied migration', data.deployment.appliedMigration]].map(([label, value]) => <div key={String(label)} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-all font-mono">{value ?? 'Not reported'}</dd></div>)}</dl>
        </Panel>
      </div>
      <Panel title="Audit trend" description={`Daily outcomes in the selected ${range} window.`} icon={BarChart3}>
        {data.trend.length ? <div className="max-w-full overflow-x-auto"><table className="suite-table w-full min-w-[620px]"><caption className="sr-only">Audit volume and outcomes by day</caption><thead><tr>{['Day', 'Audits', 'Completed', 'Warnings', 'Failed', 'Median duration'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{data.trend.map(day => <tr key={day.day}><th scope="row">{day.day}</th><td>{day.audits}</td><td>{day.completed}</td><td>{day.warnings}</td><td>{day.failed}</td><td>{duration(day.medianDurationSeconds)}</td></tr>)}</tbody></table></div> : <Empty text="No audits in this window." />}
      </Panel>
      <Panel title="Recent failures" description="Diagnose failure evidence before retrying or recovering a job." icon={AlertTriangle}>
        {data.recentFailures.length ? <ul className="divide-y divide-border">{data.recentFailures.map(failure => <li key={failure.id} className="flex min-w-0 flex-col gap-3 py-4 sm:flex-row sm:justify-between"><div className="min-w-0"><button type="button" className="min-h-11 break-all text-left text-sm font-semibold text-accent hover:underline" onClick={() => setAuditId(failure.id)}>{failure.domain || failure.id}</button><p className="break-words text-sm text-muted-foreground">{failure.error || 'No error message reported.'}</p><p className="mt-2 break-words text-xs text-muted-foreground">{failure.failureClass || 'Unclassified'} / {failure.failureCode || 'No code'} / {timestamp(failure.createdAt)}</p></div><div><HealthBadge status={failure.status} /></div></li>)}</ul> : <Empty text="No recent failures in this window." />}
      </Panel>
      <Panel title="Operational controls" description="Act" icon={Activity}>
        <div className="flex flex-wrap gap-3"><WorkerWake refresh={operations.refresh} /><Link to="/admin/queue" className="quiet-button min-h-11">Recover stale work</Link><Link to="/admin/users" className="quiet-button min-h-11">Account controls</Link><Link to="/admin/settings" className="quiet-button min-h-11">Resources and retention</Link></div>
        <div className="mt-5">{data.workers.length ? data.workers.map(worker => <WorkerStatus worker={worker} key={worker.id} />) : <Empty text="No registered worker evidence." />}</div>
      </Panel>
      <AdminActions recent={data.recentActions} />
    </>}
    {auditId && <AuditDetailDrawer id={auditId} onClose={() => setAuditId(null)} onChanged={operations.refresh} />}
  </div>;
}
