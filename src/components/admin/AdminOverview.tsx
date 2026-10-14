import { Activity, AlertTriangle, ArrowRight, BookOpen, CheckCircle2, ListFilter, Loader2, Settings2, Table2, Users } from 'lucide-react';
import { useAdminFilter } from './useAdminFilter';
import { Link } from '../../app/router';
import type { OperationsData, OperationsRange } from '../../lib/admin/types';
import { Notice } from '../ui/page-system';
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
  const maximum = Math.max(1, ...observations.map(day => day.audits));
  if (!trend.length) return <Empty text="No daily activity observations were returned for this window." />;
  return <>
    <div role="group" aria-label="Daily audit volume">
      {observations.length ? <div className="admin-activity-chart">{observations.map(day => {
        const completed = availableCount(day.completed) ? day.completed : 0;
        const warnings = availableCount(day.warnings) ? day.warnings : 0;
        const failed = availableCount(day.failed) ? day.failed : 0;
        const denominator = Math.max(1, day.audits, completed + warnings + failed);
        return <div key={day.day} className="admin-activity-column">
          <strong>{day.audits}</strong>
          <div role="img" aria-label={`${day.day}: ${day.audits} audits, ${countLabel(day.completed)} completed, ${countLabel(day.warnings)} with warnings, ${countLabel(day.failed)} failed`} className="admin-activity-bar" style={{ height: `${Math.max(1, day.audits / maximum * 78)}%` }}>
            {failed > 0 && <span style={{ height: `${failed / denominator * 100}%`, background: 'var(--danger)' }} />}
            {warnings > 0 && <span style={{ height: `${warnings / denominator * 100}%`, background: 'var(--warning)' }} />}
            {completed > 0 && <span style={{ height: `${completed / denominator * 100}%`, background: 'var(--action, var(--accent))' }} />}
          </div>
          <time dateTime={day.day}>{/^\d{4}-\d{2}-\d{2}$/.test(day.day) ? day.day.slice(5).replace('-', '/') : day.day}</time>
        </div>;
      })}</div> : <p className="text-sm text-muted-foreground">Daily audit volume is unavailable for all reported days.</p>}
      {observations.length > 0 && <div className="admin-chart-legend"><span><i style={{ background: 'var(--action, var(--accent))' }} />Completed</span><span><i style={{ background: 'var(--warning)' }} />With warnings</span><span><i style={{ background: 'var(--danger)' }} />Failed</span><span><i style={{ background: 'var(--muted)' }} />Other / unavailable</span></div>}
      {observations.length > 0 && observations.every(day => day.audits === 0) && <p className="text-sm text-muted-foreground">No audits recorded in the reported daily counts.</p>}
      {unavailable > 0 && observations.length > 0 && <p className="text-sm text-muted-foreground">Audit volume unavailable for {unavailable} reported {unavailable === 1 ? 'day' : 'days'}; omitted from the chart.</p>}
    </div>
    <details className="admin-chart-table"><summary><Table2 className="h-4 w-4" aria-hidden="true" />View daily figures</summary><div className="max-w-full overflow-x-auto" role="region" aria-label="Audit trend data table" tabIndex={0}><table className="suite-table w-full min-w-[620px]"><caption className="sr-only">Audit volume and outcomes by day</caption><thead><tr>{['Day', 'Audits', 'Completed', 'Warnings', 'Failed', 'Median duration'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{trend.map(day => <tr key={day.day}><th scope="row">{day.day}</th><td>{countLabel(day.audits)}</td><td>{countLabel(day.completed)}</td><td>{countLabel(day.warnings)}</td><td>{countLabel(day.failed)}</td><td>{day.medianDurationSeconds != null && availableCount(day.medianDurationSeconds) ? duration(day.medianDurationSeconds) : 'Unavailable'}</td></tr>)}</tbody></table></div></details>
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
  return <div className="admin-overview flex min-w-0 flex-col gap-10">
    <div className="admin-overview-toolbar flex min-w-0 flex-wrap items-center justify-between gap-4">
      <div className="flex min-h-11 items-center gap-2 text-sm font-semibold"><Activity className="h-4 w-4" aria-hidden="true" /> Platform{data && <HealthBadge status={data.status} />}</div>
      <div role="group" aria-label="Operations time range" className="admin-range flex flex-wrap gap-1 rounded-md border border-border p-1">{(['24h', '7d', '30d'] as const).map(value => <button type="button" key={value} aria-pressed={range === value} onClick={() => setRange(value)} className="min-h-10 rounded px-3.5 py-2 text-sm text-muted-foreground">{value === '24h' ? '24 hours' : value === '7d' ? '7 days' : '30 days'}</button>)}</div>
    </div>
    <DataNotice {...operations} />
    {!data ? <Notice tone="danger">Operations data is unavailable. Use the refresh control to try again.</Notice> : <>
      <div className="admin-metrics grid grid-cols-2 gap-y-6 md:grid-cols-4 md:gap-0">
        <Metric icon={ListFilter} label="Queued" value={countLabel(data.queue.queued)} detail="Waiting to start" />
        <Metric icon={Loader2} label="Running" value={countLabel(data.queue.running)} detail="Currently processing" />
        <Metric icon={CheckCircle2} label="Completed" value={availableCount(data.metrics.completed) && availableCount(data.metrics.warnings) ? data.metrics.completed + data.metrics.warnings : 'Unavailable'} detail={`${countLabel(data.metrics.warnings)} with warnings / ${range}`} tone={availableCount(data.metrics.completed) && availableCount(data.metrics.warnings) ? 'success' : 'accent'} />
        <Metric icon={AlertTriangle} label="Failed / abandoned" value={availableCount(data.metrics.failed) && availableCount(data.metrics.abandoned) ? data.metrics.failed + data.metrics.abandoned : 'Unavailable'} detail={`${countLabel(data.metrics.failed)} failed / ${countLabel(data.metrics.abandoned)} abandoned`} tone={data.metrics.failed + data.metrics.abandoned > 0 ? 'danger' : 'accent'} />
      </div>
      <div className="admin-overview-grid grid items-start gap-8">
        <Panel title="Audit activity" description={`Recorded outcomes in the last ${range === '24h' ? '24 hours' : range === '7d' ? '7 days' : '30 days'}.`}>
          <AuditActivity trend={data.trend} />
          <dl className="admin-overview-summary mt-6 grid grid-cols-3 gap-4 border-t border-border pt-6"><div><dt className="text-xs text-muted-foreground">Audit volume</dt><dd className="mt-2 text-lg font-semibold">{countLabel(data.metrics.audits)}</dd></div><div><dt className="text-xs text-muted-foreground">Success rate</dt><dd className="mt-2 text-lg font-semibold">{data.metrics.successRate == null ? 'Unavailable' : `${data.metrics.successRate.toFixed(1)}%`}</dd></div><div><dt className="text-xs text-muted-foreground">Median duration</dt><dd className="mt-2 text-lg font-semibold">{duration(data.metrics.medianDurationSeconds)}</dd></div></dl>
        </Panel>
        <div className="admin-overview-side flex min-w-0 flex-col gap-8 border-l border-border pl-8">
          <Panel title="Executors" action={<Link to="/admin/workers" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent">All workers <ArrowRight className="h-4 w-4" /></Link>}>
            {data.workers.length ? data.workers.map(worker => <WorkerStatus worker={worker} key={worker.id} />) : <Empty text="No registered worker evidence." />}
            <div className="mt-5"><WorkerWake refresh={operations.refresh} /></div>
          </Panel>
          <Panel title="Queue pressure" action={<Link to="/admin/queue" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent">Open queue <ArrowRight className="h-4 w-4" /></Link>}>
            <dl className="grid grid-cols-2 gap-6 sm:grid-cols-3">{[['Oldest queued', duration(data.queue.oldestQueuedSeconds)], ['Median wait', duration(data.queue.medianWaitSeconds)], ['Stale leases', data.queue.staleLeases]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-2 text-lg font-semibold tabular-nums">{value}</dd></div>)}</dl>
            <div className="mt-6 grid gap-6 sm:grid-cols-2">{[['By mode', data.queue.byMode], ['By plan', data.queue.byPlan]].map(([label, breakdown]) => <div key={String(label)}><h3 className="text-sm font-semibold">{String(label)}</h3>{Object.entries(breakdown).length ? <dl className="mt-3 space-y-2">{Object.entries(breakdown).map(([key, value]) => <div key={key} className="flex justify-between gap-3 text-sm"><dt className="capitalize text-muted-foreground">{key}</dt><dd>{value}</dd></div>)}</dl> : <p className="mt-3 text-sm text-muted-foreground">No queued work.</p>}</div>)}</div>
          </Panel>
        </div>
      </div>
      <Panel title="Needs attention" action={<span className="text-xs text-muted-foreground">Observed {timestamp(data.observedAt)}</span>}>
        {problems.length || otherReasons.length || data.queue.staleLeases ? <ul className="divide-y divide-border">
          {problems.map(([name, component]) => <li key={name} className="flex min-w-0 flex-wrap items-center justify-between gap-4 py-4"><div className="min-w-0 flex-1"><span className="text-sm font-semibold capitalize">{name}: {component.status}</span><p className="mt-1 break-words text-sm text-muted-foreground">{component.reason}</p></div><Link to={componentPaths[name] || '/admin/diagnostics'} className="quiet-button min-h-11">Inspect {name}</Link></li>)}
          {data.queue.staleLeases > 0 && <li className="flex flex-wrap items-center justify-between gap-4 py-4"><span className="text-sm">{data.queue.staleLeases} stale lease{data.queue.staleLeases === 1 ? '' : 's'}</span><Link to="/admin/queue" className="quiet-button min-h-11">Recover stale work</Link></li>}
          {otherReasons.map((reason, index) => <li key={index} className="flex min-w-0 flex-wrap items-center justify-between gap-4 py-4"><p className="min-w-0 flex-1 break-words text-sm">{reason}</p><Link to="/admin/diagnostics" className="quiet-button min-h-11">Inspect diagnostics</Link></li>)}
        </ul> : <p className="text-sm text-muted-foreground">No actionable platform problems.</p>}
      </Panel>
      <Panel title="Recent failures" action={<Link to="/admin/audits" className="quiet-button min-h-11">All audit jobs</Link>}>
        {data.recentFailures.length ? <div className="max-w-full overflow-x-auto" role="region" aria-label="Recent audit failures" tabIndex={0}><table className="suite-table min-w-[700px]"><caption className="sr-only">Recent failures with recorded reasons and audit details</caption><thead><tr><th scope="col">Audit</th><th scope="col">Reason</th><th scope="col">Created</th><th scope="col">Action</th></tr></thead><tbody>{data.recentFailures.map(failure => <tr key={failure.id}><th scope="row" className="max-w-64 break-all font-semibold">{failure.domain || failure.id}<div className="mt-2"><HealthBadge status={failure.status} /></div></th><td className="max-w-lg break-words"><p>{failure.error || 'No error message reported.'}</p><p className="mt-2 text-xs text-muted-foreground">{failure.failureClass || 'Unclassified'} / {failure.failureCode || 'No code'}</p></td><td className="whitespace-nowrap text-xs text-muted-foreground">{timestamp(failure.createdAt)}</td><td><button type="button" className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap text-sm font-semibold text-accent hover:underline" onClick={() => setAuditId(failure.id)}>View audit <ArrowRight className="h-4 w-4" /></button></td></tr>)}</tbody></table></div> : <Empty text="No recent failures in this window." />}
      </Panel>
      <div className="grid min-w-0 gap-8 xl:grid-cols-2">
        <Panel title="Component health">
          <dl className="divide-y divide-border">{Object.entries(data.components).map(([name, component]) => <div className="min-w-0 py-4 first:pt-0" key={name}><dt className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm font-semibold capitalize">{name}<HealthBadge status={component.status} /></dt><dd className="break-words text-sm text-muted-foreground">{component.reason || 'No reason reported.'}</dd></div>)}</dl>
        </Panel>
        <Suspense fallback={<Loading />}><AdminActions recent={data.recentActions} /></Suspense>
      </div>
      <nav className="admin-quick-links grid gap-4 border-t border-border pt-8 md:grid-cols-3 md:gap-8" aria-label="Administration shortcuts"><Link to="/admin/users" className="flex min-h-12 items-center gap-4 text-sm font-semibold text-foreground"><Users className="h-6 w-6 text-accent" /><span className="flex items-center gap-2">Manage users <ArrowRight className="h-4 w-4 text-accent" /></span></Link><Link to="/admin/blog" className="flex min-h-12 items-center gap-4 text-sm font-semibold text-foreground"><BookOpen className="h-6 w-6 text-accent" /><span className="flex items-center gap-2">Blog studio <ArrowRight className="h-4 w-4 text-accent" /></span></Link><Link to="/admin/plans" className="flex min-h-12 items-center gap-4 text-sm font-semibold text-foreground"><Settings2 className="h-6 w-6 text-accent" /><span className="flex items-center gap-2">Plan settings <ArrowRight className="h-4 w-4 text-accent" /></span></Link></nav>
      <DeferredSection title="Deployment evidence">
          <div className="mb-4 flex flex-wrap gap-2"><HealthBadge status={data.deployment.compatible == null ? 'unknown' : data.deployment.compatible ? 'compatible' : 'incompatible'} /><HealthBadge status={data.deployment.commitMismatch == null ? 'unknown' : data.deployment.commitMismatch ? 'commit mismatch' : 'commits match'} /></div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">{[['Application commit', data.deployment.applicationCommit], ['Worker commit', data.deployment.workerCommit], ['Expected schema', data.deployment.expectedSchemaVersion], ['Database schema', data.deployment.databaseSchemaVersion], ['Applied migration', data.deployment.appliedMigration]].map(([label, value]) => <div key={String(label)} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-all font-mono">{value ?? 'Not reported'}</dd></div>)}</dl>
      </DeferredSection>
    </>}
    {auditId && <Suspense fallback={<Loading />}><AuditDetailDrawer id={auditId} onClose={() => setAuditId(null)} onChanged={operations.refresh} /></Suspense>}
  </div>;
}
