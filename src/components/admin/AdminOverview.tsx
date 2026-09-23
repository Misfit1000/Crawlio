import { BarChart3,CheckCircle2,Clock3,RefreshCw,ShieldAlert,Users,Wifi,XCircle } from 'lucide-react';
import { useMemo } from 'react';
import { isCompletedAuditStatus } from '../../lib/audit/audit-time';
import {
getAdminActions,
getAdminAudits,
getAdminWorkers,
getAllUsers
} from '../../services/supabaseDataService';
import { Notice } from '../ui/page-system';
import { useAdminData } from './useAdminData';


import { Empty,Loading,Metric,Panel,SimpleTable,WorkerRow } from './shared';
export default function AdminOverview() {
  const users = useAdminData(() => getAllUsers(), []);
  const audits = useAdminData(() => getAdminAudits(100), []);
  const workers = useAdminData(() => getAdminWorkers(), []);
  const actions = useAdminData(() => getAdminActions(10), []);

  const stats = useMemo(() => {
    const userRows = users.data || [];
    const auditRows = audits.data || [];
    return {
      totalUsers: userRows.length,
      freeUsers: userRows.filter((item: any) => item.plan === 'free').length,
      paidUsers: userRows.filter((item: any) => item.plan === 'paid').length,
      agencyUsers: userRows.filter((item: any) => item.plan === 'agency').length,
      queued: auditRows.filter((item: any) => item.status === 'queued').length,
      running: auditRows.filter((item: any) => item.status === 'running').length,
      failed: auditRows.filter((item: any) => item.status === 'failed').length,
      completed: auditRows.filter((item: any) => isCompletedAuditStatus(item.status)).length,
      successRate: auditRows.length ? Math.round((auditRows.filter((item: any) => isCompletedAuditStatus(item.status)).length / auditRows.length) * 100) : 0,
    };
  }, [users.data, audits.data]);

  if (users.loading || audits.loading || workers.loading) return <Loading />;
  const error = users.error || audits.error || workers.error || actions.error;

  return (
    <div className="space-y-6">
      {error && <Notice tone="danger" title="Some admin data could not be loaded">{error}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Users} label="Recent accounts" value={users.error ? 'Unavailable' : stats.totalUsers} detail={`Latest 100 accounts: ${stats.paidUsers + stats.agencyUsers} paid or agency`} />
        <Metric icon={Clock3} label="Recent active audits" value={audits.error ? 'Unavailable' : stats.queued + stats.running} detail={`Latest 100 audits: ${stats.queued} waiting, ${stats.running} checking`} tone="warning" />
        <Metric icon={CheckCircle2} label="Completed audits" value={stats.completed} detail={`${stats.successRate}% of recent audits`} tone="success" />
        <Metric icon={XCircle} label="Failed audits" value={stats.failed} detail={stats.failed ? 'Review and retry failed jobs' : 'No failed audits in this view'} tone={stats.failed ? 'danger' : 'success'} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
        <Panel title="Audit distribution" description="Lifecycle states among the latest 100 audits, not platform-wide totals." icon={BarChart3}>
          <div className="space-y-4">
            {[
              ['Completed', stats.completed, 'bg-emerald-500'],
              ['Waiting', stats.queued, 'bg-blue-500'],
              ['Checking', stats.running, 'bg-violet-500'],
              ['Failed', stats.failed, 'bg-red-500'],
            ].map(([label, value, color]) => {
              const total = Math.max(1, stats.completed + stats.queued + stats.running + stats.failed);
              return <div key={String(label)}><div className="mb-1.5 flex items-center justify-between text-sm"><span className="text-muted-foreground">{label}</span><span className="font-semibold">{value}</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${Math.max(Number(value) ? 4 : 0, (Number(value) / total) * 100)}%` }} /></div></div>;
            })}
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2 border-t border-border pt-4 text-center text-xs"><div><div className="text-lg font-semibold">{stats.freeUsers}</div><div className="text-muted-foreground">Free</div></div><div><div className="text-lg font-semibold">{stats.paidUsers}</div><div className="text-muted-foreground">Paid</div></div><div><div className="text-lg font-semibold">{stats.agencyUsers}</div><div className="text-muted-foreground">Agency</div></div></div>
        </Panel>
        <Panel title="Audit engine heartbeat" description="Current Render worker registrations and freshness." icon={Wifi} action={<button type="button" onClick={workers.refresh} className="quiet-button min-h-9 px-3 py-1.5 text-xs"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>}>
          {(workers.data || []).length ? (workers.data || []).map((worker: any) => <WorkerRow key={worker.id} worker={worker} />) : <Empty text="No audit engine heartbeat found." />}
        </Panel>
      </div>
      <div>
        <Panel title="Latest admin actions" description="Recent privileged changes for operational traceability." icon={ShieldAlert} action={<button type="button" onClick={actions.refresh} className="quiet-button min-h-9 px-3 py-1.5 text-xs"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>}>
          {(actions.data || []).length ? <SimpleTable rows={actions.data || []} columns={['action', 'targetType', 'targetId', 'createdAt']} /> : <Empty text="No admin actions logged yet." />}
        </Panel>
      </div>
    </div>
  );
}
