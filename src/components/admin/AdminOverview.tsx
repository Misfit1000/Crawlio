import { Activity, AlertTriangle, BarChart3, CheckCircle2, Clock3 } from 'lucide-react';
import { useAdminFilter } from './useAdminFilter';
import { Link } from '../../app/router';
import type { OperationsData, OperationsRange } from '../../lib/admin/types';
import { Notice } from '../ui/page-system';
import { MetricBarChart } from '../ui/visual-system';
import { adminGet } from './client';
import { useAdminData } from './useAdminData';
import { Empty, Loading, Metric, Panel } from './shared';
import { DataNotice, duration, HealthBadge, healthTone, timestamp } from './operations-shared';
import { WorkerStatus, WorkerWake } from './AdminWorkers';
import { lazy, Suspense, useState } from 'react';
import DeferredSection from './DeferredSection';

const AuditDetailDrawer = lazy(() => import('./AdminDetails').then(module => ({ default: module.AuditDetailDrawer })));
const AdminActions = lazy(() => import('./AdminActions'));

const componentPaths: Record<string, string> = { api: '/admin/diagnostics', database: '/admin/diagnostics', worker: '/admin/workers', queue: '/admin/queue', deployment: '/admin/diagnostics' };

const availableCount = (value: number) => Number.isFinite(value) && value >= 0;
const countLabel = (value: number) => availableCount(value) ? value : 'Unavailable';

function AuditActivity({ trend }: { trend: OperationsData['trend'] }) {
  const observations = trend.filter(day => availableCount(day.audits));
  const unavailable = trend.length - observations.length;
  if (!trend.length) return <Empty text="No daily activity observations were returned for this window." />;
  return <>
    <div role="group" aria-label="Daily audit volume" className="mb-5 space-y-3">
      {observations.length ? <MetricBarChart items={observations.map(day => ({ label: day.day, value: day.audits, color: 'bg-[var(--category-cobalt)]' }))} title="Daily audit volume" description="Reported counts only; each bar represents one day." framed={false} /> : <p className="text-sm text-muted-foreground">Daily audit volume is unavailable for all reported days.</p>}
      {observations.length > 0 && observations.every(day => day.audits === 0) && <p className="text-sm text-muted-foreground">No audits recorded in the reported daily counts.</p>}
      {unavailable > 0 && observations.length > 0 && <p className="text-sm text-muted-foreground">Audit volume unavailable for {unavailable} reported {unavailable === 1 ? 'day' : 'days'}; omitted from the chart.</p>}
    </div>
    <div className="max-w-full overflow-x-auto" role="region" aria-label="Audit trend data table" tabIndex={0}><table className="suite-table w-full min-w-[620px]"><caption className="sr-only">Audit volume and outcomes by day</caption><thead><tr>{['Day', 'Audits', 'Completed', 'Warnings', 'Failed', 'Median duration'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{trend.map(day => <tr key={day.day}><th scope="row">{day.day}</th><td>{countLabel(day.audits)}</td><td>{countLabel(day.completed)}</td><td>{countLabel(day.warnings)}</td><td>{countLabel(day.failed)}</td><td>{day.medianDurationSeconds != null && availableCount(day.medianDurationSeconds) ? duration(day.medianDurationSeconds) : 'Unavailable'}</td></tr>)}</tbody></table></div>
  </>;
}

export default function AdminOverview() {
  const [rangeValue, setRange] = useAdminFilter('range', '7d');
  const range: OperationsRange = ['24h', '7d', '30d'].includes(rangeValue) ? rangeValue as OperationsRange : '7d';
  const operations = useAdminData(signal => adminGet<OperationsData>(`operations?range=${range}`, signal), [range]);
  const [auditId, setAuditId] = useState<string | null>(null);
  const data = operations.data;
  const problems = data ? Object.entries(data.components).filter(([, component]) => healthTone(component.status) !== 'success') : [];
  const otherReasons = data?.reasons.filter(reason => !problems.some(([, component]) => component.reason === reason)) || [];
  if (operations.loading && !data) return <Loading />;
  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-h-11 items-center gap-2 text-sm font-semibold"><Activity className="h-4 w-4" aria-hidden="true" /> Platform{data && <HealthBadge status={data.status} />}</div>
      <div role="group" aria-label="Operations time range" className="flex flex-wrap gap-1">{(['24h', '7d', '30d'] as const).map(value => <button type="button" key={value} aria-pressed={range === value} onClick={() => setRange(value)} className={`min-h-11 min-w-14 rounded-md px-3 text-sm font-semibold ${range === value ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'}`}>{value === '24h' ? '24 hours' : value === '7d' ? '7 days' : '30 days'}</button>)}</div>
    </div>
    <DataNotice {...operations} />
    {!data ? <Notice tone="danger">Operations data is unavailable. Use the refresh control to try again.</Notice> : <>
      <section aria-labelledby="admin-attention-title" className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="admin-attention-title" className="text-base font-semibold">Needs attention</h2><span className="text-xs text-muted-foreground">Observed {timestamp(data.observedAt)}</span></div>
        {problems.length || otherReasons.length || data.queue.staleLeases || data.metrics.failed + data.metrics.abandoned ? <ul className="mt-2 divide-y divide-border">
          {problems.map(([name, component]) => <li key={name} className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-2"><div className="min-w-0 flex-1"><span className="text-sm font-semibold capitalize">{name}: {component.status}</span><p className="break-words text-sm text-muted-foreground">{component.reason}</p></div><Link to={componentPaths[name] || '/admin/diagnostics'} className="quiet-button min-h-11">Inspect {name}</Link></li>)}
          {data.queue.staleLeases > 0 && <li className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="text-sm">{data.queue.staleLeases} stale lease{data.queue.staleLeases === 1 ? '' : 's'}</span><Link to="/admin/queue" className="quiet-button min-h-11">Recover stale work</Link></li>}
          {data.metrics.failed + data.metrics.abandoned > 0 && <li className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="text-sm">{data.metrics.failed} failed / {data.metrics.abandoned} abandoned audits</span><Link to="/admin/audits" className="quiet-button min-h-11">Review audits</Link></li>}
          {otherReasons.map((reason, index) => <li key={index} className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-2"><p className="min-w-0 flex-1 break-words text-sm">{reason}</p><Link to="/admin/diagnostics" className="quiet-button min-h-11">Inspect diagnostics</Link></li>)}
        </ul> : <p className="mt-2 text-sm text-muted-foreground">No actionable problems.</p>}
      </section>
      <div className="grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric icon={BarChart3} label="Audit volume" value={data.metrics.audits} detail={`${data.metrics.completed} clean / ${data.metrics.warnings} with warnings`} />
        <Metric icon={CheckCircle2} label="Success rate" value={data.metrics.successRate == null ? 'Unavailable' : `${data.metrics.successRate.toFixed(1)}%`} detail={`Selected ${range} window`} tone={data.metrics.successRate == null ? 'accent' : data.metrics.successRate < 90 ? 'warning' : 'success'} />
        <Metric icon={Clock3} label="Median duration" value={duration(data.metrics.medianDurationSeconds)} detail="Completed audit duration" />
        <Metric icon={AlertTriangle} label="Failed / abandoned" value={data.metrics.failed + data.metrics.abandoned} detail={`${data.metrics.failed} failed / ${data.metrics.abandoned} abandoned`} tone={data.metrics.failed + data.metrics.abandoned ? 'danger' : 'success'} />
      </div>
      <div className="grid min-w-0 gap-5 xl:grid-cols-2">
      <Panel title="Queue pressure" action={<Link to="/admin/queue" className="quiet-button min-h-11">Inspect queue</Link>}>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">{[['Queued', data.queue.queued], ['Running', data.queue.running], ['Oldest queued', duration(data.queue.oldestQueuedSeconds)], ['Median wait', duration(data.queue.medianWaitSeconds)], ['Stale leases', data.queue.staleLeases]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd></div>)}</dl>
          <div className="mt-5 grid gap-5 border-t border-border pt-4 sm:grid-cols-2">{[['By mode', data.queue.byMode], ['By plan', data.queue.byPlan]].map(([label, breakdown]) => <div key={String(label)}><h3 className="text-sm font-semibold">{String(label)}</h3>{Object.entries(breakdown).length ? <dl className="mt-2 space-y-2">{Object.entries(breakdown).map(([key, value]) => <div key={key} className="flex justify-between gap-3 text-sm"><dt className="capitalize text-muted-foreground">{key}</dt><dd>{value}</dd></div>)}</dl> : <p className="mt-2 text-sm text-muted-foreground">No queued work.</p>}</div>)}</div>
      </Panel>
      <Panel title="Component health">
        <dl className="divide-y divide-border">{Object.entries(data.components).map(([name, component]) => <div className="min-w-0 py-3 first:pt-0" key={name}><dt className="mb-1 flex flex-wrap items-center justify-between gap-2 text-sm font-semibold capitalize">{name}<HealthBadge status={component.status} /></dt><dd className="break-words text-sm text-muted-foreground">{component.reason || 'No reason reported.'}</dd></div>)}</dl>
      </Panel>
      </div>
      <Panel title="Audit trend" description={`Volume and outcomes over the selected ${range} window.`}>
        <AuditActivity trend={data.trend} />
      </Panel>
      <div className="grid min-w-0 gap-5 xl:grid-cols-2">
      <Panel title="Recent failures" action={<Link to="/admin/audits" className="quiet-button min-h-11">All audit jobs</Link>}>
        {data.recentFailures.length ? <ul className="divide-y divide-border">{data.recentFailures.map(failure => <li key={failure.id} className="flex min-w-0 flex-col gap-3 py-4 sm:flex-row sm:justify-between"><div className="min-w-0"><button type="button" className="min-h-11 break-all text-left text-sm font-semibold text-accent hover:underline" onClick={() => setAuditId(failure.id)}>{failure.domain || failure.id}</button><p className="break-words text-sm text-muted-foreground">{failure.error || 'No error message reported.'}</p><p className="mt-2 break-words text-xs text-muted-foreground">{failure.failureClass || 'Unclassified'} / {failure.failureCode || 'No code'} / {timestamp(failure.createdAt)}</p></div><div><HealthBadge status={failure.status} /></div></li>)}</ul> : <Empty text="No recent failures in this window." />}
      </Panel>
      <Suspense fallback={<Loading />}><AdminActions recent={data.recentActions} /></Suspense>
      </div>
      <Panel title="Workers and controls">
        <div className="flex flex-wrap gap-3"><WorkerWake refresh={operations.refresh} /><Link to="/admin/users" className="quiet-button min-h-11">Account controls</Link><Link to="/admin/settings" className="quiet-button min-h-11">Resources and retention</Link></div>
        <div className="mt-5">{data.workers.length ? data.workers.map(worker => <WorkerStatus worker={worker} key={worker.id} />) : <Empty text="No registered worker evidence." />}</div>
      </Panel>
      <DeferredSection title="Deployment evidence">
          <div className="mb-4 flex flex-wrap gap-2"><HealthBadge status={data.deployment.compatible == null ? 'unknown' : data.deployment.compatible ? 'compatible' : 'incompatible'} /><HealthBadge status={data.deployment.commitMismatch == null ? 'unknown' : data.deployment.commitMismatch ? 'commit mismatch' : 'commits match'} /></div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">{[['Application commit', data.deployment.applicationCommit], ['Worker commit', data.deployment.workerCommit], ['Expected schema', data.deployment.expectedSchemaVersion], ['Database schema', data.deployment.databaseSchemaVersion], ['Applied migration', data.deployment.appliedMigration]].map(([label, value]) => <div key={String(label)} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-all font-mono">{value ?? 'Not reported'}</dd></div>)}</dl>
      </DeferredSection>
    </>}
    {auditId && <Suspense fallback={<Loading />}><AuditDetailDrawer id={auditId} onClose={() => setAuditId(null)} onChanged={operations.refresh} /></Suspense>}
  </div>;
}
