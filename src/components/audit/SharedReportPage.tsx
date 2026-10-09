import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Loader2, Printer } from 'lucide-react';
import { API_ROUTES } from '../../lib/api/routes';
import { extractReportScores, groupRecommendations } from '../../lib/audit/report-insights';
import type { ResourceAuditIssue, ResourceAuditPage, ResourceAuditReport } from '../../lib/audit/resource-types';
import { safeJsonFetch } from '../../lib/http/safe-json';
import { AuditGrade, SeverityDistribution, SitePreviewSection, StatusBadge, StickyReportNavigation } from '../ui/visual-system';
import { Notice } from '../ui/page-system';
import { readAuditPresentationSummary } from '../../lib/audit/audit-presentation-summary';
import { auditFocusLabel, auditScopeScoreLabel, isFocusedAudit, type AuditScope } from '../../lib/audit/audit-scope';
import { reportCategoryScores, scopeFindings, scopePresentationSummary, scopeScoreMetadata } from '../../lib/report/scope-presentation';
import { AuditScoreFactors } from './AuditExecutiveSummary';
import { AuditDeliveryCharts } from './AuditDeliveryCharts';
import { samplePresentation } from './audit-presentation';

type SharedReport = {
  audit: { scope?: AuditScope | null; id: string; normalizedUrl: string; hostname: string; effectiveMode: string; status: string; pagesCrawled: number; issuesFound: number; criticalCount: number; highCount: number; mediumCount: number; lowCount: number; completedAt: string | null };
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
  const scope = data?.audit.scope || data?.report.scope;
  const complete = useMemo(() => scopePresentationSummary(scope, readAuditPresentationSummary(data?.report.presentationSummary)), [data?.report.presentationSummary, scope]);
  const recommendations = useMemo(() => complete ? complete.topRecommendations.map(item => ({ id: item.key, title: item.title, severity: item.severity, recommendation: item.recommendation, affectedCount: item.affectedPages })) : groupRecommendations(scopeFindings(scope, data?.issues || [])).slice(0, 12), [complete, data?.issues, scope]);
  const presentation = useMemo(() => complete || samplePresentation(data?.pages || [], scopeFindings(scope, data?.issues || [])), [complete, data?.pages, data?.issues, scope]);
  if (error) return <main id="main-content" className="section-shell py-16"><Notice tone="danger" title="Shared report unavailable">{error}</Notice></main>;
  if (!data) return <main id="main-content" className="section-shell flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-accent" /><span className="ml-3 text-sm font-semibold">Loading shared report...</span></main>;
  const scores = extractReportScores(scopeScoreMetadata(scope, data.report.scores));
  const categories = reportCategoryScores(scope, data.report.scores);
  const firstPage = data.pages.find((page) => page.title || page.metaDescription) || data.pages[0];
  return <main id="main-content" className="audit-customer-workspace section-shell space-y-6 py-8 md:py-12 print:max-w-none print:px-0">
    <header className="flex flex-col gap-5 border-b border-border pb-6 md:flex-row md:items-end md:justify-between"><div><div className="flex flex-wrap items-center gap-2"><StatusBadge tone="success">Read-only report</StatusBadge><StatusBadge tone="neutral">{scope ? `${auditFocusLabel(scope)} · ${scope.coverage} coverage` : `${data.audit.effectiveMode} audit`}</StatusBadge></div><h1 className="mt-4 text-3xl font-semibold md:text-4xl">{data.audit.hostname}</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">Completed {data.audit.completedAt ? new Date(data.audit.completedAt).toLocaleString() : 'recently'} - Link expires {new Date(data.expiresAt).toLocaleString()}</p></div><button type="button" className="quiet-button print:hidden" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print report</button></header>
    <StickyReportNavigation items={[{ id: 'shared-summary', label: 'Summary' }, { id: 'shared-findings', label: 'Top fixes', count: recommendations.length }, { id: 'shared-delivery', label: 'Delivery' }, ...(firstPage && !isFocusedAudit({ scope }) ? [{ id: 'shared-preview', label: 'Site preview' }] : [])]} />
    <section id="shared-summary" className="scroll-mt-32">
      <div className="audit-compact-summary grid gap-6 border-b border-border sm:grid-cols-2 xl:grid-cols-3">
        <div className="py-5"><AuditGrade score={scores.overall} label={scope ? auditScopeScoreLabel(scope) : undefined} detail="Final stored score" compact /><dl className="mt-5 flex flex-wrap gap-5">{[['Pages checked', data.audit.pagesCrawled], ['Findings', data.audit.issuesFound]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd></div>)}</dl></div>
        <section className="py-5"><h2 className="mb-4 text-sm font-semibold">Finding priority</h2><SeverityDistribution critical={data.audit.criticalCount} high={data.audit.highCount} medium={data.audit.mediumCount} low={data.audit.lowCount} /></section>
        <section className="py-5"><h2 className="text-lg font-semibold">Executive summary</h2><p className="mt-3 text-sm leading-7 text-muted-foreground">{data.report.summary}</p><div className="mt-5 flex items-center gap-2 text-xs text-muted-foreground"><CalendarClock className="h-4 w-4 shrink-0" />Generated {new Date(data.report.generatedAt).toLocaleString()}</div></section>
      </div>
      <AuditScoreFactors categoryScores={categories} />
    </section>
    <section id="shared-findings" className="scroll-mt-32"><h2 className="text-xl font-semibold">Top fixes first</h2><p className="mt-1 text-sm text-muted-foreground">{complete ? `Complete stored aggregates across ${complete.attemptedPages.toLocaleString()} attempted pages.` : `Sample only: recommendations use ${data.issues.length} loaded findings, not complete audit aggregates.`}</p><div className="mt-4 divide-y divide-border border-y border-border">{recommendations.length ? recommendations.map((item, index) => <article key={item.id} className="grid gap-3 py-5 md:grid-cols-[minmax(0,1fr)_180px]"><div><div className="flex flex-wrap items-center gap-2"><span className="mr-1 text-sm tabular-nums text-accent">{index + 1}</span><StatusBadge tone={item.severity === 'critical' ? 'danger' : item.severity === 'high' ? 'warning' : 'neutral'}>{item.severity}</StatusBadge><h3 className="font-semibold">{item.title}</h3></div><p className="mt-2 text-sm leading-6 text-muted-foreground">{item.recommendation}</p></div><div className="text-sm md:text-right"><strong>{item.affectedCount}</strong><span className="ml-1 text-muted-foreground">affected {item.affectedCount === 1 ? 'page' : 'pages'}</span></div></article>) : <div className="py-8 text-sm text-muted-foreground">No prioritized findings were included in {complete ? 'the stored aggregate' : 'this sample'}.</div>}</div></section>
    <div id="shared-delivery" className="scroll-mt-32"><AuditDeliveryCharts presentation={presentation} scope={scope} complete={Boolean(complete)} /></div>
    {firstPage && !isFocusedAudit({ scope }) ? <div id="shared-preview" className="scroll-mt-32"><SitePreviewSection url={firstPage.url || data.audit.normalizedUrl} hostname={data.audit.hostname} title={firstPage.title} description={firstPage.metaDescription} h1={firstPage.h1} canonicalUrl={firstPage.canonicalUrl} siteName={firstPage.siteName} faviconUrl={firstPage.faviconUrl} openGraphImage={firstPage.openGraphImage} screenshotUrl={firstPage.screenshotUrl} themeColor={firstPage.themeColor} /></div> : null}
  </main>;
}
