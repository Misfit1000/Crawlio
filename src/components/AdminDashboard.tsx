import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, BookOpen, Database, Loader2, RefreshCw, Search, Settings, ShieldAlert, SlidersHorizontal, Users, Wifi } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  getAdminActions,
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

type AdminTab = 'overview' | 'users' | 'audits' | 'queue' | 'workers' | 'settings' | 'plans' | 'blog';

const tabs: Array<{ id: AdminTab; label: string; icon: any; path: string }> = [
  { id: 'overview', label: 'Overview', icon: Activity, path: '/admin' },
  { id: 'users', label: 'Users', icon: Users, path: '/admin/users' },
  { id: 'audits', label: 'Audits', icon: Database, path: '/admin/audits' },
  { id: 'queue', label: 'Queue', icon: SlidersHorizontal, path: '/admin/queue' },
  { id: 'workers', label: 'Audit Engine', icon: Wifi, path: '/admin/workers' },
  { id: 'settings', label: 'Settings', icon: Settings, path: '/admin/settings' },
  { id: 'plans', label: 'Plans', icon: ShieldAlert, path: '/admin/plans' },
  { id: 'blog', label: 'Blog', icon: BookOpen, path: '/admin/blog' },
];

const DUPLICATE_AUDIT_WARNING_MS = 10 * 60 * 1000;

function tabFromPath() {
  const match = window.location.pathname.match(/^\/admin\/([^/]+)/);
  const id = match?.[1] as AdminTab | undefined;
  return tabs.some((tab) => tab.id === id) ? id! : 'overview';
}

function auditOwnerKey(row: any) {
  return row.userId ? `user:${row.userId}` : `guest:${row.guestKeyHash || 'unknown'}`;
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
  const [activeTab, setActiveTab] = useState<AdminTab>(tabFromPath);

  if (!user || user.role !== 'admin') {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-8 py-16">
        <PageHeader eyebrow="Protected area" icon={ShieldAlert} title="Admin access required" description="This operational workspace is available only to accounts with the server-verified admin role." />
        <Notice tone="danger">Sign in with an administrator account assigned through the existing admin role controls. Client-side state cannot grant access.</Notice>
      </div>
    );
  }

  const switchTab = (tab: AdminTab) => {
    setActiveTab(tab);
    window.history.replaceState(null, '', tabs.find((item) => item.id === tab)?.path || '/admin');
  };

  return (
    <div className="space-y-8 animate-rise">
      <PageHeader eyebrow="Operations" icon={Activity} title="Admin operations" description="Manage users, plans, audits, publishing, audit engine health, and safe platform settings from measured platform data." />

      <UiPanel className="flex max-w-full flex-wrap gap-2 p-2" as="nav">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              className={`flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${
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
      completed: auditRows.filter((item: any) => item.status === 'completed').length,
    };
  }, [users.data, audits.data]);

  if (users.loading || audits.loading || workers.loading) return <Loading />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Metric label="Total users" value={stats.totalUsers} />
        <Metric label="Free/Paid/Agency" value={`${stats.freeUsers}/${stats.paidUsers}/${stats.agencyUsers}`} />
        <Metric label="Waiting/Checking" value={`${stats.queued}/${stats.running}`} />
        <Metric label="Failed/Completed" value={`${stats.failed}/${stats.completed}`} />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="Audit engine heartbeat">
          {(workers.data || []).length ? (workers.data || []).map((worker: any) => <WorkerRow key={worker.id} worker={worker} />) : <Empty text="No audit engine heartbeat found." />}
        </Panel>
        <Panel title="Latest admin actions">
          {(actions.data || []).length ? <SimpleTable rows={actions.data || []} columns={['action', 'targetType', 'targetId', 'createdAt']} /> : <Empty text="No admin actions logged yet." />}
        </Panel>
      </div>
    </div>
  );
}

function AdminUsers({ adminUserId }: { adminUserId: string }) {
  const users = useAdminData(() => getAllUsers(), []);
  const [search, setSearch] = useState('');
  const rows = (users.data || []).filter((item: any) => String(item.email || '').toLowerCase().includes(search.toLowerCase()));

  const updateUser = async (id: string, patch: any) => {
    await updateUserAdminFields(id, patch, adminUserId);
    users.refresh();
  };

  return (
    <Panel title="Users">
      <div className="relative max-w-sm mb-4">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by email" className="w-full bg-background border border-border rounded-xl pl-9 pr-3 py-2" />
      </div>
      {users.loading ? <Loading /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground border-b border-border">
              <tr><th className="p-3">Email</th><th className="p-3">Role</th><th className="p-3">Plan</th><th className="p-3">Status</th><th className="p-3">Quota</th><th className="p-3">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((item: any) => (
                <tr key={item.id}>
                  <td className="p-3">{item.email || item.id}</td>
                  <td className="p-3"><Select value={item.role || 'user'} options={['user', 'support', 'admin']} onChange={(role) => updateUser(item.id, { role })} /></td>
                  <td className="p-3"><Select value={item.plan || 'free'} options={['free', 'paid', 'agency', 'admin']} onChange={(plan) => updateUser(item.id, { plan, subscription_status: plan === 'free' ? 'inactive' : 'active' })} /></td>
                  <td className="p-3"><Select value={item.subscriptionStatus || 'inactive'} options={['inactive', 'trialing', 'active', 'past_due', 'cancelled']} onChange={(subscription_status) => updateUser(item.id, { subscription_status })} /></td>
                  <td className="p-3">{item.auditQuotaUsedDaily || 0} daily / {item.auditQuotaUsedMonthly || 0} monthly</td>
                  <td className="p-3"><button onClick={() => updateUser(item.id, { resetQuotas: true })} className="px-3 py-1.5 rounded-lg border border-border hover:bg-muted">Reset quotas</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function AdminAudits({ adminUserId }: { adminUserId: string }) {
  const audits = useAdminData(() => getAdminAudits(100), []);
  if (audits.loading) return <Loading />;
  return (
    <Panel title="Latest audits">
      <AuditTable rows={audits.data || []} adminUserId={adminUserId} refresh={audits.refresh} />
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
    <Panel title="Priority queue">
      <AuditTable rows={rows} adminUserId={adminUserId} refresh={audits.refresh} />
    </Panel>
  );
}

function AuditTable({ rows, adminUserId, refresh }: { rows: any[]; adminUserId: string; refresh: () => void }) {
  const updateAudit = async (id: string, patch: any) => {
    await updateAuditAdminAction(id, patch, adminUserId);
    refresh();
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground border-b border-border">
          <tr><th className="p-3">URL</th><th className="p-3">Status</th><th className="p-3">Plan</th><th className="p-3">Mode</th><th className="p-3">Priority</th><th className="p-3">Lock</th><th className="p-3">Actions</th></tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((item) => (
            <tr key={item.id}>
              <td className="p-3 max-w-sm break-all">
                <div className="font-medium">{item.normalizedUrl}</div>
                {duplicateAuditWarning(item, rows) && (
                  <div className="mt-1 text-xs text-yellow-600 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    {duplicateAuditWarning(item, rows)}
                  </div>
                )}
                <div className="text-xs text-muted-foreground">{item.error || item.currentPhase}</div>
              </td>
              <td className="p-3 capitalize">{item.status}</td>
              <td className="p-3 capitalize">{item.plan || 'free'}</td>
              <td className="p-3">{item.effectiveMode || item.requestedMode || 'quick'}</td>
              <td className="p-3"><input type="number" defaultValue={item.queuePriority || 10} className="w-20 bg-background border border-border rounded-lg px-2 py-1" onBlur={(event) => updateAudit(item.id, { queuePriority: Number(event.currentTarget.value) })} /></td>
              <td className="p-3 text-xs">{item.lockedBy || 'none'}<br />{item.leaseExpiresAt || ''}</td>
              <td className="p-3 flex flex-wrap gap-2">
                {['queued', 'running'].includes(item.status) && <button onClick={() => updateAudit(item.id, { status: 'cancelled', currentPhase: 'Cancelled by admin', lockedBy: null, lockedAt: null, leaseExpiresAt: null })} className="px-2 py-1 rounded border border-border hover:bg-muted">Cancel</button>}
                {item.status === 'failed' && <button onClick={() => updateAudit(item.id, { status: 'queued', currentPhase: 'Retry queued', error: null, lockedBy: null, lockedAt: null, leaseExpiresAt: null })} className="px-2 py-1 rounded border border-border hover:bg-muted">Retry</button>}
                {item.leaseExpiresAt && new Date(item.leaseExpiresAt).getTime() < Date.now() && <button onClick={() => updateAudit(item.id, { status: 'queued', currentPhase: 'Recovered by admin', lockedBy: null, lockedAt: null, leaseExpiresAt: null })} className="px-2 py-1 rounded border border-border hover:bg-muted">Recover stale</button>}
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={7}><Empty text="No audits found." /></td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function AdminWorkers() {
  const workers = useAdminData(() => getAdminWorkers(), []);
  if (workers.loading) return <Loading />;
  return (
    <Panel title="Audit engine">
      {(workers.data || []).length ? (workers.data || []).map((worker: any) => <WorkerRow key={worker.id} worker={worker} />) : <Empty text="No audit engine heartbeat rows found." />}
      <div className="mt-4 text-sm text-muted-foreground">
        Render Free Web Service can sleep. Add an uptime monitor pinging only https://seointel-audit-worker.onrender.com/health every 10 minutes. Do not ping the homepage or audit start routes.
      </div>
    </Panel>
  );
}

function AdminSettings() {
  const settings = useAdminData(() => getPlatformSettings(), []);
  const [draft, setDraft] = useState<any>({});

  useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);

  const save = async () => {
    await updatePlatformSettings(draft);
    settings.refresh();
  };

  if (settings.loading) return <Loading />;
  return (
    <Panel title="Safe platform settings">
      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Platform name" value={draft.platformName || ''} onChange={(platformName) => setDraft({ ...draft, platformName })} />
        <Field label="Support email" value={draft.supportEmail || ''} onChange={(supportEmail) => setDraft({ ...draft, supportEmail })} />
        <Field label="Queue fairness paid burst" value={String(draft.value?.queueFairnessPaidBurst ?? 5)} onChange={(value) => setDraft({ ...draft, value: { ...(draft.value || {}), queueFairnessPaidBurst: Number(value) } })} />
        <Field label="Guest audit enabled" value={String(draft.value?.guestAuditEnabled ?? true)} onChange={(value) => setDraft({ ...draft, value: { ...(draft.value || {}), guestAuditEnabled: value === 'true' } })} />
      </div>
      <button onClick={save} className="mt-4 px-4 py-2 rounded-xl bg-accent text-accent-foreground font-semibold">Save settings</button>
    </Panel>
  );
}

function AdminPlans({ adminUserId }: { adminUserId: string }) {
  const plans = useAdminData(() => getPlanLimits(), []);
  const update = async (plan: string, key: string, value: any) => {
    await updatePlanLimit(plan, { [key]: value }, adminUserId);
    plans.refresh();
  };
  if (plans.loading) return <Loading />;
  return (
    <Panel title="Plan limits">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground border-b border-border">
            <tr><th className="p-3">Plan</th><th className="p-3">Daily</th><th className="p-3">Monthly</th><th className="p-3">Quick/Standard/Deep pages</th><th className="p-3">Priority</th><th className="p-3">Features</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(plans.data || []).map((plan: any) => (
              <tr key={plan.plan}>
                <td className="p-3 font-semibold capitalize">{plan.label || plan.plan}</td>
                <td className="p-3"><NumberInput value={plan.dailyAudits} onBlur={(value) => update(plan.plan, 'dailyAudits', value)} /></td>
                <td className="p-3"><NumberInput value={plan.monthlyAudits} onBlur={(value) => update(plan.plan, 'monthlyAudits', value)} /></td>
                <td className="p-3">{plan.maxPagesQuick}/{plan.maxPagesStandard}/{plan.maxPagesDeep}</td>
                <td className="p-3"><NumberInput value={plan.priority} onBlur={(value) => update(plan.plan, 'priority', value)} /></td>
                <td className="p-3 text-xs">PDF {String(plan.pdfEnabled)} · White-label {String(plan.whiteLabelEnabled)} · API {String(plan.apiEnabled)}</td>
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
    <div className="rounded-xl border border-border p-4 mb-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="font-semibold">{value.workerId || worker.id}</div>
          <div className="text-sm text-muted-foreground">status={value.status || 'unknown'} runtime={value.runtime || 'unknown'} currentAuditId={value.currentAuditId || 'none'}</div>
        </div>
        <div className={`text-sm font-semibold ${stale ? 'text-yellow-600' : 'text-green-600'}`}>{stale ? 'Stale or sleeping' : 'Healthy'}</div>
      </div>
      <div className="text-xs text-muted-foreground mt-2">lastSeenAt: {lastSeen || 'never'} · supportedModes: {(value.supportedModes || []).join(', ') || 'unknown'}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="bg-card border border-border rounded-xl p-4"><div className="text-sm text-muted-foreground">{label}</div><div className="text-2xl font-bold">{value}</div></div>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="bg-card border border-border rounded-xl p-5"><h2 className="text-xl font-bold mb-4">{title}</h2>{children}</section>;
}

function Empty({ text }: { text: string }) {
  return <div className="p-6 text-center text-muted-foreground">{text}</div>;
}

function Loading() {
  return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>;
}

function Select({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} className="bg-background border border-border rounded-lg px-2 py-1">{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block text-sm"><span className="text-muted-foreground">{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2" /></label>;
}

function NumberInput({ value, onBlur }: { value: number; onBlur: (value: number) => void }) {
  return <input type="number" defaultValue={value} onBlur={(event) => onBlur(Number(event.currentTarget.value))} className="w-24 bg-background border border-border rounded-lg px-2 py-1" />;
}

function SimpleTable({ rows, columns }: { rows: any[]; columns: string[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground border-b border-border"><tr>{columns.map((column) => <th key={column} className="p-2">{column}</th>)}</tr></thead>
        <tbody className="divide-y divide-border">{rows.map((row, index) => <tr key={row.id || index}>{columns.map((column) => <td key={column} className="p-2">{String(row[column] ?? '')}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
