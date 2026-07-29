import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, FileText, Globe2, Loader2, Printer, ShieldCheck } from 'lucide-react';
import { API_ROUTES } from '../../lib/api/routes';
import { extractReportScores, groupRecommendations } from '../../lib/audit/report-insights';
import type { ResourceAuditIssue, ResourceAuditPage, ResourceAuditReport } from '../../lib/audit/resource-types';
import { safeJsonFetch } from '../../lib/http/safe-json';
import { AuditGrade, MetricCard, SeverityDistribution, SitePreviewSection, StatusBadge, SurfaceCard } from '../ui/visual-system';
import { Notice } from '../ui/page-system';

type SharedReport = {
  audit: { id: string; normalizedUrl: string; hostname: string; effectiveMode: string; status: string; pagesCrawled: number; issuesFound: number; criticalCount: number; highCount: number; mediumCount: number; lowCount: number; completedAt: string | null };
  report: ResourceAuditReport;
  pages: ResourceAuditPage[];
  issues: ResourceAuditIssue[];
  expiresAt: string;
};

export default function SharedReportPage({ token }: { token: string }) {
  const [data, setData] = useState<SharedReport | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    safeJsonFetch<any>(API_ROUTES.sharedReport(token))
      .then((response) => {
        if (!active) return;
        if (!response.success) throw new Error((response as any).error || 'The shared report is unavailable.');
        setData((response.data.data || response.data) as SharedReport);
      })
      .catch((nextError) => active && setError(nextError instanceof Error ? nextError.message : 'The shared report is unavailable.'));
    return () => { active = false; };
  }, [token]);
  const recommendations = useMemo(() => groupRecommendations(data?.issues || []).slice(0, 12), [data]);
  if (error) return <main id="main-content" className="section-shell py-16"><Notice tone="danger" title="Shared report unavailable">{error}</Notice></main>;
  if (!data) return <main id="main-content" className="section-shell flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-accent" /><span className="ml-3 text-sm font-semibold">Loading shared report...</span></main>;
  const scores = extractReportScores(data.report.scores);
  const firstPage = data.pages.find((page) => page.title || page.metaDescription) || data.pages[0];
  return <main id="main-content" className="section-shell space-y-6 py-8 md:py-12 print:max-w-none print:px-0">
    <header className="flex flex-col gap-5 border-b border-border pb-6 md:flex-row md:items-end md:justify-between"><div><div className="flex flex-wrap items-center gap-2"><StatusBadge tone="success">Read-only report</StatusBadge><StatusBadge tone="neutral">{data.audit.effectiveMode} audit</StatusBadge></div><h1 className="mt-4 text-3xl font-semibold md:text-4xl">{data.audit.hostname}</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">Completed {data.audit.completedAt ? new Date(data.audit.completedAt).toLocaleString() : 'recently'} - Link expires {new Date(data.expiresAt).toLocaleString()}</p></div><button type="button" className="quiet-button print:hidden" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print report</button></header>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Overall score" value={scores.overall ?? '--'} detail="Measured audit evidence" icon={<FileText className="h-5 w-5" />} tone={scores.overall != null && scores.overall >= 80 ? 'green' : 'yellow'} /><MetricCard label="Pages checked" value={data.audit.pagesCrawled} detail="Stored page summaries" icon={<Globe2 className="h-5 w-5" />} /><MetricCard label="Critical findings" value={data.audit.criticalCount} detail={`${data.audit.highCount} high priority`} icon={<AlertTriangle className="h-5 w-5" />} tone={data.audit.criticalCount ? 'red' : 'green'} /><MetricCard label="Report status" value="Ready" detail={data.audit.status.replace(/_/g, ' ')} icon={<ShieldCheck className="h-5 w-5" />} tone="green" /></div>
    <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]"><SurfaceCard className="p-6"><AuditGrade score={scores.overall} detail="Final stored score" /><div className="mt-6"><SeverityDistribution critical={data.audit.criticalCount} high={data.audit.highCount} medium={data.audit.mediumCount} low={data.audit.lowCount} /></div></SurfaceCard><SurfaceCard className="p-6"><h2 className="text-xl font-semibold">Executive summary</h2><p className="mt-3 text-base leading-7 text-muted-foreground">{data.report.summary}</p><div className="mt-5 flex items-center gap-2 text-xs text-muted-foreground"><CalendarClock className="h-4 w-4" /> Generated {new Date(data.report.generatedAt).toLocaleString()}</div></SurfaceCard></div>
    <SurfaceCard className="p-0"><div className="border-b border-border p-5"><h2 className="text-xl font-semibold">Top fixes first</h2><p className="mt-1 text-sm text-muted-foreground">Prioritized findings grouped by the issue and affected pages.</p></div><div className="divide-y divide-border">{recommendations.length ? recommendations.map((item) => <article key={`${item.section}-${item.title}`} className="grid gap-3 p-5 md:grid-cols-[minmax(0,1fr)_180px]"><div><div className="flex flex-wrap items-center gap-2"><StatusBadge tone={item.severity === 'critical' ? 'danger' : item.severity === 'high' ? 'warning' : 'neutral'}>{item.severity}</StatusBadge><h3 className="font-semibold">{item.title}</h3></div><p className="mt-2 text-sm leading-6 text-muted-foreground">{item.recommendation}</p></div><div className="text-sm md:text-right"><strong>{item.affectedCount}</strong><span className="ml-1 text-muted-foreground">affected {item.affectedCount === 1 ? 'page' : 'pages'}</span></div></article>) : <div className="p-8 text-center text-sm text-muted-foreground">No prioritized findings were stored.</div>}</div></SurfaceCard>
    {firstPage ? <SitePreviewSection url={firstPage.url || data.audit.normalizedUrl} hostname={data.audit.hostname} title={firstPage.title} description={firstPage.metaDescription} h1={firstPage.h1} canonicalUrl={firstPage.canonicalUrl} siteName={firstPage.siteName} faviconUrl={firstPage.faviconUrl} openGraphImage={firstPage.openGraphImage} screenshotUrl={firstPage.screenshotUrl} themeColor={firstPage.themeColor} /> : null}
  </main>;
}
