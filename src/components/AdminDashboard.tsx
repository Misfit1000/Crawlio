import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Activity, AlertTriangle, BookOpen, CheckCircle2, Clock3, Database, FileCheck2, Gauge, History, LibraryBig, Loader2, RefreshCw, Settings, ShieldAlert, SlidersHorizontal, Users, Wifi, XCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  getAdminDiagnostics,
  getAdminWorkers,
  getPlanLimits,
  getPlatformSettings,
  sendAdminSentryTestEvent,
  updatePlanLimit,
  updatePlatformSettings,
} from '../services/supabaseDataService';
import { Notice, PageHeader, Panel as UiPanel } from './ui/page-system';
import AdminActivityView from './admin/AdminActivityView';
import AdminAuditOperationsView from './admin/AdminAuditOperationsView';
import AdminContentHealthView from './admin/AdminContentHealthView';
import AdminOperationsView from './admin/AdminOperationsView';
import AdminResourcesView from './admin/AdminResourcesView';
import AdminUsersView from './admin/AdminUsersView';
import AdminActionDialog from './admin/AdminActionDialog';

const BlogAdmin = React.lazy(() => import('./blog/BlogAdmin'));

type AdminTab = 'overview' | 'users' | 'audits' | 'queue' | 'workers' | 'content-health' | 'resources' | 'activity' | 'diagnostics' | 'settings' | 'plans' | 'blog';

const tabs: Array<{ id: AdminTab; label: string; icon: any; path: string }> = [
  { id: 'overview', label: 'Overview', icon: Activity, path: '/admin' },
  { id: 'users', label: 'Users', icon: Users, path: '/admin/users' },
  { id: 'audits', label: 'Audits', icon: Database, path: '/admin/audits' },
  { id: 'queue', label: 'Queue', icon: SlidersHorizontal, path: '/admin/queue' },
  { id: 'workers', label: 'Audit Engine', icon: Wifi, path: '/admin/workers' },
  { id: 'content-health', label: 'Content Health', icon: FileCheck2, path: '/admin/content-health' },
  { id: 'resources', label: 'Resources', icon: LibraryBig, path: '/admin/resources' },
  { id: 'activity', label: 'Activity', icon: History, path: '/admin/activity' },
  { id: 'diagnostics', label: 'Diagnostics', icon: Gauge, path: '/admin/diagnostics' },
  { id: 'settings', label: 'Settings', icon: Settings, path: '/admin/settings' },
  { id: 'plans', label: 'Plans', icon: ShieldAlert, path: '/admin/plans' },
  { id: 'blog', label: 'Blog', icon: BookOpen, path: '/admin/blog' },
];

function tabFromPath(pathname: string) {
  const match = pathname.match(/^\/admin\/([^/]+)/);
  const id = match?.[1] as AdminTab | undefined;
  return tabs.some((tab) => tab.id === id) ? id! : 'overview';
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

      {activeTab === 'overview' && <AdminOperationsView />}
      {activeTab === 'users' && <AdminUsersView currentAdminId={user.id} />}
      {activeTab === 'audits' && <AdminAuditOperationsView />}
      {activeTab === 'queue' && <AdminAuditOperationsView />}
      {activeTab === 'workers' && <AdminWorkers />}
      {activeTab === 'content-health' && <AdminContentHealthView onOpenPost={(postId) => navigate(`/admin/blog${postId ? `?post=${encodeURIComponent(postId)}` : ''}`)} />}
      {activeTab === 'resources' && <AdminResourcesView />}
      {activeTab === 'activity' && <AdminActivityView />}
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
  const [testRunning, setTestRunning] = useState(false);
  const [testMessage, setTestMessage] = useState('');
  const [testError, setTestError] = useState('');
  if (diagnostics.loading) return <Loading />;
  if (diagnostics.error || !diagnostics.data) return <Notice tone="danger" title="Diagnostics could not load">{diagnostics.error || 'No diagnostics data was returned.'}</Notice>;
  const data: any = diagnostics.data;
  const compatibility = data.compatibility || {};
  const metrics = data.metrics || {};
  const operations = data.operations || {};
  const monitoring = data.monitoring || {};
  const operationsTone = operations.status === 'healthy' ? 'success' : operations.status === 'critical' ? 'danger' : 'warning';
  const sendTest = async () => {
    setTestRunning(true);
    setTestMessage('');
    setTestError('');
    try {
      const result = await sendAdminSentryTestEvent();
      setTestMessage(result.initiated
        ? 'API verification event was sent. Confirm it in Sentry.'
        : 'Sentry API monitoring is not configured for this deployment.');
    } catch (error) {
      setTestError(error instanceof Error ? error.message : 'The verification event could not be sent.');
    } finally {
      setTestRunning(false);
    }
  };
  return (
    <div className="space-y-5">
      <Panel title="Production health" description="Bounded 24-hour queue, completion, deployment, and audit-engine signals." icon={Activity}>
        <Notice tone={operationsTone} title={`Platform status: ${operations.status || 'unknown'}`}>{operations.reasons?.length ? operations.reasons.join(' ') : 'No actionable reliability condition is active.'}</Notice>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={Wifi} label="Audit engines online" value={operations.activeWorkerCount ?? 0} detail={operations.lastWorkerHeartbeat ? `Last contact ${new Date(operations.lastWorkerHeartbeat).toLocaleString()}` : 'No heartbeat'} tone={operations.workerOnline ? 'success' : 'danger'} /><Metric icon={Clock3} label="Oldest queue age" value={operations.oldestQueuedAgeSeconds == null ? '--' : `${Math.round(operations.oldestQueuedAgeSeconds / 60)}m`} detail={`${operations.queuedAuditCount ?? 0} waiting`} tone={(operations.oldestQueuedAgeSeconds || 0) > 300 ? 'warning' : 'success'} /><Metric icon={CheckCircle2} label="Completion rate" value={operations.recentCompletionRate == null ? '--' : `${Math.round(operations.recentCompletionRate * 100)}%`} detail="Recent terminal audits" tone={operations.recentCompletionRate != null && operations.recentCompletionRate < 0.75 ? 'danger' : 'success'} /><Metric icon={Clock3} label="Median duration" value={operations.medianAuditDurationMs == null ? '--' : `${Math.round(operations.medianAuditDurationMs / 1000)}s`} detail={`${operations.realtimeFallbackCount ?? 0} HTTP fallback audit(s)`} /></div>
        <div className="mt-4 grid gap-2 rounded-lg border border-border p-3 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-4"><span>Application: <code>{operations.applicationCommit || 'unknown'}</code></span><span>Audit engine: <code>{operations.workerCommit || 'unknown'}</code></span><span>Schema: database {operations.databaseSchemaVersion ?? 'unknown'} / API {operations.apiSchemaVersion ?? 'unknown'}</span><span>Deep audit: {operations.deepAuditEnabled ? 'enabled' : 'disabled'}</span></div>
      </Panel>
      <Panel title="Deployment compatibility" description="Frontend/API expectations compared with the database ledger and latest audit-engine heartbeat." icon={Gauge} action={<button type="button" onClick={diagnostics.refresh} className="quiet-button min-h-9 px-3 py-1.5 text-xs"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>}>
        <Notice tone={compatibility.compatible ? 'success' : 'danger'} title={compatibility.compatible ? 'Versions are compatible' : 'Audit starts are protected'}>{compatibility.compatible ? 'Database and audit-engine contracts match the active API.' : `Compatibility status: ${compatibility.status || 'unknown'}. New audits are blocked when a known mismatch could corrupt data.`}</Notice>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={Clock3} label="Waiting" value={metrics.queued || 0} detail={metrics.oldestQueuedAt ? `Oldest ${new Date(metrics.oldestQueuedAt).toLocaleString()}` : 'No queued audits'} /><Metric icon={Activity} label="Checking" value={metrics.running || 0} detail={`${metrics.staleLeases || 0} stale leases`} tone={metrics.staleLeases ? 'danger' : 'success'} /><Metric icon={CheckCircle2} label="Warnings today" value={metrics.completedWithWarnings || 0} detail={`${metrics.completed || 0} clean completions`} tone="warning" /><Metric icon={XCircle} label="Failed / abandoned" value={(metrics.failed || 0) + (metrics.abandoned || 0)} detail={`${metrics.abandoned || 0} abandoned`} tone={(metrics.failed || metrics.abandoned) ? 'danger' : 'success'} /></div>
      </Panel>
      <Panel
        title="Error monitoring"
        description="Safe configuration state for browser, API, audit engine, and production source maps."
        icon={ShieldAlert}
        action={(
          <button
            type="button"
            className="quiet-button min-h-9 px-3 py-1.5 text-xs"
            onClick={sendTest}
            disabled={testRunning || !monitoring.apiConfigured}
          >
            {testRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
            Send API test
          </button>
        )}
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric icon={Activity} label="Browser" value={monitoring.browserConfigured ? 'Configured' : 'Not configured'} detail="Errors and low-sample traces" tone={monitoring.browserConfigured ? 'success' : undefined} />
          <Metric icon={Database} label="API" value={monitoring.apiConfigured ? 'Configured' : 'Not configured'} detail="Unexpected server failures" tone={monitoring.apiConfigured ? 'success' : undefined} />
          <Metric icon={Wifi} label="Audit engine" value={monitoring.workerConfigured ? 'Configured' : 'Not configured'} detail="Latest worker heartbeat" tone={monitoring.workerConfigured ? 'success' : undefined} />
          <Metric icon={Gauge} label="Source maps" value={monitoring.sourceMapsConfigured ? 'Configured' : 'Not configured'} detail={`Environment: ${monitoring.environment || 'unknown'}`} tone={monitoring.sourceMapsConfigured ? 'success' : undefined} />
        </div>
        {testMessage && <Notice tone="success" className="mt-4">{testMessage}</Notice>}
        {testError && <Notice tone="danger" className="mt-4">{testError}</Notice>}
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
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);

  const save = async ({ reason }: { reason: string; confirmation: string }) => {
    setSaving(true);
    setError(null);
    setMessage('');
    try {
      await updatePlatformSettings(draft, reason);
      setMessage('Platform settings saved.');
      setConfirming(false);
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
      <button onClick={() => setConfirming(true)} disabled={saving} className="trust-button mt-5">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings className="h-4 w-4" />} Save settings</button>
      <AdminActionDialog
        open={confirming}
        title="Update platform settings"
        description="Apply the current queue, maintenance, and audit-admission settings."
        actionLabel="Save settings"
        pending={saving}
        error={error}
        impact={draft.value?.maintenanceMode ? ['New audit starts will be blocked while maintenance mode is active.'] : []}
        onCancel={() => {
          if (!saving) setConfirming(false);
        }}
        onConfirm={save}
      />
    </Panel>
  );
}

function AdminPlans({ adminUserId }: { adminUserId: string }) {
  const plans = useAdminData(() => getPlanLimits(), []);
  const [updatingPlan, setUpdatingPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<{ plan: string; key: string; value: number } | null>(null);
  const update = async ({ reason }: { reason: string; confirmation: string }) => {
    if (!pendingUpdate) return;
    setUpdatingPlan(pendingUpdate.plan);
    setError(null);
    try {
      await updatePlanLimit(pendingUpdate.plan, { [pendingUpdate.key]: pendingUpdate.value }, adminUserId, reason);
      plans.refresh();
      setPendingUpdate(null);
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
                <td><NumberInput value={plan.dailyAudits} disabled={updatingPlan === plan.plan} onBlur={(value) => setPendingUpdate({ plan: plan.plan, key: 'dailyAudits', value })} /></td>
                <td><NumberInput value={plan.monthlyAudits} disabled={updatingPlan === plan.plan} onBlur={(value) => setPendingUpdate({ plan: plan.plan, key: 'monthlyAudits', value })} /></td>
                <td><NumberInput value={plan.maxPagesQuick} disabled={updatingPlan === plan.plan} onBlur={(value) => setPendingUpdate({ plan: plan.plan, key: 'maxPagesQuick', value })} /></td>
                <td><NumberInput value={plan.maxPagesStandard} disabled={updatingPlan === plan.plan} onBlur={(value) => setPendingUpdate({ plan: plan.plan, key: 'maxPagesStandard', value })} /></td>
                <td><NumberInput value={plan.maxPagesDeep} disabled={updatingPlan === plan.plan} onBlur={(value) => setPendingUpdate({ plan: plan.plan, key: 'maxPagesDeep', value })} /></td>
                <td><NumberInput value={plan.priority} disabled={updatingPlan === plan.plan} onBlur={(value) => setPendingUpdate({ plan: plan.plan, key: 'priority', value })} /></td>
                <td className="text-xs"><span className="block">PDF: {plan.pdfEnabled ? 'Yes' : 'No'}</span><span className="block text-muted-foreground">White label: {plan.whiteLabelEnabled ? 'Yes' : 'No'} / API: {plan.apiEnabled ? 'Yes' : 'No'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AdminActionDialog
        open={Boolean(pendingUpdate)}
        title={`Update ${pendingUpdate?.plan || ''} plan limit`}
        description={pendingUpdate ? `Change ${pendingUpdate.key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)} to ${pendingUpdate.value}.` : ''}
        actionLabel="Update plan"
        pending={Boolean(updatingPlan)}
        error={error}
        impact={['New audit starts will use this limit after the update.', 'Existing queued audits keep their recorded page limit.']}
        onCancel={() => {
          if (!updatingPlan) setPendingUpdate(null);
        }}
        onConfirm={update}
      />
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
