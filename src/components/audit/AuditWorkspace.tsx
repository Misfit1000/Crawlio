import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, CheckCircle2, FileDown, Globe2, Layers, Loader2, Search, ShieldCheck, Wrench } from 'lucide-react';
import { NavLink } from 'react-router';
import { auditWorkspacePath, type AuditWorkspaceSection } from '../../app/routes';
import { API_ROUTES } from '../../lib/api/routes';
import { getAuditAccessHeaders } from '../../lib/api/auth-headers';
import { buildIssueInsight } from '../../lib/audit/client-insights';
import { classifyReportSection, extractReportScores, observedPageMetrics } from '../../lib/audit/report-insights';
import type { AuditComparison, AuditHistoryPage, ResourceAuditIssue } from '../../lib/audit/resource-types';
import { downloadAuditExport } from '../../lib/http/download';
import { safeJsonFetch } from '../../lib/http/safe-json';
import { EmptyState, MetricCard, RadialScoreGauge, SeverityDistribution, SitePreviewSection, StatusBadge, SurfaceCard } from '../ui/visual-system';
import { Notice, PageHeader } from '../ui/page-system';
import { AuditWorkspaceProvider, useAuditWorkspace } from './AuditWorkspaceContext';

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

function FindingCard({ issue }: { issue: ResourceAuditIssue }) {
  const insight = buildIssueInsight(issue);
  return (
    <SurfaceCard className="h-full p-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={issue.severity === 'critical' ? 'danger' : issue.severity === 'high' || issue.severity === 'medium' ? 'warning' : 'neutral'}>{issue.severity} priority</StatusBadge>
        <StatusBadge tone="accent">{issue.category}</StatusBadge>
      </div>
      <h3 className="mt-4 text-lg font-semibold">{issue.title}</h3>
      <p className="mt-1 break-all text-xs text-muted-foreground">{issue.affectedUrl}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-muted/25 p-3"><div className="text-xs font-semibold">What happened</div><p className="mt-1 text-sm leading-6 text-muted-foreground">{issue.description}</p></div>
        <div className="rounded-lg border border-border bg-muted/25 p-3"><div className="text-xs font-semibold">Why it matters</div><p className="mt-1 text-sm leading-6 text-muted-foreground">{insight.whyItMatters}</p></div>
        <div className="rounded-lg border border-border bg-muted/25 p-3 sm:col-span-2"><div className="text-xs font-semibold">How to fix it</div><p className="mt-1 text-sm leading-6 text-muted-foreground">{issue.recommendation}</p></div>
      </div>
      {issue.evidence && <details className="mt-3 rounded-lg border border-border px-3 py-2 text-sm"><summary className="cursor-pointer font-semibold">Technical evidence</summary><p className="mt-2 break-words text-muted-foreground">{issue.evidence}</p></details>}
    </SurfaceCard>
  );
}

function ComparisonPanel() {
  const { auditId, data } = useAuditWorkspace();
  const [history, setHistory] = useState<AuditHistoryPage | null>(null);
  const [baselineId, setBaselineId] = useState('');
  const [comparison, setComparison] = useState<AuditComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const hostname = data.audit?.hostname;

  useEffect(() => {
    if (!hostname) return;
    getAuditAccessHeaders()
      .then((headers) => safeJsonFetch<any>(`${API_ROUTES.auditHistory}?hostname=${encodeURIComponent(hostname)}&status=completed&limit=50`, { headers }))
      .then((response) => {
        if (!response.success) return;
        const next = (response.data.data || response.data) as AuditHistoryPage;
        setHistory(next);
        setBaselineId(next.items.find((item) => item.audit.id !== auditId)?.audit.id || '');
      })
      .catch(() => undefined);
  }, [auditId, hostname]);

  const compare = async () => {
    if (!baselineId) return;
    setLoading(true);
    try {
      const response = await safeJsonFetch<any>(API_ROUTES.auditCompare(auditId, baselineId), { headers: await getAuditAccessHeaders() });
      if (!response.success) throw new Error((response as any).error || 'Comparison failed.');
      setComparison((response.data.data || response.data) as AuditComparison);
    } finally {
      setLoading(false);
    }
  };

  if (!history?.items.some((item) => item.audit.id !== auditId)) return null;
  return (
    <SurfaceCard className="p-5 md:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><h2 className="text-xl font-semibold">Compare with an earlier audit</h2><p className="mt-1 text-sm text-muted-foreground">See new, resolved, and persistent findings from stored Supabase results.</p></div>
        <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
          <select className="suite-input min-w-64" value={baselineId} onChange={(event) => setBaselineId(event.target.value)}>
            {history.items.filter((item) => item.audit.id !== auditId).map((item) => <option key={item.audit.id} value={item.audit.id}>{new Date(item.audit.createdAt).toLocaleString()} · {item.audit.effectiveMode}</option>)}
          </select>
          <button type="button" className="trust-button" onClick={compare} disabled={!baselineId || loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />} Compare</button>
        </div>
      </div>
      {comparison && <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Score change" value={comparison.scoreDelta == null ? '--' : `${comparison.scoreDelta > 0 ? '+' : ''}${comparison.scoreDelta}`} detail="Compared with selected audit" icon={comparison.scoreDelta != null && comparison.scoreDelta >= 0 ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5" />} tone={comparison.scoreDelta != null && comparison.scoreDelta >= 0 ? 'green' : 'red'} />
        <MetricCard label="New findings" value={comparison.newIssues.length} detail="Appeared in this audit" icon={<AlertTriangle className="h-5 w-5" />} tone={comparison.newIssues.length ? 'yellow' : 'green'} />
        <MetricCard label="Resolved" value={comparison.resolvedIssues.length} detail="No longer detected" icon={<CheckCircle2 className="h-5 w-5" />} tone="green" />
        <MetricCard label="Still open" value={comparison.persistentIssues.length} detail="Detected in both audits" icon={<Wrench className="h-5 w-5" />} />
      </div>}
    </SurfaceCard>
  );
}

function AuditWorkspaceContent({ section }: { section: AuditWorkspaceSection }) {
  const { auditId, data, loading, error, connection } = useAuditWorkspace();
  const audit = data.audit;
  const scores = extractReportScores(data.finalReport?.scores);
  const metrics = observedPageMetrics(data.latestPages);
  const firstPage = data.latestPages[0];
  const issues = useMemo(() => {
    const target = reportSectionForRoute[section];
    return target ? data.latestIssues.filter((issue) => classifyReportSection(issue) === target) : data.latestIssues;
  }, [data.latestIssues, section]);

  if (loading) return <SurfaceCard className="flex items-center gap-3 p-6"><Loader2 className="h-5 w-5 animate-spin text-accent" /> Loading stored audit evidence...</SurfaceCard>;
  if (error) return <Notice tone="danger" title="Audit workspace could not load">{error}</Notice>;
  if (!audit) return <EmptyState icon={FileDown} title="Audit not found" description="This audit is unavailable or your account does not have access." />;

  return (
    <div className="w-full space-y-6 animate-rise">
      <PageHeader eyebrow="Audit workspace" icon={Search} title={audit.hostname} description={`${audit.effectiveMode} audit · ${audit.pagesCrawled} pages checked · ${audit.status === 'completed' ? 'stored report' : connection.message}`} actions={<StatusBadge tone={audit.status === 'completed' ? 'success' : audit.status === 'failed' ? 'danger' : 'warning'}>{audit.status}</StatusBadge>} />
      <nav className="no-scrollbar flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1" aria-label="Audit sections">
        {sections.map((item) => <NavLink key={item.id} to={auditWorkspacePath(auditId, item.id)} className={({ isActive }) => `shrink-0 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>{item.label}</NavLink>)}
      </nav>

      {section === 'overview' && <>
        <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
          <SurfaceCard className="flex items-center justify-center p-5"><RadialScoreGauge value={scores.overall} label="Overall score" /></SurfaceCard>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Pages checked" value={audit.pagesCrawled} detail={`${audit.pagesDiscovered} discovered`} icon={<Layers className="h-5 w-5" />} />
            <MetricCard label="Findings" value={audit.issuesFound} detail="Measured audit findings" icon={<Wrench className="h-5 w-5" />} tone={audit.criticalCount || audit.highCount ? 'yellow' : 'green'} />
            <MetricCard label="Average response" value={metrics.averageResponseMs ? `${Math.round(metrics.averageResponseMs)} ms` : '--'} detail="Audit-time observation" icon={<BarChart3 className="h-5 w-5" />} />
            <MetricCard label="Audit type" value={audit.effectiveMode} detail={`${audit.pageLimit} page maximum`} icon={<Globe2 className="h-5 w-5" />} />
          </div>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <SurfaceCard className="p-5 md:p-6"><h2 className="text-xl font-semibold">Fix priority</h2><p className="mb-5 mt-1 text-sm text-muted-foreground">Measured findings grouped by urgency.</p><SeverityDistribution critical={audit.criticalCount} high={audit.highCount} medium={audit.mediumCount} low={audit.lowCount} /></SurfaceCard>
          <SurfaceCard className="p-5 md:p-6"><h2 className="text-xl font-semibold">Scoring transparency</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Scores use measured, deduplicated findings and affected-page reach. Plan page limits never improve or reduce a score. Unavailable provider or browser metrics remain unscored.</p><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div className="rounded-lg bg-muted/35 p-3">SEO <strong className="float-right">{scores.seo ?? '--'}</strong></div><div className="rounded-lg bg-muted/35 p-3">Technical <strong className="float-right">{scores.technical ?? '--'}</strong></div><div className="rounded-lg bg-muted/35 p-3">Crawlability <strong className="float-right">{scores.crawlability ?? '--'}</strong></div><div className="rounded-lg bg-muted/35 p-3">Security <strong className="float-right">{scores.security ?? '--'}</strong></div></div></SurfaceCard>
        </div>
        {firstPage && <SitePreviewSection
          url={firstPage.url || audit.normalizedUrl}
          hostname={audit.hostname}
          title={firstPage.title}
          description={firstPage.metaDescription}
          h1={firstPage.h1}
          canonicalUrl={firstPage.canonicalUrl}
          siteName={firstPage.siteName}
          faviconUrl={firstPage.faviconUrl}
          openGraphImage={firstPage.openGraphImage}
          screenshotUrl={firstPage.screenshotUrl}
          themeColor={firstPage.themeColor}
        />}
        <ComparisonPanel />
        <section><h2 className="text-xl font-semibold">Top fixes first</h2><p className="mt-1 text-sm text-muted-foreground">Start with the highest-priority measured findings.</p><div className="mt-4 grid gap-4 xl:grid-cols-2">{data.latestIssues.slice().sort((a, b) => ['critical','high','medium','low','info'].indexOf(a.severity) - ['critical','high','medium','low','info'].indexOf(b.severity)).slice(0, 8).map((issue) => <FindingCard key={issue.id} issue={issue} />)}</div></section>
      </>}

      {section === 'pages' && <SurfaceCard className="overflow-hidden p-0"><div className="border-b border-border p-5"><h2 className="text-xl font-semibold">Pages checked</h2><p className="mt-1 text-sm text-muted-foreground">Actual page summaries stored by the audit engine.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-muted/35 text-xs text-muted-foreground"><tr><th className="p-3">URL</th><th className="p-3">Status</th><th className="p-3">Response</th><th className="p-3">Size</th><th className="p-3">Findings</th></tr></thead><tbody>{data.latestPages.map((page) => <tr key={page.id} className="border-t border-border"><td className="max-w-xl p-3"><div className="truncate font-semibold">{page.title || 'Untitled page'}</div><div className="truncate text-xs text-muted-foreground">{page.url}</div></td><td className="p-3 tabular-nums">{page.statusCode}</td><td className="p-3 tabular-nums">{page.responseTimeMs} ms</td><td className="p-3 tabular-nums">{Math.round(page.pageSizeBytes / 1024)} KB</td><td className="p-3 tabular-nums">{page.issueCount}</td></tr>)}</tbody></table></div></SurfaceCard>}

      {section !== 'overview' && section !== 'pages' && <section><div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-2xl font-semibold">{sections.find((item) => item.id === section)?.label}</h2><p className="mt-1 text-sm text-muted-foreground">Measured findings for this audit section. Technical evidence stays available inside each card.</p></div>{section === 'security' && <StatusBadge tone="accent">Passive observations only</StatusBadge>}</div>{issues.length ? <div className="mt-5 grid gap-4 xl:grid-cols-2">{issues.map((issue) => <FindingCard key={issue.id} issue={issue} />)}</div> : <SurfaceCard className="mt-5 p-6"><EmptyState icon={CheckCircle2} title="No stored findings in this section" description="This only reflects checks the audit engine measured; unavailable data is not invented." /></SurfaceCard>}</section>}

      <div className="flex flex-wrap gap-2 border-t border-border pt-5"><button type="button" className="trust-button" onClick={() => downloadAuditExport(auditId, 'pdf')} disabled={audit.status !== 'completed'}><FileDown className="h-4 w-4" /> Download PDF</button><button type="button" className="quiet-button" onClick={() => downloadAuditExport(auditId, 'json')}><FileDown className="h-4 w-4" /> Export JSON</button></div>
    </div>
  );
}

export default function AuditWorkspace({ auditId, section }: { auditId: string; section: AuditWorkspaceSection }) {
  return <AuditWorkspaceProvider auditId={auditId}><AuditWorkspaceContent section={section} /></AuditWorkspaceProvider>;
}
