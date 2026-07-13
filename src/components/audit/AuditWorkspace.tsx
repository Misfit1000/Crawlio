import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, CheckCircle2, Clock3, Copy, FileDown, Globe2, Layers, Loader2, RefreshCw, Search, ShieldCheck, Wrench } from 'lucide-react';
import { NavLink } from 'react-router';
import { auditWorkspacePath, type AuditWorkspaceSection } from '../../app/routes';
import { API_ROUTES } from '../../lib/api/routes';
import { getAuditAccessHeaders } from '../../lib/api/auth-headers';
import { readChecklist, writeChecklist, type ChecklistStatus } from '../../lib/audit/client-insights';
import { isCompletedAuditStatus } from '../../lib/audit/audit-time';
import { customerSafeDiagnosticText } from '../../lib/audit/audit-failures';
import { classifyReportSection, extractReportScores, observedPageMetrics } from '../../lib/audit/report-insights';
import type { AuditComparison, AuditHistoryPage, AuditMode } from '../../lib/audit/resource-types';
import { downloadAuditExport } from '../../lib/http/download';
import { safeJsonFetch } from '../../lib/http/safe-json';
import { EmptyState, MetricBarChart, MetricCard, SitePreviewSection, StatusBadge, SurfaceCard } from '../ui/visual-system';
import { Notice } from '../ui/page-system';
import AuditActivityPanel from './AuditActivityPanel';
import { AuditExecutiveSummary, PriorityRecommendations, type AuditCategoryScore } from './AuditExecutiveSummary';
import { AuditWorkspaceProvider, useAuditWorkspace } from './AuditWorkspaceContext';
import FindingWorkspace from './FindingWorkspace';
import { AuditReportReadyNote, AuditTerminalState } from './AuditTerminalState';

const sections: Array<{ id: AuditWorkspaceSection; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'seo', label: 'SEO' },
  { id: 'technical', label: 'Technical' },
  { id: 'crawlability', label: 'Crawlability' },
  { id: 'links', label: 'Links' },
  { id: 'performance', label: 'Performance' },
  { id: 'security', label: 'Passive security' },
  { id: 'pages', label: 'Pages' },
];

const reportSectionForRoute: Partial<Record<AuditWorkspaceSection, ReturnType<typeof classifyReportSection>>> = {
  seo: 'on-page',
  technical: 'technical',
  crawlability: 'crawlability',
  links: 'internal-links',
  performance: 'performance',
  security: 'security',
};

const sectionScoreKey: Partial<Record<AuditWorkspaceSection, 'seo' | 'technical' | 'crawlability' | 'performance' | 'security'>> = {
  seo: 'seo',
  technical: 'technical',
  crawlability: 'crawlability',
  performance: 'performance',
  security: 'security',
};

function modeLabel(mode: AuditMode) {
  if (mode === 'deep') return 'Deep audit';
  if (mode === 'standard') return 'Full audit';
  return 'Quick audit';
}

function auditStatusLabel(status: string) {
  if (status === 'queued') return 'Waiting to start';
  if (status === 'running') return 'Checking your site';
  if (status === 'completed') return 'Completed';
  if (status === 'completed_with_warnings') return 'Completed with warnings';
  return status.replace(/_/g, ' ');
}

function ComparisonPanel() {
  const { auditId, data } = useAuditWorkspace();
  const [history, setHistory] = useState<AuditHistoryPage | null>(null);
  const [baselineId, setBaselineId] = useState('');
  const [comparison, setComparison] = useState<AuditComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hostname = data.audit?.hostname;

  useEffect(() => {
    if (!hostname) return;
    getAuditAccessHeaders()
      .then((headers) => safeJsonFetch<any>(`${API_ROUTES.auditHistory}?hostname=${encodeURIComponent(hostname)}&limit=50`, { headers }))
      .then((response) => {
        if (!response.success) return;
        const next = (response.data.data || response.data) as AuditHistoryPage;
        const completedItems = next.items.filter((item) => isCompletedAuditStatus(item.audit.status));
        setHistory({ ...next, items: completedItems });
        setBaselineId(completedItems.find((item) => item.audit.id !== auditId)?.audit.id || '');
      })
      .catch(() => undefined);
  }, [auditId, hostname]);

  const compare = async () => {
    if (!baselineId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await safeJsonFetch<any>(API_ROUTES.auditCompare(auditId, baselineId), { headers: await getAuditAccessHeaders() });
      if (!response.success) throw new Error((response as any).error || 'Comparison failed.');
      setComparison((response.data.data || response.data) as AuditComparison);
    } catch (comparisonError) {
      setError(comparisonError instanceof Error ? comparisonError.message : 'The audit comparison could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  if (!history?.items.some((item) => item.audit.id !== auditId)) return null;
  return (
    <SurfaceCard id="audit-comparison" className="p-5 md:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="text-xl font-semibold">Compare with an earlier audit</h2><p className="mt-1 text-sm text-muted-foreground">Review new, resolved, and persistent findings from stored audit history.</p></div><div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto"><select className="suite-input min-w-64" value={baselineId} onChange={(event) => setBaselineId(event.target.value)} aria-label="Earlier audit"><option value="">Choose an earlier audit</option>{history.items.filter((item) => item.audit.id !== auditId).map((item) => <option key={item.audit.id} value={item.audit.id}>{new Date(item.audit.createdAt).toLocaleString()} · {modeLabel(item.audit.effectiveMode)}</option>)}</select><button type="button" className="trust-button" onClick={compare} disabled={!baselineId || loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />} Compare</button></div></div>
      {error && <Notice tone="danger" className="mt-4">{error}</Notice>}
      {comparison && <div className="mt-5 grid gap-4 xl:grid-cols-2"><div className="grid gap-3 sm:grid-cols-2"><MetricCard label="Score change" value={comparison.scoreDelta == null ? '—' : `${comparison.scoreDelta > 0 ? '+' : ''}${comparison.scoreDelta}`} detail="Compared with selected audit" icon={comparison.scoreDelta != null && comparison.scoreDelta >= 0 ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5" />} tone={comparison.scoreDelta != null && comparison.scoreDelta >= 0 ? 'green' : 'red'} /><MetricCard label="Resolved" value={comparison.resolvedIssues.length} detail="No longer detected" icon={<CheckCircle2 className="h-5 w-5" />} tone="green" /></div><div className="grid gap-3 sm:grid-cols-2"><MetricCard label="New findings" value={comparison.newIssues.length} detail="Appeared in this audit" icon={<AlertTriangle className="h-5 w-5" />} tone={comparison.newIssues.length ? 'yellow' : 'green'} /><MetricCard label="Still present" value={comparison.persistentIssues.length} detail="Detected in both audits" icon={<Wrench className="h-5 w-5" />} /></div></div>}
    </SurfaceCard>
  );
}

function AuditWorkspaceContent({ section, onRerun }: { section: AuditWorkspaceSection; onRerun?: (url: string, mode: AuditMode) => void | Promise<void> }) {
  const { auditId, data, loading, error, connection, reportPending, reportRetrying, refresh, retryFinalReport } = useAuditWorkspace();
  const audit = data.audit;
  const safeWorkspaceError = customerSafeDiagnosticText(error) || 'The stored audit could not be loaded.';
  const scores = extractReportScores(data.finalReport?.scores);
  const metrics = observedPageMetrics(data.latestPages);
  const firstPage = data.latestPages.find((page) => page.title || page.metaDescription) || data.latestPages[0];
  const [checklist, setChecklist] = useState<Record<string, ChecklistStatus>>(() => readChecklist(auditId));
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const issues = useMemo(() => {
    const target = reportSectionForRoute[section];
    return target ? data.latestIssues.filter((issue) => classifyReportSection(issue) === target) : data.latestIssues;
  }, [data.latestIssues, section]);
  const sectionCounts = useMemo(() => Object.fromEntries(sections.map((item) => {
    if (item.id === 'overview') return [item.id, data.latestIssues.length];
    if (item.id === 'pages') return [item.id, data.latestPages.length];
    const target = reportSectionForRoute[item.id];
    return [item.id, target ? data.latestIssues.filter((issue) => classifyReportSection(issue) === target).length : 0];
  })), [data.latestIssues, data.latestPages]);

  const updateChecklist = (signature: string, status: ChecklistStatus) => {
    setChecklist((current) => {
      const next = { ...current, [signature]: status };
      writeChecklist(auditId, next);
      return next;
    });
  };

  const copyReportLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setActionMessage('Report link copied. Access rules still apply.');
    } catch {
      setActionMessage('Copy failed. Use the address shown in the browser.');
    } finally {
      window.setTimeout(() => setActionMessage(null), 3000);
    }
  };

  const openComparison = () => {
    const target = document.getElementById('audit-comparison');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    setActionMessage('Complete another audit for this website to create a comparison.');
    window.setTimeout(() => setActionMessage(null), 3000);
  };

  if (loading && !audit) return <SurfaceCard className="flex items-center gap-3 p-6"><Loader2 className="h-5 w-5 animate-spin text-accent" /> Loading stored audit evidence...</SurfaceCard>;
  if (error && !audit) return <SurfaceCard className="p-5 sm:p-6"><Notice tone="danger" title="Audit unavailable">{safeWorkspaceError} This audit may have expired, been deleted, or be unavailable to this account.</Notice><div className="mt-5 flex flex-wrap gap-2"><button type="button" className="trust-button" onClick={() => void refresh().catch(() => undefined)}><RefreshCw className="h-4 w-4" /> Try again</button><NavLink className="quiet-button" to="/app/audits/history">Audit history</NavLink><NavLink className="quiet-button" to="/app">Dashboard</NavLink></div></SurfaceCard>;
  if (!audit) return <EmptyState icon={FileDown} title="Audit not found" description="This audit is unavailable or your account does not have access." />;

  const categoryScoreCandidates: Array<Omit<AuditCategoryScore, 'value'> & { value: number | null }> = [
    { label: 'On-page SEO', value: scores.seo, detail: 'Titles, descriptions, headings', tone: 'green' },
    { label: 'Technical SEO', value: scores.technical, detail: 'Delivery and status signals', tone: 'accent' },
    { label: 'Crawlability', value: scores.crawlability, detail: 'Search access and indexing', tone: 'accent' },
    { label: 'Passive security', value: scores.security, detail: 'Public browser protections', tone: 'green' },
  ];
  const categoryScores: AuditCategoryScore[] = categoryScoreCandidates.filter((item): item is AuditCategoryScore => item.value != null);
  const unavailableChecks = Array.isArray(data.finalReport?.scores?.unavailableChecks) ? data.finalReport.scores.unavailableChecks.length : null;
  const pageResults = [
    { label: '2xx', value: data.latestPages.filter((page) => page.statusCode >= 200 && page.statusCode < 300).length, color: 'bg-emerald-500' },
    { label: '3xx', value: data.latestPages.filter((page) => page.statusCode >= 300 && page.statusCode < 400).length, color: 'bg-sky-500' },
    { label: '4xx', value: data.latestPages.filter((page) => page.statusCode >= 400 && page.statusCode < 500).length, color: 'bg-amber-500' },
    { label: '5xx / unavailable', value: data.latestPages.filter((page) => page.statusCode >= 500 || page.fetchStatus === 'failed' || page.fetchStatus === 'blocked').length, color: 'bg-red-500' },
  ];
  const statusTone = isCompletedAuditStatus(audit.status) ? (audit.status === 'completed_with_warnings' ? 'warning' : 'success') : audit.status === 'failed' ? 'danger' : 'accent';

  return (
    <div className="w-full space-y-6 animate-rise">
      <AuditActivityPanel events={data.latestEvents} phase={audit.currentPhase} progress={audit.progress} pagesAnalysed={audit.pagesCrawled} pageLimit={audit.pageLimit} />
      <div className="h-10 sm:h-12" aria-hidden="true" />
      <header className="suite-panel overflow-hidden">
        <div className="data-rule h-1" />
        <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-center lg:justify-between lg:p-6">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><StatusBadge tone={statusTone}>{auditStatusLabel(audit.status)}</StatusBadge><StatusBadge tone="accent">{modeLabel(audit.effectiveMode)}</StatusBadge><span className="text-xs text-muted-foreground">Updated {new Date(audit.updatedAt).toLocaleString()}</span></div><h1 className="mt-3 truncate text-2xl font-semibold sm:text-3xl" title={audit.hostname}>{audit.hostname}</h1><p className="mt-1 truncate text-sm text-muted-foreground" title={audit.normalizedUrl}>{audit.normalizedUrl}</p></div>
          <div className="flex flex-wrap gap-2">
            {onRerun && <button type="button" onClick={() => onRerun(audit.normalizedUrl, audit.effectiveMode)} className="trust-button min-h-10 px-3 py-2 text-sm"><RefreshCw className="h-4 w-4" /> Rerun</button>}
            <button type="button" onClick={openComparison} className="quiet-button min-h-10 px-3 py-2 text-sm"><BarChart3 className="h-4 w-4" /> Compare</button>
            <button type="button" onClick={copyReportLink} className="quiet-button min-h-10 px-3 py-2 text-sm"><Copy className="h-4 w-4" /> Copy link</button>
            <button type="button" onClick={() => downloadAuditExport(auditId, 'pdf')} disabled={!data.finalReport} className="quiet-button min-h-10 px-3 py-2 text-sm"><FileDown className="h-4 w-4" /> PDF</button>
            <button type="button" onClick={() => downloadAuditExport(auditId, 'json')} disabled={!data.finalReport} className="quiet-button min-h-10 px-3 py-2 text-sm"><FileDown className="h-4 w-4" /> JSON</button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border bg-[var(--surface-inset)] px-5 py-3 text-xs text-muted-foreground lg:px-6"><span className="inline-flex items-center gap-2"><Clock3 className="h-3.5 w-3.5" /> {connection.message}</span><span className="inline-flex items-center gap-2"><Layers className="h-3.5 w-3.5" /> {audit.pagesCrawled} of {Math.max(audit.pagesDiscovered, audit.pagesCrawled)} discovered pages analysed</span><span className="inline-flex items-center gap-2"><Search className="h-3.5 w-3.5" /> {audit.checksCompleted} checks completed</span></div>
      </header>
      <AuditTerminalState
        audit={audit}
        reportPending={reportPending}
        reportRetrying={reportRetrying}
        onRetryReport={retryFinalReport}
        onRerun={onRerun ? () => onRerun(audit.normalizedUrl, audit.effectiveMode) : undefined}
      />
      <AuditReportReadyNote warning={audit.status === 'completed_with_warnings' && Boolean(data.finalReport)} />
      {error && <Notice tone="danger" title="Some audit data could not refresh">{safeWorkspaceError}</Notice>}
      {actionMessage && <Notice tone={actionMessage.startsWith('Copy failed') ? 'danger' : 'success'}>{actionMessage}</Notice>}

      <nav className="no-scrollbar flex gap-1 overflow-x-auto border-y border-border py-2" aria-label="Audit sections">
        {sections.map((item) => {
          const scoreKey = sectionScoreKey[item.id];
          const score = scoreKey ? scores[scoreKey] : null;
          return <NavLink key={item.id} to={auditWorkspacePath(auditId, item.id)} className={({ isActive }) => `flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors ${isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><span>{item.label}</span><span className={`rounded-full px-1.5 py-0.5 text-[11px] ${score != null ? 'bg-current/10' : 'bg-muted'}`}>{score != null ? Math.round(score) : sectionCounts[item.id]}</span></NavLink>;
        })}
      </nav>

      <AuditExecutiveSummary audit={audit} score={scores.overall} scoreDetail="Calculated from stored audit evidence" categoryScores={section === 'overview' ? categoryScores : []} unavailableChecks={unavailableChecks} />
      <PriorityRecommendations issues={section === 'overview' ? data.latestIssues : issues} statuses={checklist} onViewFindings={() => document.getElementById('finding-workspace-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />

      {section === 'overview' && <>
        <div className="grid gap-4 xl:grid-cols-2">
          <SurfaceCard className="p-5 md:p-6"><div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">Page results</h2><p className="mt-1 text-sm text-muted-foreground">Stored response outcomes from pages the audit attempted.</p></div><Globe2 className="h-5 w-5 text-accent" /></div><div className="mt-5"><MetricBarChart items={pageResults} /></div></SurfaceCard>
          <SurfaceCard className="p-5 md:p-6"><div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">Observed delivery</h2><p className="mt-1 text-sm text-muted-foreground">Audit-time response observations, not browser-measured Core Web Vitals.</p></div><ShieldCheck className="h-5 w-5 text-accent" /></div><dl className="mt-5 grid grid-cols-2 gap-4"><div><dt className="text-xs text-muted-foreground">Average response</dt><dd className="mt-1 text-2xl font-semibold">{metrics.averageResponseMs ? `${Math.round(metrics.averageResponseMs)} ms` : '—'}</dd></div><div><dt className="text-xs text-muted-foreground">Pages with findings</dt><dd className="mt-1 text-2xl font-semibold">{data.latestPages.filter((page) => page.issueCount > 0).length}</dd></div><div><dt className="text-xs text-muted-foreground">Average page size</dt><dd className="mt-1 text-2xl font-semibold">{metrics.averagePageBytes ? `${Math.round(metrics.averagePageBytes / 1024)} KB` : '—'}</dd></div><div><dt className="text-xs text-muted-foreground">Deepest page level</dt><dd className="mt-1 text-2xl font-semibold">{data.latestPages.length ? Math.max(...data.latestPages.map((page) => page.crawlDepth)) : '—'}</dd></div></dl></SurfaceCard>
        </div>
        {firstPage && <SitePreviewSection url={firstPage.url || audit.normalizedUrl} hostname={audit.hostname} title={firstPage.title} description={firstPage.metaDescription} h1={firstPage.h1} canonicalUrl={firstPage.canonicalUrl} siteName={firstPage.siteName} faviconUrl={firstPage.faviconUrl} openGraphImage={firstPage.openGraphImage} screenshotUrl={firstPage.screenshotUrl} themeColor={firstPage.themeColor} />}
        <ComparisonPanel />
        <FindingWorkspace auditId={auditId} issues={data.latestIssues} statuses={checklist} onStatusChange={updateChecklist} />
      </>}

      {section === 'pages' && <SurfaceCard className="overflow-hidden p-0"><div className="border-b border-border p-5"><h2 className="text-xl font-semibold">Pages analysed</h2><p className="mt-1 text-sm text-muted-foreground">Actual page summaries stored by the audit service.</p></div><div className="overflow-x-auto" role="region" aria-label="Analysed pages" tabIndex={0}><table className="suite-table min-w-[760px]"><thead><tr><th>URL</th><th>Status</th><th>Response</th><th>Size</th><th>Findings</th></tr></thead><tbody>{data.latestPages.length ? data.latestPages.map((page) => <tr key={page.id}><td className="max-w-xl"><div className="truncate font-semibold">{page.title || 'Untitled page'}</div><div className="truncate text-xs text-muted-foreground">{page.url}</div></td><td className="tabular-nums">{page.statusCode || '—'}</td><td className="tabular-nums">{page.responseTimeMs ? `${page.responseTimeMs} ms` : '—'}</td><td className="tabular-nums">{page.pageSizeBytes ? `${Math.round(page.pageSizeBytes / 1024)} KB` : '—'}</td><td className="tabular-nums">{page.issueCount}</td></tr>) : <tr><td colSpan={5} className="py-10 text-center text-muted-foreground">No page summaries were stored for this audit.</td></tr>}</tbody></table></div></SurfaceCard>}

      {section !== 'overview' && section !== 'pages' && <section><div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-2xl font-semibold">{sections.find((item) => item.id === section)?.label} findings</h2><p className="mt-1 text-sm text-muted-foreground">Open a row for evidence, affected pages, workflow status, and notes.</p></div>{section === 'security' && <StatusBadge tone="accent">Passive observations only</StatusBadge>}</div>{issues.length ? <div className="mt-5"><FindingWorkspace auditId={auditId} issues={issues} statuses={checklist} onStatusChange={updateChecklist} /></div> : <SurfaceCard className="mt-5 p-6"><EmptyState icon={CheckCircle2} title="No stored findings in this section" description="Review coverage and unavailable checks before treating the section as fully clear." /></SurfaceCard>}</section>}
    </div>
  );
}

export default function AuditWorkspace({ auditId, section, onRerun }: { auditId: string; section: AuditWorkspaceSection; onRerun?: (url: string, mode: AuditMode) => void | Promise<void> }) {
  return <AuditWorkspaceProvider auditId={auditId}><AuditWorkspaceContent section={section} onRerun={onRerun} /></AuditWorkspaceProvider>;
}
