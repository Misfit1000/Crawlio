import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Bell, CalendarClock, Check, CheckCircle2, Globe2, Loader2, Plus, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { getAuthHeaders } from '../../lib/api/auth-headers';
import { API_ROUTES } from '../../lib/api/routes';
import type { ProjectAuditFrequency, ProjectOverviewItem, ProjectOverviewResponse } from '../../lib/projects/types';
import { safeJsonFetch } from '../../lib/http/safe-json';
import { AuditGrade, MetricCard, StatusBadge, SurfaceCard } from '../ui/visual-system';
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

export default function ProjectCockpit({ onStartAudit, onOpenReports }: ProjectCockpitProps) {
  const [overview, setOverview] = useState<ProjectOverviewResponse | null>(null);
  const [selectedHost, setSelectedHost] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await safeJsonFetch<any>(API_ROUTES.projectsOverview, { headers: await getAuthHeaders() });
      if (!response.success) throw new Error((response as any).error || 'Projects could not be loaded.');
      const data = (response.data.data || response.data) as ProjectOverviewResponse;
      setOverview(data);
      setSelectedHost((current) => data.projects.some((project) => project.hostname === current) ? current : data.projects[0]?.hostname || '');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Projects could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(() => overview?.projects.find((project) => project.hostname === selectedHost) || null, [overview, selectedHost]);

  const trackSite = async (project: ProjectOverviewItem | null = null) => {
    const url = project?.normalizedUrl || newUrl;
    if (!url.trim()) return;
    setBusy('track');
    setError('');
    const response = await safeJsonFetch<any>(API_ROUTES.projects, {
      method: 'POST',
      headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ url, name: project?.name }),
    });
    if (!response.success) setError((response as any).error);
    else {
      setNewUrl('');
      await load();
    }
    setBusy('');
  };

  const updateSchedule = async (frequency: ProjectAuditFrequency) => {
    if (!selected?.id) return;
    setBusy('schedule');
    setError('');
    const response = await safeJsonFetch<any>(API_ROUTES.project(selected.id), {
      method: 'PATCH',
      headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ auditFrequency: frequency, auditMode: selected.auditMode, changeAlertsEnabled: selected.changeAlertsEnabled }),
    });
    if (!response.success) setError((response as any).error);
    else await load();
    setBusy('');
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

  const toggleNotifications = async () => {
    const next = !showNotifications;
    setShowNotifications(next);
    if (!next || notifications.length) return;
    const response = await safeJsonFetch<any>(API_ROUTES.projectNotifications, { headers: await getAuthHeaders() });
    if (response.success) setNotifications((response.data.data || response.data).notifications || []);
  };

  const markNotificationsRead = async () => {
    const response = await safeJsonFetch<any>(API_ROUTES.projectNotificationsRead, { method: 'POST', headers: await getAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({}) });
    if (response.success) {
      setNotifications((current) => current.map((item) => ({ ...item, read_at: item.read_at || new Date().toISOString() })));
      setOverview((current) => current ? { ...current, unreadNotifications: 0 } : current);
    }
  };

  return (
    <section aria-labelledby="project-cockpit-title" className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2"><h2 id="project-cockpit-title" className="text-xl font-semibold">Website projects</h2>{overview?.unreadNotifications ? <button type="button" onClick={() => void toggleNotifications()} className="rounded-full"><StatusBadge tone="warning"><Bell className="h-3.5 w-3.5" /> {overview.unreadNotifications} unread</StatusBadge></button> : null}</div>
          <p className="mt-1 text-sm text-muted-foreground">One place for audit history, measured changes, schedules, and the next useful action.</p>
        </div>
        <button type="button" className="quiet-button" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
      </div>

      {error && <Notice tone="danger">{error}</Notice>}
      {showNotifications && <SurfaceCard className="p-0"><div className="flex items-center justify-between border-b border-border px-4 py-3"><h3 className="font-semibold">Project notifications</h3><button type="button" className="quiet-button min-h-8 px-2 py-1 text-xs" onClick={() => void markNotificationsRead()}><Check className="h-3.5 w-3.5" /> Mark all read</button></div><div className="divide-y divide-border">{notifications.length ? notifications.slice(0, 10).map((item) => <div key={item.id} className="px-4 py-3"><div className="flex items-center gap-2"><span className="text-sm font-semibold">{item.title}</span>{!item.read_at && <span className="h-2 w-2 rounded-full bg-accent" aria-label="Unread" />}</div><p className="mt-1 text-sm text-muted-foreground">{item.message}</p><div className="mt-1 text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()}</div></div>) : <div className="p-5 text-sm text-muted-foreground">No project notifications yet.</div>}</div></SurfaceCard>}
      {loading && !overview ? <SurfaceCard className="flex items-center gap-3 p-6"><Loader2 className="h-5 w-5 animate-spin text-accent" /> Loading website projects...</SurfaceCard> : null}

      {overview && !overview.projects.length ? (
        <SurfaceCard className="p-5 md:p-6">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,.7fr)] lg:items-end">
            <div><h3 className="text-lg font-semibold">Track your first website</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">Create a project to connect audits, comparisons, notifications, and future schedules to one website.</p></div>
            <div className="flex flex-col gap-2 sm:flex-row"><label className="sr-only" htmlFor="project-url">Website URL</label><input id="project-url" className="suite-input min-w-0 flex-1" value={newUrl} onChange={(event) => setNewUrl(event.target.value)} placeholder="https://example.com" /><button type="button" className="trust-button shrink-0" disabled={busy === 'track' || !newUrl.trim()} onClick={() => void trackSite()}>{busy === 'track' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Track site</button></div>
          </div>
        </SurfaceCard>
      ) : null}

      {overview && overview.projects.length ? <>
        <SurfaceCard className="p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(260px,.7fr)_minmax(0,1fr)_auto] lg:items-center">
            <label><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Current website</span><select className="suite-input" value={selectedHost} onChange={(event) => setSelectedHost(event.target.value)}>{overview.projects.map((project) => <option key={project.hostname} value={project.hostname}>{project.name} - {project.hostname}</option>)}</select></label>
            <div className="min-w-0"><div className="truncate text-sm font-semibold">{selected?.normalizedUrl}</div><div className="mt-1 text-xs text-muted-foreground">Next audit: {formatDate(selected?.nextAuditAt)}</div></div>
            <div className="flex flex-wrap gap-2">{selected && !selected.id ? <button type="button" className="quiet-button" disabled={busy === 'track'} onClick={() => void trackSite(selected)}><Plus className="h-4 w-4" /> Track project</button> : null}<button type="button" className="trust-button" onClick={runAudit}>Run audit <ArrowRight className="h-4 w-4" /></button></div>
          </div>
        </SurfaceCard>

        {selected ? <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,.5fr)]">
            <SurfaceCard className="p-5 md:p-7">
              <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold">Latest result and next action</h3>{selected.newCriticalCount ? <StatusBadge tone="danger">{selected.newCriticalCount} new critical</StatusBadge> : selected.latestAudit ? <StatusBadge tone="success">Comparison checked</StatusBadge> : <StatusBadge tone="neutral">Awaiting first audit</StatusBadge>}</div>
              <div className="mt-6 grid gap-6 md:grid-cols-[minmax(190px,.65fr)_minmax(0,1fr)] md:items-center">
                <div className="border-b border-border pb-5 md:border-b-0 md:border-r md:pb-0 md:pr-6"><AuditGrade score={selected.latestAudit?.score} label="Website health" detail={selected.latestAudit ? `Last run ${formatDate(selected.latestAudit.completedAt || selected.latestAudit.createdAt)}` : 'Run an audit to measure this site'} />{selected.scoreDelta != null && <div className={`mt-4 inline-flex items-center gap-1.5 text-sm font-semibold ${selected.scoreDelta < 0 ? 'text-red-600 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{selected.scoreDelta < 0 ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}{selected.scoreDelta > 0 ? '+' : ''}{selected.scoreDelta} since previous audit</div>}</div>
                <div><div className="text-xs font-semibold uppercase text-muted-foreground">Recommended next action</div><p className="mt-2 text-base leading-7">{selected.recommendedAction}</p><div className="mt-5 flex flex-wrap gap-2"><button type="button" className="trust-button" onClick={selected.latestAudit ? openReport : runAudit}>{selected.latestAudit ? 'Open latest report' : 'Run first audit'} <ArrowRight className="h-4 w-4" /></button>{selected.latestAudit && <button type="button" className="quiet-button" onClick={runAudit}>Run again</button>}</div></div>
              </div>
            </SurfaceCard>
            <SurfaceCard className="p-5"><div className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-accent" /><h3 className="text-base font-semibold">Audit schedule</h3></div><p className="mt-2 text-sm leading-6 text-muted-foreground">Scheduled audits enqueue work for the separate audit engine. They never crawl inside Vercel.</p><select className="suite-input mt-4" value={selected.auditFrequency} disabled={!selected.id || busy === 'schedule'} onChange={(event) => void updateSchedule(event.target.value as ProjectAuditFrequency)}><option value="manual">Manual only</option><option value="weekly" disabled={!overview.scheduledAuditsEnabled}>Every week</option><option value="monthly" disabled={!overview.scheduledAuditsEnabled}>Every month</option></select>{!selected.id ? <p className="mt-2 text-xs text-muted-foreground">Track this project before scheduling.</p> : !overview.scheduledAuditsEnabled ? <p className="mt-2 text-xs text-muted-foreground">Automatic schedules are included with Agency and administrator plans.</p> : null}</SurfaceCard>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <MetricCard label="Open findings" value={selected.openFindingCount} detail={`${selected.latestAudit?.criticalCount || 0} critical - ${selected.latestAudit?.highCount || 0} high`} icon={<AlertTriangle className="h-5 w-5" />} tone={selected.latestAudit?.criticalCount ? 'red' : 'yellow'} />
            <MetricCard label="Resolved" value={selected.resolvedFindingCount} detail="Not detected in the latest comparison" icon={<CheckCircle2 className="h-5 w-5" />} tone="green" />
            <MetricCard label="Pages checked" value={selected.latestAudit?.pagesCrawled ?? '--'} detail={selected.latestAudit ? `Last run ${formatDate(selected.latestAudit.completedAt || selected.latestAudit.createdAt)}` : 'No completed audit'} icon={<Globe2 className="h-5 w-5" />} />
          </div>
        </> : null}
      </> : null}
    </section>
  );
}
