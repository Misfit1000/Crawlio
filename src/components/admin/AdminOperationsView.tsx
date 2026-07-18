import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle2, Clock3, Layers3, RefreshCw, Users, Wifi, XCircle } from 'lucide-react';
import { getAdminControlOverview, type AdminRange } from '../../lib/admin/client';
import { SparklineChart } from '../ui/visual-system';
import { Panel } from '../ui/page-system';
import { AdminError, AdminLoading, AdminMetric, AdminStatus, formatAdminDate } from './AdminControlPrimitives';

export default function AdminOperationsView() {
  const [range, setRange] = useState<AdminRange>('24h');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getAdminControlOverview(range));
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Operations data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  const charts = useMemo(() => {
    const rows = data?.timeSeries || [];
    return {
      completed: rows.map((row: any) => row.completed),
      pages: rows.map((row: any) => row.pagesCrawled),
      duration: rows.map((row: any) => Number(row.averageDurationSeconds || 0)),
    };
  }, [data]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Platform operations</h2>
          <p className="mt-1 text-sm text-muted-foreground">Queue throughput, completion, plan use, and audit-engine heartbeat.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-muted/55 p-1" aria-label="Operations time range">
            {(['24h', '7d', '30d'] as AdminRange[]).map((value) => (
              <button key={value} type="button" onClick={() => setRange(value)} className={`min-h-8 rounded-md px-3 text-xs font-semibold ${range === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                {value}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => void load()} className="quiet-button min-h-10"><RefreshCw className="h-4 w-4" />Refresh</button>
        </div>
      </div>

      {error && <AdminError message={error} />}
      {loading && !data ? <AdminLoading /> : data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <AdminMetric icon={Users} label="Active users" value={data.totals.activeUsers} detail="Non-suspended accounts" />
            <AdminMetric icon={Clock3} label="Audit starts" value={data.totals.queued + data.totals.running + data.totals.completed + data.totals.failed} detail={`Within the last ${range}`} />
            <AdminMetric icon={CheckCircle2} label="Completion rate" value={data.totals.completionRate == null ? 'N/A' : `${data.totals.completionRate}%`} detail="Completed versus terminal audits" tone="success" />
            <AdminMetric icon={Layers3} label="Pages checked" value={data.totals.pagesCrawled.toLocaleString()} detail="Recorded by finished and active jobs" />
            <AdminMetric icon={XCircle} label="Terminal failures" value={data.totals.failed} detail="Failed, cancelled, or abandoned" tone={data.totals.failed ? 'danger' : 'success'} />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <SparklineChart values={charts.completed} label="Completed audits" valueLabel={String(data.totals.completed)} detail={`Throughput across ${range}`} />
            <SparklineChart values={charts.pages} label="Pages checked" valueLabel={data.totals.pagesCrawled.toLocaleString()} detail={`Page coverage across ${range}`} />
            <SparklineChart values={charts.duration} label="Average duration" valueLabel={`${Math.round(charts.duration.at(-1) || 0)}s`} detail="Terminal audit duration by time bucket" />
          </div>

          <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <Panel>
              <div className="flex items-center gap-2"><Activity className="h-4 w-4 text-accent" /><h3 className="font-semibold">Plan use</h3></div>
              <div className="mt-4 space-y-4">
                {Object.entries(data.planUse || {}).map(([plan, count]) => {
                  const max = Math.max(1, ...Object.values(data.planUse || {}).map(Number));
                  return (
                    <div key={plan}>
                      <div className="mb-1.5 flex items-center justify-between text-sm"><span className="capitalize text-muted-foreground">{plan}</span><span className="font-semibold tabular-nums">{Number(count)}</span></div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-blue-500 transition-[width] duration-500" style={{ width: `${(Number(count) / max) * 100}%` }} /></div>
                    </div>
                  );
                })}
              </div>
            </Panel>

            <Panel>
              <div className="flex items-center gap-2"><Wifi className="h-4 w-4 text-accent" /><h3 className="font-semibold">Audit-engine heartbeat</h3></div>
              <div className="mt-4 divide-y divide-border">
                {(data.workers || []).length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No worker heartbeat has been recorded.</p>
                ) : data.workers.map((worker: any) => {
                  const healthy = Date.now() - new Date(worker.updated_at).getTime() < 3 * 60_000;
                  return (
                    <div key={worker.id || worker.key} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                      <div>
                        <div className="font-semibold">{worker.value?.workerId || worker.key}</div>
                        <div className="mt-1 text-xs text-muted-foreground">Last heartbeat {formatAdminDate(worker.updated_at)}</div>
                      </div>
                      <AdminStatus value={healthy ? 'healthy' : 'stale'} />
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <h3 className="font-semibold">Failure categories</h3>
              <p className="mt-1 text-sm text-muted-foreground">Categorized without exposing raw internal error details.</p>
              <div className="mt-4 space-y-2">
                {(data.failureCategories || []).length === 0
                  ? <p className="py-6 text-center text-sm text-muted-foreground">No terminal failures in this range.</p>
                  : data.failureCategories.map((item: any) => (
                    <div key={item.category} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                      <span className="capitalize text-muted-foreground">{item.category.replace(/_/g, ' ')}</span>
                      <span className="font-semibold tabular-nums">{item.count}</span>
                    </div>
                  ))}
              </div>
            </Panel>
            <Panel>
              <h3 className="font-semibold">Deployment compatibility</h3>
              <p className="mt-1 text-sm text-muted-foreground">Database and service versions reported by each runtime.</p>
              <div className="mt-4 divide-y divide-border">
                {(data.deployments || []).map((deployment: any) => (
                  <div key={deployment.component} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div>
                      <div className="font-semibold capitalize">{deployment.component}</div>
                      <div className="mt-1 font-mono text-xs text-muted-foreground">{deployment.commit_identifier || 'Commit not reported'}</div>
                    </div>
                    <span className="text-xs text-muted-foreground">Schema {deployment.api_schema_version}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
