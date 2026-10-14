import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Loader2, Printer } from 'lucide-react';
import { API_ROUTES } from '../../lib/api/routes';
import { extractReportScores, groupRecommendations } from '../../lib/audit/report-insights';
import type { ResourceAuditIssue, ResourceAuditPage, ResourceAuditReport } from '../../lib/audit/resource-types';
import { safeJsonFetch } from '../../lib/http/safe-json';
import { AuditGrade, RadialScoreGauge, SitePreviewSection, StatusBadge, StickyReportNavigation } from '../ui/visual-system';
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
  return <main id="main-content" className="audit-customer-workspace audit-spacious space-y-8 section-shell py-8 md:py-12 print:max-w-none print:px-0">
    <header className="audit-workspace-header flex flex-col items-start justify-between gap-6 lg:flex-row"><div className="min-w-0"><h1 className="audit-workspace-title break-words font-bold leading-tight">{data.audit.hostname}</h1><div className="mt-3 flex flex-wrap items-center gap-3"><p className="text-sm text-muted-foreground">{scope ? `${auditFocusLabel(scope)} / ${scope.coverage === 'page' ? 'This page' : 'Website'}` : `${data.audit.effectiveMode} audit`}</p><StatusBadge tone="neutral">Read-only report</StatusBadge></div><p className="mt-3 max-w-3xl text-xs text-muted-foreground">Completed {data.audit.completedAt ? new Date(data.audit.completedAt).toLocaleString() : 'recently'} / Link expires {new Date(data.expiresAt).toLocaleString()}</p></div><button type="button" className="quiet-button print:hidden" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print report</button></header>
    <section id="shared-summary" className="scroll-mt-32">
      <div className="audit-executive-grid grid items-center gap-8 py-8 sm:grid-cols-2 xl:grid-cols-4">
        <div className="audit-executive-score flex flex-col items-center text-center">{scores.overall == null ? <AuditGrade score={null} label={scope ? auditScopeScoreLabel(scope) : 'Audit score'} detail="No final score stored" compact /> : <RadialScoreGauge value={scores.overall} label={scope ? auditScopeScoreLabel(scope) : 'Audit score'} size="lg" />}<p className="mt-3 text-xs text-muted-foreground">Final stored result</p></div>
        <div className="audit-executive-coverage min-w-0"><h2 className="text-base font-semibold">Measured results</h2><p className="audit-large-number mt-5 text-4xl font-bold tabular-nums">{data.audit.pagesCrawled.toLocaleString()}</p><p className="mt-2 text-sm text-muted-foreground">pages analysed</p><p className="mt-4 text-xs text-muted-foreground">{categories.length} scored categories</p></div>
        <div className="audit-executive-priorities min-w-0"><h2 className="text-base font-semibold">Finding priority</h2><dl className="audit-priority-counts mt-7 grid grid-cols-4 gap-3">{[['Critical', data.audit.criticalCount, 'var(--danger)'], ['High', data.audit.highCount, 'var(--warning)'], ['Medium', data.audit.mediumCount, 'var(--category-cyan,var(--accent))'], ['Low', data.audit.lowCount, 'var(--action,var(--accent))']].map(([label, value, color]) => <div key={label}><dt className="text-xs text-muted-foreground"><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: String(color) }} aria-hidden="true" />{label}</dt><dd className="mt-3 text-2xl font-semibold tabular-nums">{Number(value).toLocaleString()}</dd></div>)}</dl></div>
        <div className="audit-executive-total min-w-0"><p className="audit-large-number mt-5 text-4xl font-bold tabular-nums">{data.audit.issuesFound.toLocaleString()}</p><p className="mt-2 text-sm text-muted-foreground">total findings</p><a href="#shared-findings" className="trust-button mt-5">View fixes</a></div>
      </div>
      <div className="audit-summary-footnote flex flex-wrap justify-between gap-x-6 gap-y-2 border-t border-border pt-4 text-xs leading-6 text-muted-foreground"><span className="inline-flex items-center gap-2"><CalendarClock className="h-4 w-4" />Generated {new Date(data.report.generatedAt).toLocaleString()}</span><span>Read-only evidence. No audit is rerun when viewing this report.</span></div>
      {data.report.summary && <p className="mt-6 max-w-5xl text-base leading-7 text-muted-foreground">{data.report.summary}</p>}
    </section>
    <StickyReportNavigation items={[{ id: 'shared-summary', label: 'Overview' }, { id: 'shared-findings', label: 'Top fixes', count: recommendations.length }, { id: 'shared-delivery', label: 'Delivery' }, ...(firstPage && !isFocusedAudit({ scope }) ? [{ id: 'shared-preview', label: 'Site preview' }] : [])]} />
    <AuditScoreFactors categoryScores={categories} />
    <section id="shared-findings" className="scroll-mt-32"><h2 className="text-xl font-semibold">Top fixes first</h2><p className="mt-1 text-sm text-muted-foreground">{complete ? `Complete stored aggregates across ${complete.attemptedPages.toLocaleString()} attempted pages.` : `Sample only: recommendations use ${data.issues.length} loaded findings, not complete audit aggregates.`}</p><div className="mt-4 divide-y divide-border border-y border-border">{recommendations.length ? recommendations.map((item, index) => <article key={item.id} className="grid gap-3 py-5 md:grid-cols-[minmax(0,1fr)_180px]"><div><div className="flex flex-wrap items-center gap-2"><span className="mr-1 text-sm tabular-nums text-accent">{index + 1}</span><StatusBadge tone={item.severity === 'critical' ? 'danger' : item.severity === 'high' ? 'warning' : 'neutral'}>{item.severity}</StatusBadge><h3 className="font-semibold">{item.title}</h3></div><p className="mt-2 text-sm leading-6 text-muted-foreground">{item.recommendation}</p></div><div className="text-sm md:text-right"><strong>{item.affectedCount}</strong><span className="ml-1 text-muted-foreground">affected {item.affectedCount === 1 ? 'page' : 'pages'}</span></div></article>) : <div className="py-8 text-sm text-muted-foreground">No prioritized findings were included in {complete ? 'the stored aggregate' : 'this sample'}.</div>}</div></section>
    <div id="shared-delivery" className="scroll-mt-32"><AuditDeliveryCharts presentation={presentation} scope={scope} complete={Boolean(complete)} /></div>
    {firstPage && !isFocusedAudit({ scope }) ? <div id="shared-preview" className="scroll-mt-32"><SitePreviewSection url={firstPage.url || data.audit.normalizedUrl} hostname={data.audit.hostname} title={firstPage.title} description={firstPage.metaDescription} h1={firstPage.h1} canonicalUrl={firstPage.canonicalUrl} siteName={firstPage.siteName} faviconUrl={firstPage.faviconUrl} openGraphImage={firstPage.openGraphImage} screenshotUrl={firstPage.screenshotUrl} themeColor={firstPage.themeColor} /></div> : null}
  </main>;
}
