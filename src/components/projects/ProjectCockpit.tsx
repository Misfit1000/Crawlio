import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Bell, CalendarClock, Check, CheckCircle2, Globe2, Loader2, Plus, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { getAuthHeaders } from '../../lib/api/auth-headers';
import { API_ROUTES } from '../../lib/api/routes';
import type { ProjectAuditFrequency, ProjectOverviewItem, ProjectOverviewResponse } from '../../lib/projects/types';
import { safeJsonFetch } from '../../lib/http/safe-json';
import { inflightRead } from '../../lib/http/inflight-read';
import { useAuth } from '../../contexts/AuthContext';
import { AuditGrade, MetricCard, RadialScoreGauge, StatusBadge, SurfaceCard } from '../ui/visual-system';
import { Notice } from '../ui/page-system';

interface ProjectCockpitProps {
  onStartAudit: () => void;
  onOpenReports: () => void;
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Not scheduled';
}

export default function ProjectCockpit(props: ProjectCockpitProps) {
  const { user } = useAuth();
  const accountId = user?.id || 'guest';
  return <AccountProjectCockpit key={accountId} accountId={accountId} {...props} />;
}

function AccountProjectCockpit({ onStartAudit, onOpenReports, accountId }: ProjectCockpitProps & { accountId: string }) {
  const [overview, setOverview] = useState<ProjectOverviewResponse | null>(null);
  const [selectedHost, setSelectedHost] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notificationError, setNotificationError] = useState('');
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsLoaded, setNotificationsLoaded] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const overviewRead = useRef<AbortController | null>(null);
  const previousOverview = useRef(overview);
  previousOverview.current = overview;

  const load = useCallback(async () => {
    if (overviewRead.current || !lifetime.current || lifetime.current.signal.aborted) return;
    const controller = new AbortController();
    overviewRead.current = controller;
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      if (controller.signal.aborted) return;
      const response = await inflightRead(API_ROUTES.projectsOverview, headers, signal => safeJsonFetch<any>(API_ROUTES.projectsOverview, { headers, credentials: 'same-origin', signal }), controller.signal);
      if (controller.signal.aborted) return;
      if (response.success === false) throw new Error(response.error || 'Projects could not be loaded.');
      const data = (response.data.data || response.data) as ProjectOverviewResponse;
      setOverview(data);
      setError('');
      setSelectedHost((current) => data.projects.some((project) => project.hostname === current) ? current : data.projects[0]?.hostname || '');
    } catch (nextError) {
      if (!controller.signal.aborted && !(nextError instanceof Error && nextError.name === 'AbortError')) {
        const message = nextError instanceof Error ? nextError.message : 'Projects could not be loaded.';
        setError(previousOverview.current ? `Refresh failed; showing previous project data, which may be stale. ${message}` : message);
      }
    } finally {
      if (overviewRead.current === controller) { overviewRead.current = null; if (!controller.signal.aborted) setLoading(false); }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    void load();
    return () => { controller.abort(); overviewRead.current?.abort(); overviewRead.current = null; };
  }, [load]);

  useEffect(() => {
    try {
      const owner = localStorage.getItem('crawlio_project_owner') || 'guest';
      if (owner !== accountId) ['crawlio_prefill_audit_url', 'crawlio_prefill_project_id', 'crawlio_selected_report_id'].forEach(key => localStorage.removeItem(key));
      localStorage.setItem('crawlio_project_owner', accountId);
    } catch { /* Storage may be disabled; project data remains account-scoped in memory. */ }
  }, [accountId]);

  useEffect(() => {
    if (!showNotifications || notificationsLoaded) return;
    const controller = new AbortController();
    setNotificationsLoading(true);
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        if (controller.signal.aborted) return;
        const response = await inflightRead(API_ROUTES.projectNotifications, headers, signal => safeJsonFetch<any>(API_ROUTES.projectNotifications, { headers, credentials: 'same-origin', signal }), controller.signal);
        if (controller.signal.aborted) return;
        if (response.success === false) throw new Error(response.error);
        setNotifications((response.data.data || response.data).notifications || []);
        setNotificationsLoaded(true);
        setNotificationError('');
      } catch (nextError) {
        if (!controller.signal.aborted && !(nextError instanceof Error && nextError.name === 'AbortError')) setNotificationError(nextError instanceof Error ? nextError.message : 'Notifications could not be loaded.');
      } finally { if (!controller.signal.aborted) setNotificationsLoading(false); }
    })();
    return () => controller.abort();
  }, [showNotifications, notificationsLoaded]);

  const selected = useMemo(() => overview?.projects.find((project) => project.hostname === selectedHost) || null, [overview, selectedHost]);

  const trackSite = async (project: ProjectOverviewItem | null = null) => {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || busy) return;
    const url = project?.normalizedUrl || newUrl;
    if (!url.trim()) return;
    setBusy('track');
    setError('');
    const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
    if (signal.aborted) return;
    const response = await safeJsonFetch<any>(API_ROUTES.projects, {
      method: 'POST',
      headers, signal,
      body: JSON.stringify({ url, name: project?.name }),
    });
    if (signal.aborted) return;
    if (response.success === false) setError(response.error);
    else {
      setNewUrl('');
      overviewRead.current?.abort(); overviewRead.current = null;
      await load();
    }
    if (!signal.aborted) setBusy('');
  };

  const updateSchedule = async (frequency: ProjectAuditFrequency) => {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || busy) return;
    if (!selected?.id) return;
    setBusy('schedule');
    setError('');
    const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
    if (signal.aborted) return;
    const response = await safeJsonFetch<any>(API_ROUTES.project(selected.id), {
      method: 'PATCH',
      headers, signal,
      body: JSON.stringify({ auditFrequency: frequency, auditMode: selected.auditMode, changeAlertsEnabled: selected.changeAlertsEnabled }),
    });
    if (signal.aborted) return;
    if (response.success === false) setError(response.error);
    else { overviewRead.current?.abort(); overviewRead.current = null; await load(); }
    if (!signal.aborted) setBusy('');
  };

  const runAudit = () => {
    if (selected) {
      window.localStorage.setItem('crawlio_prefill_audit_url', selected.normalizedUrl);
      if (selected.id) window.localStorage.setItem('crawlio_prefill_project_id', selected.id);
      else window.localStorage.removeItem('crawlio_prefill_project_id');
    }
    onStartAudit();
  };

  const openReport = () => {
    if (selected?.latestAudit) window.localStorage.setItem('crawlio_selected_report_id', selected.latestAudit.id);
    onOpenReports();
  };

  const toggleNotifications = () => setShowNotifications(current => !current);

  const markNotificationsRead = async () => {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted) return;
    const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
    if (signal.aborted) return;
    const response = await safeJsonFetch<any>(API_ROUTES.projectNotificationsRead, { method: 'POST', headers, signal, body: JSON.stringify({}) });
    if (signal.aborted) return;
    if (response.success === true) {
      setNotifications((current) => current.map((item) => ({ ...item, read_at: item.read_at || new Date().toISOString() })));
      setOverview((current) => current ? { ...current, unreadNotifications: 0 } : current);
    } else setNotificationError(response.error);
  };

  return (
    <section aria-labelledby="project-cockpit-title" className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2"><h2 id="project-cockpit-title" className="text-xl font-semibold">Your website</h2>{overview?.unreadNotifications || showNotifications ? <button type="button" onClick={toggleNotifications} aria-expanded={showNotifications} aria-controls={showNotifications ? 'project-notifications' : undefined} aria-label={showNotifications ? 'Close project notifications' : 'Open project notifications'} className="min-h-11 rounded-lg"><StatusBadge tone="neutral"><Bell className="h-3.5 w-3.5" /> {overview?.unreadNotifications || 0} unread</StatusBadge></button> : null}</div>
        </div>
        <button type="button" className="quiet-button" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
      </div>

      {error && <Notice tone="danger">{error}</Notice>}
      {showNotifications && <SurfaceCard id="project-notifications" className="p-0"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3"><h3 className="font-semibold">Project notifications</h3><button type="button" className="quiet-button min-h-11 px-2 py-1 text-xs" onClick={() => void markNotificationsRead()} disabled={notificationsLoading}><Check className="h-3.5 w-3.5" /> Mark all read</button></div>{notificationError && <div className="p-4"><Notice tone="danger">{notificationError}</Notice></div>}<div className="divide-y divide-border">{notificationsLoading ? <div role="status" className="p-5 text-sm text-muted-foreground">Loading notifications...</div> : notifications.length ? notifications.slice(0, 10).map((item) => <div key={item.id} className="px-4 py-3"><div className="flex items-center gap-2"><span className="text-sm font-semibold">{item.title}</span>{!item.read_at && <span className="h-2 w-2 rounded-full bg-accent" aria-label="Unread" />}</div><p className="mt-1 text-sm text-muted-foreground">{item.message}</p><div className="mt-1 text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()}</div></div>) : !notificationError && <div className="p-5 text-sm text-muted-foreground">No project notifications yet.</div>}</div></SurfaceCard>}
      {loading && !overview ? <SurfaceCard className="flex items-center gap-3 p-6"><Loader2 className="h-5 w-5 animate-spin text-accent" /> Loading website projects...</SurfaceCard> : null}

      {overview && !overview.projects.length ? (
        <SurfaceCard className="p-5 md:p-6">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,.7fr)] lg:items-end">
            <div><h3 className="text-lg font-semibold">Track your first website</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">Add a website to track audits and changes.</p></div>
            <div className="flex flex-col gap-2 sm:flex-row"><label className="sr-only" htmlFor="project-url">Website URL</label><input id="project-url" className="suite-input min-w-0 flex-1" value={newUrl} onChange={(event) => setNewUrl(event.target.value)} placeholder="https://example.com" /><button type="button" className="trust-button shrink-0" disabled={busy === 'track' || !newUrl.trim()} onClick={() => void trackSite()}>{busy === 'track' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Track site</button></div>
          </div>
        </SurfaceCard>
      ) : null}

      {overview && overview.projects.length ? <>
          <div className="project-selector">
            <label><span className="mb-2 block text-xs font-semibold text-muted-foreground">Current website</span><select className="suite-input" value={selectedHost} onChange={(event) => setSelectedHost(event.target.value)}>{overview.projects.map((project) => <option key={project.hostname} value={project.hostname}>{project.name === project.hostname ? project.hostname : `${project.name} - ${project.hostname}`}</option>)}</select></label>
            <div className="flex flex-wrap gap-2">{selected && !selected.id ? <button type="button" className="quiet-button" disabled={busy === 'track'} onClick={() => void trackSite(selected)}><Plus className="h-4 w-4" /> Track project</button> : null}<button type="button" className="trust-button" onClick={runAudit}>Run audit <ArrowRight className="h-4 w-4" /></button></div>
          </div>

        {selected ? <>
          <div className="project-result">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-semibold">Latest result</h3><p className="mt-1 text-xs text-muted-foreground">{selected.latestAudit ? formatDate(selected.latestAudit.completedAt || selected.latestAudit.createdAt) : 'No audit yet'}</p></div>{selected.newCriticalCount ? <StatusBadge tone="danger">{selected.newCriticalCount} new critical</StatusBadge> : selected.latestAudit ? <StatusBadge tone="neutral">{selected.latestAudit.status.replace(/_/g, ' ')}</StatusBadge> : <StatusBadge tone="neutral">Awaiting first audit</StatusBadge>}</div>
              <div className="project-score">
                <div>{selected.latestAudit?.score != null ? <RadialScoreGauge value={selected.latestAudit.score} label="Latest audit score" /> : <AuditGrade score={null} label="Latest audit score" detail="Run an audit to collect evidence" />}{selected.scoreDelta != null && <div className={`mt-3 inline-flex items-center gap-1.5 text-sm font-semibold ${selected.scoreDelta < 0 ? 'text-red-600 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{selected.scoreDelta < 0 ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}{selected.scoreDelta > 0 ? '+' : ''}{selected.scoreDelta} since previous audit</div>}</div>
                <div><h4 className="text-sm font-semibold text-muted-foreground">Next action</h4><p className="mt-2 text-lg leading-7">{selected.recommendedAction}</p><div className="mt-5 flex flex-wrap gap-2"><button type="button" className="trust-button" onClick={selected.latestAudit ? openReport : runAudit}>{selected.latestAudit ? 'Open latest report' : 'Run first audit'} <ArrowRight className="h-4 w-4" /></button>{selected.latestAudit && <button type="button" className="quiet-button" onClick={runAudit}>Run again</button>}</div></div>
              </div>
            </div>
            <section><div className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-[var(--category-violet)]" /><h3 className="text-base font-semibold">Audit schedule</h3></div><select aria-label="Audit schedule" className="suite-input mt-4" value={selected.auditFrequency} disabled={!selected.id || busy === 'schedule'} onChange={(event) => void updateSchedule(event.target.value as ProjectAuditFrequency)}><option value="manual">Manual only</option><option value="weekly" disabled={!overview.scheduledAuditsEnabled}>Every week</option><option value="monthly" disabled={!overview.scheduledAuditsEnabled}>Every month</option></select><p className="mt-3 text-xs text-muted-foreground">Next audit: {formatDate(selected.nextAuditAt)}</p>{!selected.id ? <p className="mt-2 text-xs text-muted-foreground">Track this project before scheduling.</p> : !overview.scheduledAuditsEnabled ? <p className="mt-2 text-xs text-muted-foreground">Scheduling is not available on your plan.</p> : null}</section>
          </div>
          <div className="project-metrics">
            <MetricCard label="Open findings" value={selected.openFindingCount} detail={`${selected.latestAudit?.criticalCount || 0} critical - ${selected.latestAudit?.highCount || 0} high`} icon={<AlertTriangle className="h-5 w-5" />} tone={selected.latestAudit?.criticalCount ? 'red' : 'yellow'} />
            <MetricCard label="Resolved" value={selected.resolvedFindingCount} detail="Not detected in the latest comparison" icon={<CheckCircle2 className="h-5 w-5" />} tone="green" />
            <MetricCard label="Pages checked" value={selected.latestAudit?.pagesCrawled ?? '--'} detail={selected.latestAudit ? `Last run ${formatDate(selected.latestAudit.completedAt || selected.latestAudit.createdAt)}` : 'No completed audit'} icon={<Globe2 className="h-5 w-5" />} />
          </div>
        </> : null}
      </> : null}
    </section>
  );
}
