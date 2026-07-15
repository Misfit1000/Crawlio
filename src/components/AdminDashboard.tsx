import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Activity, AlertTriangle, BarChart3, BookOpen, CheckCircle2, Clock3, Database, Gauge, Loader2, RefreshCw, Search, Settings, ShieldAlert, SlidersHorizontal, Users, Wifi, XCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { isCompletedAuditStatus } from '../lib/audit/audit-time';
import {
  getAdminActions,
  getAdminDiagnostics,
  getAdminAudits,
  getAdminWorkers,
  getAllUsers,
  getPlanLimits,
  getPlatformSettings,
  updateAuditAdminAction,
  updatePlanLimit,
  updatePlatformSettings,
  updateUserAdminFields,
} from '../services/supabaseDataService';
import { Notice, PageHeader, Panel as UiPanel } from './ui/page-system';

const BlogAdmin = React.lazy(() => import('./blog/BlogAdmin'));

type AdminTab = 'overview' | 'users' | 'audits' | 'queue' | 'workers' | 'diagnostics' | 'settings' | 'plans' | 'blog';

const tabs: Array<{ id: AdminTab; label: string; icon: any; path: string }> = [
  { id: 'overview', label: 'Overview', icon: Activity, path: '/admin' },
  { id: 'users', label: 'Users', icon: Users, path: '/admin/users' },
  { id: 'audits', label: 'Audits', icon: Database, path: '/admin/audits' },
  { id: 'queue', label: 'Queue', icon: SlidersHorizontal, path: '/admin/queue' },
  { id: 'workers', label: 'Audit Engine', icon: Wifi, path: '/admin/workers' },
  { id: 'diagnostics', label: 'Diagnostics', icon: Gauge, path: '/admin/diagnostics' },
  { id: 'settings', label: 'Settings', icon: Settings, path: '/admin/settings' },
  { id: 'plans', label: 'Plans', icon: ShieldAlert, path: '/admin/plans' },
  { id: 'blog', label: 'Blog', icon: BookOpen, path: '/admin/blog' },
];

const DUPLICATE_AUDIT_WARNING_MS = 10 * 60 * 1000;

function tabFromPath(pathname: string) {
  const match = pathname.match(/^\/admin\/([^/]+)/);
  const id = match?.[1] as AdminTab | undefined;
  return tabs.some((tab) => tab.id === id) ? id! : 'overview';
}

function auditOwnerKey(row: any) {
  return row.userId ? `user:${row.userId}` : `guest:${row.guestKeyHash || 'unknown'}`;
}

function requestAdminReason(action: string) {
  const reason = window.prompt(`Reason for ${action}:`)?.trim() || '';
  return reason.length >= 4 ? reason : null;
}

function duplicateAuditWarning(row: any, rows: any[]) {
  const rowTime = new Date(row.createdAt).getTime();
  if (!row.normalizedUrl || Number.isNaN(rowTime)) return null;
  const owner = auditOwnerKey(row);
  const matches = rows.filter((candidate) => {
    const candidateTime = new Date(candidate.createdAt).getTime();
    return candidate.id !== row.id
      && candidate.normalizedUrl === row.normalizedUrl
      && auditOwnerKey(candidate) === owner
      && !Number.isNaN(candidateTime)
      && Math.abs(candidateTime - rowTime) <= DUPLICATE_AUDIT_WARNING_MS;
  });
  return matches.length
    ? `${matches.length + 1} audits for same URL and owner within 10 minutes`
    : null;
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = tabFromPath(location.pathname);

  if (!user || user.role !== 'admin') {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-8 py-16">
        <PageHeader eyebrow="Protected area" icon={ShieldAlert} title="Admin access required" description="This operational workspace is available only to accounts with the server-verified admin role." />
        <Notice tone="danger">Sign in with an administrator account assigned through the existing admin role controls. Client-side state cannot grant access.</Notice>
      </div>
    );
  }

  const switchTab = (tab: AdminTab) => {
    navigate(tabs.find((item) => item.id === tab)?.path || '/admin');
  };

  return (
    <div className="space-y-7 animate-rise">
      <PageHeader eyebrow="Operations" icon={Activity} title="Admin control center" description="Monitor the audit platform, manage access and plans, recover queued work, and publish reviewed guidance." metadata={<><span className="suite-chip"><ShieldAlert className="h-3.5 w-3.5" /> Server-verified admin</span><span className="suite-chip">{tabs.find((tab) => tab.id === activeTab)?.label}</span></>} />

      <UiPanel className="sticky top-[5rem] z-20 flex max-w-full gap-1 overflow-x-auto p-1.5" as="nav">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              aria-current={activeTab === tab.id ? 'page' : undefined}
              className={`flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${
                activeTab === tab.id ? 'bg-accent text-accent-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </UiPanel>

      {activeTab === 'overview' && <AdminOverview />}
      {activeTab === 'users' && <AdminUsers adminUserId={user.id} />}
      {activeTab === 'audits' && <AdminAudits adminUserId={user.id} />}
      {activeTab === 'queue' && <AdminQueue adminUserId={user.id} />}
      {activeTab === 'workers' && <AdminWorkers />}
      {activeTab === 'diagnostics' && <AdminDiagnostics />}
      {activeTab === 'settings' && <AdminSettings />}
      {activeTab === 'plans' && <AdminPlans adminUserId={user.id} />}
      {activeTab === 'blog' && (
        <React.Suspense fallback={<div className="flex min-h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>}>
          <BlogAdmin />
        </React.Suspense>
      )}
    </div>
  );
}

function useAdminData<T>(loader: () => Promise<T>, deps: React.DependencyList = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    loader()
      .then((next) => {
        setData(next);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load admin data'))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, deps);
  return { data, error, loading, refresh };
}

function AdminOverview() {
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
        <Metric icon={Users} label="Total users" value={stats.totalUsers} detail={`${stats.paidUsers + stats.agencyUsers} paid or agency`} />
        <Metric icon={Clock3} label="Active queue" value={stats.queued + stats.running} detail={`${stats.queued} waiting, ${stats.running} checking`} tone="warning" />
        <Metric icon={CheckCircle2} label="Completed audits" value={stats.completed} detail={`${stats.successRate}% of recent audits`} tone="success" />
        <Metric icon={XCircle} label="Failed audits" value={stats.failed} detail={stats.failed ? 'Review and retry failed jobs' : 'No failed audits in this view'} tone={stats.failed ? 'danger' : 'success'} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
        <Panel title="Audit distribution" description="Recent jobs by lifecycle state." icon={BarChart3}>
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

function AdminUsers({ adminUserId }: { adminUserId: string }) {
  const users = useAdminData(() => getAllUsers(), []);
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const rows = (users.data || []).filter((item: any) => {
    const matchesSearch = `${item.email || ''} ${item.username || ''} ${item.displayName || ''}`.toLowerCase().includes(search.toLowerCase());
    return matchesSearch && (planFilter === 'all' || item.plan === planFilter) && (roleFilter === 'all' || item.role === roleFilter);
  });

  const updateUser = async (id: string, patch: any) => {
    const reason = requestAdminReason(patch.resetQuotas ? 'resetting this user quota' : 'changing this user access');
    if (!reason) return;
    setUpdatingId(id);
    setMutationError(null);
    setMessage('');
    try {
      await updateUserAdminFields(id, patch, adminUserId, reason);
      setMessage('User access updated.');
      users.refresh();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'User update failed.');
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <Panel title="User management" description="Manage server-backed roles, plans, subscription state, and audit quotas." icon={Users} action={<span className="suite-chip">{rows.length} shown</span>}>
      {(users.error || mutationError) && <Notice tone="danger" className="mb-4">{users.error || mutationError}</Notice>}
      {message && <Notice tone="success" className="mb-4">{message}</Notice>}
      <div className="mb-4 grid gap-3 md:grid-cols-[minmax(240px,1fr)_180px_180px]">
        <label className="relative block"><span className="sr-only">Search users</span><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search email, username, or name" className="suite-input pl-9" /></label>
        <label><span className="sr-only">Filter by role</span><select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="suite-input"><option value="all">All roles</option><option value="user">User</option><option value="support">Support</option><option value="admin">Admin</option></select></label>
        <label><span className="sr-only">Filter by plan</span><select value={planFilter} onChange={(event) => setPlanFilter(event.target.value)} className="suite-input"><option value="all">All plans</option>{['free', 'paid', 'agency', 'admin'].map((plan) => <option key={plan} value={plan}>{plan}</option>)}</select></label>
      </div>
      {users.loading ? <Loading /> : (
        <div className="max-w-full overflow-x-auto rounded-lg border border-border">
          <table className="suite-table min-w-[900px]">
            <thead>
              <tr><th>User</th><th>Role</th><th>Plan</th><th>Subscription</th><th>Quota use</th><th>Action</th></tr>
            </thead>
            <tbody>
              {rows.map((item: any) => (
                <tr key={item.id}>
                  <td><div className="font-semibold">{item.displayName || item.username || item.email || 'Unnamed user'}{item.id === adminUserId && <span className="ml-2 text-xs font-medium text-accent">You</span>}</div><div className="mt-1 max-w-[260px] truncate text-xs text-muted-foreground">{item.email || item.id}</div></td>
                  <td><Select value={item.role || 'user'} options={['user', 'support', 'admin']} disabled={updatingId === item.id || item.id === adminUserId} onChange={(role) => updateUser(item.id, { role })} /></td>
                  <td><Select value={item.plan || 'free'} options={['free', 'paid', 'agency', 'admin']} disabled={updatingId === item.id} onChange={(plan) => updateUser(item.id, { plan, subscription_status: plan === 'free' ? 'inactive' : 'active' })} /></td>
                  <td><Select value={item.subscriptionStatus || 'inactive'} options={['inactive', 'trialing', 'active', 'past_due', 'cancelled']} disabled={updatingId === item.id} onChange={(subscription_status) => updateUser(item.id, { subscription_status })} /></td>
                  <td><div className="font-medium">{item.auditQuotaUsedDaily || 0} daily</div><div className="text-xs text-muted-foreground">{item.auditQuotaUsedMonthly || 0} monthly</div></td>
                  <td><button disabled={updatingId === item.id} onClick={() => updateUser(item.id, { resetQuotas: true })} className="quiet-button min-h-9 px-3 py-1.5 text-xs">{updatingId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Reset quota</button></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={6}><Empty text="No users match these filters." /></td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function AdminAudits({ adminUserId }: { adminUserId: string }) {
  const audits = useAdminData(() => getAdminAudits(100), []);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const rows = (audits.data || []).filter((item: any) => (status === 'all' || item.status === status) && `${item.normalizedUrl || ''} ${item.id || ''}`.toLowerCase().includes(query.toLowerCase()));
  if (audits.loading) return <Loading />;
  return (
    <Panel title="Audit jobs" description="Inspect recent jobs, change queue priority, retry failures, or recover stale leases." icon={Database} action={<button type="button" onClick={audits.refresh} className="quiet-button min-h-9 px-3 py-1.5 text-xs"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>}>
      {audits.error && <Notice tone="danger" className="mb-4">{audits.error}</Notice>}
      <div className="mb-4 grid gap-3 md:grid-cols-[minmax(240px,1fr)_200px]"><label className="relative"><span className="sr-only">Search audit jobs</span><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search URL or audit ID" className="suite-input pl-9" /></label><select value={status} onChange={(event) => setStatus(event.target.value)} className="suite-input"><option value="all">All statuses</option>{['queued', 'running', 'completed', 'completed_with_warnings', 'failed', 'cancelled', 'abandoned'].map((item) => <option key={item} value={item}>{item.replace(/_/g, ' ')}</option>)}</select></div>
      <AuditTable rows={rows} adminUserId={adminUserId} refresh={audits.refresh} />
    </Panel>
  );
}

function AdminQueue({ adminUserId }: { adminUserId: string }) {
  const audits = useAdminData(() => getAdminAudits(100), []);
  const rows = (audits.data || [])
    .filter((item: any) => item.status === 'queued' || item.status === 'running')
    .sort((a: any, b: any) => (b.queuePriority - a.queuePriority) || String(a.createdAt).localeCompare(String(b.createdAt)));

  if (audits.loading) return <Loading />;
  return (
    <Panel title="Priority queue" description="Only active jobs, sorted by queue priority and creation time." icon={SlidersHorizontal} action={<button type="button" onClick={audits.refresh} className="quiet-button min-h-9 px-3 py-1.5 text-xs"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>}>
      {audits.error && <Notice tone="danger" className="mb-4">{audits.error}</Notice>}
      <AuditTable rows={rows} adminUserId={adminUserId} refresh={audits.refresh} />
    </Panel>
  );
}

function AuditTable({ rows, adminUserId, refresh }: { rows: any[]; adminUserId: string; refresh: () => void }) {
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const updateAudit = async (id: string, patch: any) => {
    const reason = requestAdminReason('changing this audit job');
    if (!reason) return;
    setUpdatingId(id);
    setError(null);
    try {
      await updateAuditAdminAction(id, patch, adminUserId, reason);
      refresh();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Audit update failed.');
    } finally {
      setUpdatingId(null);
    }
  };
  return (
    <div>
      {error && <Notice tone="danger" className="mb-4">{error}</Notice>}
      <div className="max-w-full overflow-x-auto rounded-lg border border-border">
      <table className="suite-table min-w-[980px]">
        <thead>
          <tr><th>URL and phase</th><th>Status</th><th>Plan</th><th>Mode</th><th>Priority</th><th>Lease</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.id}>
              <td className="max-w-sm break-all">
                <div className="font-semibold">{item.normalizedUrl}</div>
                {duplicateAuditWarning(item, rows) && (
                  <div className="mt-1 text-xs text-yellow-600 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    {duplicateAuditWarning(item, rows)}
                  </div>
                )}
                <div className="text-xs text-muted-foreground">{item.error || item.currentPhase}</div>
              </td>
              <td><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(item.status)}`}>{item.status}</span></td>
              <td className="capitalize">{item.plan || 'free'}</td>
              <td>{item.effectiveMode || item.requestedMode || 'quick'}</td>
              <td><input type="number" defaultValue={item.queuePriority || 10} disabled={updatingId === item.id} className="w-20 rounded-lg border border-border bg-background px-2 py-1.5" onBlur={(event) => updateAudit(item.id, { queuePriority: Number(event.currentTarget.value) })} /></td>
              <td className="text-xs"><div className="max-w-[150px] truncate">{item.lockedBy || 'Not locked'}</div><div className="mt-1 text-muted-foreground">{item.leaseExpiresAt ? new Date(item.leaseExpiresAt).toLocaleString() : 'No lease'}</div></td>
              <td><div className="flex flex-wrap gap-2">
                {updatingId === item.id && <Loader2 className="h-4 w-4 animate-spin text-accent" />}
                {['queued', 'running'].includes(item.status) && <button disabled={updatingId === item.id} onClick={() => window.confirm('Cancel this audit job?') && updateAudit(item.id, { status: 'cancelled', currentPhase: 'Cancelled by admin', lockedBy: null, lockedAt: null, leaseExpiresAt: null })} className="quiet-button min-h-8 px-2.5 py-1 text-xs text-red-600">Cancel</button>}
                {item.status === 'failed' && <button disabled={updatingId === item.id} onClick={() => updateAudit(item.id, { status: 'queued', currentPhase: 'Retry queued', error: null, lockedBy: null, lockedAt: null, leaseExpiresAt: null })} className="quiet-button min-h-8 px-2.5 py-1 text-xs">Retry</button>}
                {item.leaseExpiresAt && new Date(item.leaseExpiresAt).getTime() < Date.now() && <button disabled={updatingId === item.id} onClick={() => updateAudit(item.id, { status: 'queued', currentPhase: 'Recovered by admin', lockedBy: null, lockedAt: null, leaseExpiresAt: null })} className="quiet-button min-h-8 px-2.5 py-1 text-xs">Recover</button>}
              </div>
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={7}><Empty text="No audits found." /></td></tr>}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function AdminWorkers() {
  const workers = useAdminData(() => getAdminWorkers(), []);
  if (workers.loading) return <Loading />;
  return (
    <Panel title="Audit engine health" description="Worker heartbeat, runtime, active job, supported modes, and last contact." icon={Wifi} action={<button type="button" onClick={workers.refresh} className="quiet-button min-h-9 px-3 py-1.5 text-xs"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>}>
      {workers.error && <Notice tone="danger" className="mb-4">{workers.error}</Notice>}
      {(workers.data || []).length ? (workers.data || []).map((worker: any) => <WorkerRow key={worker.id} worker={worker} />) : <Empty text="No audit engine heartbeat rows found." />}
      <Notice tone="info" className="mt-4">Render Free Web Service can sleep. Uptime monitors must ping only <code>https://seointel-audit-worker.onrender.com/health</code>, never the homepage or audit start routes.</Notice>
    </Panel>
  );
}

function AdminDiagnostics() {
  const diagnostics = useAdminData(() => getAdminDiagnostics(), []);
  if (diagnostics.loading) return <Loading />;
  if (diagnostics.error || !diagnostics.data) return <Notice tone="danger" title="Diagnostics could not load">{diagnostics.error || 'No diagnostics data was returned.'}</Notice>;
  const data: any = diagnostics.data;
  const compatibility = data.compatibility || {};
  const metrics = data.metrics || {};
  return (
    <div className="space-y-5">
      <Panel title="Deployment compatibility" description="Frontend/API expectations compared with the database ledger and latest audit-engine heartbeat." icon={Gauge} action={<button type="button" onClick={diagnostics.refresh} className="quiet-button min-h-9 px-3 py-1.5 text-xs"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>}>
        <Notice tone={compatibility.compatible ? 'success' : 'danger'} title={compatibility.compatible ? 'Versions are compatible' : 'Audit starts are protected'}>{compatibility.compatible ? 'Database and audit-engine contracts match the active API.' : `Compatibility status: ${compatibility.status || 'unknown'}. New audits are blocked when a known mismatch could corrupt data.`}</Notice>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={Clock3} label="Waiting" value={metrics.queued || 0} detail={metrics.oldestQueuedAt ? `Oldest ${new Date(metrics.oldestQueuedAt).toLocaleString()}` : 'No queued audits'} /><Metric icon={Activity} label="Checking" value={metrics.running || 0} detail={`${metrics.staleLeases || 0} stale leases`} tone={metrics.staleLeases ? 'danger' : 'success'} /><Metric icon={CheckCircle2} label="Warnings today" value={metrics.completedWithWarnings || 0} detail={`${metrics.completed || 0} clean completions`} tone="warning" /><Metric icon={XCircle} label="Failed / abandoned" value={(metrics.failed || 0) + (metrics.abandoned || 0)} detail={`${metrics.abandoned || 0} abandoned`} tone={(metrics.failed || metrics.abandoned) ? 'danger' : 'success'} /></div>
      </Panel>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Recent API errors" description="Restricted request IDs and internal diagnostics. Never shown in customer responses." icon={ShieldAlert}>{(data.recentApiErrors || []).length ? <SimpleTable rows={data.recentApiErrors.slice(0, 20)} columns={['request_id', 'route', 'internal_code', 'created_at']} /> : <Empty text="No recent API errors." />}</Panel>
        <Panel title="Failure categories" description="Target failures grouped by stable code from audits created in the last 24 hours." icon={AlertTriangle}>{Object.keys(metrics.failuresByCode || {}).length ? <div className="grid gap-2">{Object.entries(metrics.failuresByCode).sort(([, left]: any, [, right]: any) => Number(right) - Number(left)).map(([code, count]) => <div key={code} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"><code>{code}</code><span className="font-semibold">{String(count)}</span></div>)}</div> : <Empty text="No page failure categories recorded today." />}</Panel>
      </div>
      <Notice tone="info">Database storage and Realtime quota totals remain provider-dashboard metrics. Crawlio labels them unavailable instead of estimating or inventing usage.</Notice>
    </div>
  );
}

function AdminSettings() {
  const settings = useAdminData(() => getPlatformSettings(), []);
  const [draft, setDraft] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);

  const save = async () => {
    const reason = requestAdminReason('updating platform settings');
    if (!reason) return;
    setSaving(true);
    setError(null);
    setMessage('');
    try {
      await updatePlatformSettings(draft, reason);
      setMessage('Platform settings saved.');
      settings.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Settings could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  if (settings.loading) return <Loading />;
  return (
    <Panel title="Platform settings" description="Safe operational controls stored in Supabase. Sensitive keys remain environment variables." icon={Settings}>
      {(settings.error || error) && <Notice tone="danger" className="mb-4">{settings.error || error}</Notice>}
      {message && <Notice tone="success" className="mb-4">{message}</Notice>}
      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Platform name" value={draft.platformName || ''} onChange={(platformName) => setDraft({ ...draft, platformName })} />
        <Field label="Support email" value={draft.supportEmail || ''} onChange={(supportEmail) => setDraft({ ...draft, supportEmail })} />
        <Field label="Queue fairness paid burst" value={String(draft.value?.queueFairnessPaidBurst ?? 5)} onChange={(value) => setDraft({ ...draft, value: { ...(draft.value || {}), queueFairnessPaidBurst: Number(value) } })} />
        <label className="block text-sm"><span className="font-semibold">Guest audit access</span><select value={String(draft.value?.guestAuditEnabled ?? true)} onChange={(event) => setDraft({ ...draft, value: { ...(draft.value || {}), guestAuditEnabled: event.target.value === 'true' } })} className="suite-input mt-2"><option value="true">Enabled</option><option value="false">Disabled</option></select></label>
        <label className="block text-sm"><span className="font-semibold">Maintenance mode</span><select value={String(draft.value?.maintenanceMode ?? false)} onChange={(event) => setDraft({ ...draft, value: { ...(draft.value || {}), maintenanceMode: event.target.value === 'true' } })} className="suite-input mt-2"><option value="false">Off</option><option value="true">Block new audits</option></select></label>
        <label className="block text-sm"><span className="font-semibold">New Free audits</span><select value={String(draft.value?.pauseFreeSubmissions ?? false)} onChange={(event) => setDraft({ ...draft, value: { ...(draft.value || {}), pauseFreeSubmissions: event.target.value === 'true' } })} className="suite-input mt-2"><option value="false">Accepting</option><option value="true">Paused</option></select></label>
        <label className="block text-sm"><span className="font-semibold">Guest verification</span><select value={String(draft.value?.captchaRequired ?? false)} onChange={(event) => setDraft({ ...draft, value: { ...(draft.value || {}), captchaRequired: event.target.value === 'true' } })} className="suite-input mt-2"><option value="false">Not required</option><option value="true">Require configured token</option></select></label>
        <Field label="Soft queue warning" value={String(draft.value?.softQueueWarning ?? 40)} onChange={(value) => setDraft({ ...draft, value: { ...(draft.value || {}), softQueueWarning: Math.max(1, Number(value)) } })} />
        <Field label="Hard global queue limit" value={String(draft.value?.hardQueueLimit ?? 50)} onChange={(value) => setDraft({ ...draft, value: { ...(draft.value || {}), hardQueueLimit: Math.max(1, Number(value)) } })} />
        <fieldset className="rounded-lg border border-border p-3 md:col-span-2"><legend className="px-1 text-sm font-semibold">Temporarily disabled audit types</legend><div className="mt-2 flex flex-wrap gap-4">{['quick', 'standard', 'deep'].map((mode) => { const disabled = Array.isArray(draft.value?.disabledAuditModes) && draft.value.disabledAuditModes.includes(mode); return <label key={mode} className="flex items-center gap-2 text-sm capitalize"><input type="checkbox" checked={disabled} onChange={(event) => { const current = Array.isArray(draft.value?.disabledAuditModes) ? draft.value.disabledAuditModes : []; const disabledAuditModes = event.target.checked ? [...new Set([...current, mode])] : current.filter((item: string) => item !== mode); setDraft({ ...draft, value: { ...(draft.value || {}), disabledAuditModes } }); }} className="h-4 w-4 accent-[var(--accent)]" />{mode}</label>; })}</div></fieldset>
      </div>
      <button onClick={save} disabled={saving} className="trust-button mt-5">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings className="h-4 w-4" />} Save settings</button>
    </Panel>
  );
}

function AdminPlans({ adminUserId }: { adminUserId: string }) {
  const plans = useAdminData(() => getPlanLimits(), []);
  const [updatingPlan, setUpdatingPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const update = async (plan: string, key: string, value: number) => {
    const reason = requestAdminReason(`changing the ${plan} plan`);
    if (!reason) return;
    setUpdatingPlan(plan);
    setError(null);
    try {
      await updatePlanLimit(plan, { [key]: value }, adminUserId, reason);
      plans.refresh();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Plan limit update failed.');
    } finally {
      setUpdatingPlan(null);
    }
  };
  if (plans.loading) return <Loading />;
  return (
    <Panel title="Plan limits" description="Edit audit quotas, page limits, and queue priority using current supported plan fields." icon={Gauge} action={<button type="button" onClick={plans.refresh} className="quiet-button min-h-9 px-3 py-1.5 text-xs"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>}>
      {(plans.error || error) && <Notice tone="danger" className="mb-4">{plans.error || error}</Notice>}
      <div className="max-w-full overflow-x-auto rounded-lg border border-border">
        <table className="suite-table min-w-[1040px]">
          <thead><tr><th>Plan</th><th>Daily</th><th>Monthly</th><th>Quick pages</th><th>Standard pages</th><th>Deep pages</th><th>Priority</th><th>Features</th></tr></thead>
          <tbody>
            {(plans.data || []).map((plan: any) => (
              <tr key={plan.plan}>
                <td className="font-semibold capitalize">{updatingPlan === plan.plan && <Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin text-accent" />}{plan.label || plan.plan}</td>
                <td><NumberInput value={plan.dailyAudits} disabled={updatingPlan === plan.plan} onBlur={(value) => update(plan.plan, 'dailyAudits', value)} /></td>
                <td><NumberInput value={plan.monthlyAudits} disabled={updatingPlan === plan.plan} onBlur={(value) => update(plan.plan, 'monthlyAudits', value)} /></td>
                <td><NumberInput value={plan.maxPagesQuick} disabled={updatingPlan === plan.plan} onBlur={(value) => update(plan.plan, 'maxPagesQuick', value)} /></td>
                <td><NumberInput value={plan.maxPagesStandard} disabled={updatingPlan === plan.plan} onBlur={(value) => update(plan.plan, 'maxPagesStandard', value)} /></td>
                <td><NumberInput value={plan.maxPagesDeep} disabled={updatingPlan === plan.plan} onBlur={(value) => update(plan.plan, 'maxPagesDeep', value)} /></td>
                <td><NumberInput value={plan.priority} disabled={updatingPlan === plan.plan} onBlur={(value) => update(plan.plan, 'priority', value)} /></td>
                <td className="text-xs"><span className="block">PDF: {plan.pdfEnabled ? 'Yes' : 'No'}</span><span className="block text-muted-foreground">White label: {plan.whiteLabelEnabled ? 'Yes' : 'No'} / API: {plan.apiEnabled ? 'Yes' : 'No'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function WorkerRow({ worker }: { worker: any }) {
  const value = worker.value || {};
  const lastSeen = value.lastSeenAt || worker.updatedAt;
  const stale = lastSeen ? Date.now() - new Date(lastSeen).getTime() > 90_000 : true;
  return (
    <div className="mb-3 rounded-xl border border-border bg-background/60 p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 font-semibold"><span className={`h-2.5 w-2.5 rounded-full ${stale ? 'bg-amber-500' : 'bg-emerald-500'}`} />{value.workerId || worker.id}</div>
          <div className="mt-1 text-sm text-muted-foreground">Runtime: {value.runtime || 'unknown'} / Active audit: {value.currentAuditId || 'none'}</div>
        </div>
        <div className={`text-sm font-semibold ${stale ? 'text-yellow-600' : 'text-green-600'}`}>{stale ? 'Stale or sleeping' : 'Healthy'}</div>
      </div>
      <div className="mt-3 grid gap-2 border-t border-border pt-3 text-xs text-muted-foreground sm:grid-cols-2"><span>Last contact: {lastSeen ? new Date(lastSeen).toLocaleString() : 'Never'}</span><span>Modes: {(value.supportedModes || []).join(', ') || 'Unknown'}</span></div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, detail, tone = 'accent' }: { icon: any; label: string; value: React.ReactNode; detail: string; tone?: 'accent' | 'success' | 'warning' | 'danger' }) {
  const tones = { accent: 'bg-blue-500/10 text-blue-600', success: 'bg-emerald-500/10 text-emerald-600', warning: 'bg-amber-500/10 text-amber-600', danger: 'bg-red-500/10 text-red-600' };
  return <div className="admin-stat"><div className="flex items-start justify-between gap-3"><div><div className="text-sm text-muted-foreground">{label}</div><div className="mt-2 text-3xl font-semibold">{value}</div></div><span className={`flex h-10 w-10 items-center justify-center rounded-lg ${tones[tone]}`}><Icon className="h-5 w-5" /></span></div><div className="mt-3 text-xs text-muted-foreground">{detail}</div></div>;
}

function Panel({ title, description, icon: Icon, action, children }: { title: string; description?: string; icon?: any; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="suite-panel p-4 sm:p-5"><div className="mb-5 flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between"><div className="flex min-w-0 gap-3">{Icon && <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"><Icon className="h-5 w-5" /></span>}<div><h2 className="text-lg font-semibold">{title}</h2>{description && <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>}</div></div>{action && <div className="shrink-0">{action}</div>}</div>{children}</section>;
}

function Empty({ text }: { text: string }) {
  return <div className="p-6 text-center text-muted-foreground">{text}</div>;
}

function Loading() {
  return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>;
}

function Select({ value, options, onChange, disabled = false }: { value: string; options: string[]; onChange: (value: string) => void; disabled?: boolean }) {
  return <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="rounded-lg border border-border bg-background px-2.5 py-1.5 capitalize disabled:opacity-50">{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block text-sm"><span className="font-semibold">{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} className="suite-input mt-2" /></label>;
}

function NumberInput({ value, onBlur, disabled = false }: { value: number; onBlur: (value: number) => void; disabled?: boolean }) {
  return <input type="number" min={0} defaultValue={value} disabled={disabled} onBlur={(event) => onBlur(Math.max(0, Number(event.currentTarget.value)))} className="w-24 rounded-lg border border-border bg-background px-2.5 py-1.5 disabled:opacity-50" />;
}

function SimpleTable({ rows, columns }: { rows: any[]; columns: string[] }) {
  return (
    <div className="max-w-full overflow-x-auto rounded-lg border border-border">
      <table className="suite-table min-w-[680px]">
        <thead><tr>{columns.map((column) => <th key={column}>{column.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={row.id || index}>{columns.map((column) => <td key={column}>{column === 'createdAt' && row[column] ? new Date(row[column]).toLocaleString() : String(row[column] ?? '')}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function statusClass(status: string) {
  if (isCompletedAuditStatus(status)) return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'failed' || status === 'cancelled') return 'bg-red-500/10 text-red-700 dark:text-red-300';
  if (status === 'running') return 'bg-violet-500/10 text-violet-700 dark:text-violet-300';
  return 'bg-blue-500/10 text-blue-700 dark:text-blue-300';
}
