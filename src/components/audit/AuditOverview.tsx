import { lazy, memo, Suspense, useMemo, useState } from 'react';
import './audit-report.css';
import type { ResourceAuditLiveData } from '../../lib/audit/resource-types';
import { REPORT_SECTIONS, formatBytes } from '../../lib/audit/report-insights';
import { MetricBarChart, SitePreviewSection, StatusBadge } from '../ui/visual-system';
import { AuditPageMap } from './AuditPageMap';
import { completePresentationSummary, samplePresentation } from './audit-presentation';
import { isTerminalAuditStatus } from '../../lib/audit/audit-time';
import DomainStrengthCard from '../backlinks/DomainStrengthCard';
import { isFocusedAudit, scopeIncludesGroup } from '../../lib/audit/audit-scope';
import { scopeFindings, scopeIncludesReportSection } from '../../lib/report/scope-presentation';
const AuditToolsWorkspace = lazy(() => import('../tools/AuditToolsWorkspace'));

export const AuditOverview = memo(function AuditOverview({ data, onViewFindings }: { data: ResourceAuditLiveData; onViewFindings: () => void }) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [strengthOpen, setStrengthOpen] = useState(false);
  const complete = useMemo(() => completePresentationSummary(data.audit, data.finalReport), [data.audit, data.finalReport]);
  const issues = useMemo(() => scopeFindings(data.audit?.scope, data.latestIssues), [data.audit?.scope, data.latestIssues]);
  const sample = useMemo(() => complete ? null : samplePresentation(data.latestPages, issues), [complete, data.latestPages, issues]);
  const presentation = complete || sample!;
  const responseItems = useMemo(() => [
    { label: '2xx success', value: presentation.responseOutcomes.success, color: 'bg-[var(--success)]' },
    { label: '3xx redirect', value: presentation.responseOutcomes.redirect, color: 'bg-accent' },
    { label: '4xx client error', value: presentation.responseOutcomes.clientError, color: 'bg-[var(--warning)]' },
    { label: '5xx server error', value: presentation.responseOutcomes.serverError, color: 'bg-[var(--danger)]' },
    { label: 'Unavailable', value: presentation.responseOutcomes.unavailable, color: 'bg-muted-foreground' },
  ], [presentation]);
  const depthItems = useMemo(() => Object.entries(presentation.depthCounts).sort(([a], [b]) => Number(a) - Number(b)).map(([depth, count]) => ({ label: `Depth ${depth}`, value: count, color: 'bg-accent' })), [presentation]);
  const sectionItems = useMemo(() => REPORT_SECTIONS.filter(section => scopeIncludesReportSection(data.audit?.scope, section.id)).map(section => ({ label: section.label, value: presentation.findingsBySection[section.id] || 0, color: 'bg-[var(--warning)]' })).filter(item => item.value > 0), [presentation, data.audit?.scope]);
  const firstPage = useMemo(() => data.latestPages.find(page => page.title || page.metaDescription) || data.latestPages[0], [data.latestPages]);
  const recommendationsPending = Boolean(data.audit && !isTerminalAuditStatus(data.audit.status) && data.audit.issuesFound > 0 && !presentation.topRecommendations.length);
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground" data-presentation-scope={complete ? 'complete' : 'sample'}>
      <span>{complete ? `${complete.analysedPages.toLocaleString()} analysed / ${complete.attemptedPages.toLocaleString()} attempted pages` : `Loaded sample: ${data.latestPages.length} pages and ${data.latestIssues.length} findings, not full audit totals.`}</span>
      {complete && <span>Updated {new Date(complete.updatedAt).toLocaleString()}</span>}
    </div>
    <AuditPageMap pages={data.latestPages} issues={issues} audit={data.audit || undefined} />
    <details className="border-y border-border py-3" onToggle={event => setDetailsOpen(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-semibold">Delivery and crawl details</summary>{detailsOpen && <div className="audit-overview-charts mt-4">
      <section className="min-w-0"><h2 className="text-sm font-semibold">Response outcomes</h2><div className="mt-3"><MetricBarChart items={responseItems} title="" description="" framed={false} /></div></section>
      {scopeIncludesGroup(data.audit?.scope, 'performance') && <section className="min-w-0"><h2 className="text-sm font-semibold">Observed delivery</h2><dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5">
        {[[presentation.delivery.averageResponseMs == null ? 'Not measured' : `${Math.round(presentation.delivery.averageResponseMs)} ms`, 'Average response'], [formatBytes(presentation.delivery.averagePageBytes), 'Average page size'], [presentation.pagesWithFindings.toLocaleString(), 'Pages with findings'], [presentation.attemptedPages.toLocaleString(), 'Attempted pages']].map(([value, label]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd></div>)}
      </dl><p className="mt-4 text-xs text-muted-foreground">HTML response observations, not browser-measured Core Web Vitals.</p></section>}
      <section className="min-w-0"><h2 className="text-sm font-semibold">Crawl depth</h2><div className="mt-3 max-h-52 overflow-y-auto"><MetricBarChart items={depthItems} title="" description="" framed={false} /></div></section>
      <section className="min-w-0"><h2 className="text-sm font-semibold">Findings by section</h2><div className="mt-3 max-h-52 overflow-y-auto">{sectionItems.length ? <MetricBarChart items={sectionItems} title="" description="" framed={false} /> : <p className="text-xs text-muted-foreground">No findings in {complete ? 'stored aggregates' : 'this sample'}.</p>}</div></section>
    </div>}</details>
    <section aria-labelledby="overview-priorities"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="overview-priorities" className="text-base font-semibold">What to fix first</h2><button type="button" className="quiet-button min-h-9 px-3 py-1 text-xs" onClick={onViewFindings}>View findings</button></div>
      <div className="mt-3 divide-y divide-border">{presentation.topRecommendations.slice(0, 4).map((item, index) => <article key={item.key} className="grid gap-2 py-3 sm:grid-cols-[24px_minmax(0,1fr)_auto]"><span className="text-sm tabular-nums text-muted-foreground">{index + 1}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{item.title}</h3><StatusBadge tone={item.severity === 'critical' ? 'danger' : item.severity === 'high' || item.severity === 'medium' ? 'warning' : 'neutral'}>{item.severity}</StatusBadge></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.recommendation}</p></div><span className="text-xs text-muted-foreground">{item.affectedPages.toLocaleString()} affected pages</span></article>)}</div>
      {!presentation.topRecommendations.length && <p className="py-4 text-sm text-muted-foreground">{recommendationsPending ? 'Recommendations are prepared at finalization. View Findings to review the evidence collected so far.' : data.audit?.issuesFound ? `No recommendations are included in ${complete ? 'this stored aggregate' : 'the loaded sample'}. View Findings to review the recorded evidence.` : `No recommendations in ${complete ? 'the stored aggregate' : 'this sample'}. Review coverage and unavailable checks before treating the audit as clear.`}</p>}
    </section>
    {firstPage && !isFocusedAudit(data.audit) && <details className="border-y border-border py-3" onToggle={event => setPreviewOpen(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-semibold">Collected site preview</summary>{previewOpen && <div className="pt-4"><SitePreviewSection url={firstPage.url} hostname={data.audit?.hostname} title={firstPage.title} description={firstPage.metaDescription} h1={firstPage.h1} canonicalUrl={firstPage.canonicalUrl} siteName={firstPage.siteName} faviconUrl={firstPage.faviconUrl} openGraphImage={firstPage.openGraphImage} screenshotUrl={firstPage.screenshotUrl} themeColor={firstPage.themeColor} /></div>}</details>}
    {!isFocusedAudit(data.audit) && <details className="border-y border-border py-4 no-print" onToggle={event => setToolsOpen(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-semibold">Audit tools: previews, robots, sitemap, crawl analysis and print</summary>{toolsOpen && <div className="pt-5"><Suspense fallback={<p className="text-sm">Loading audit tools...</p>}><AuditToolsWorkspace key={data.audit?.id} data={data} /></Suspense></div>}</details>}
    {data.finalReport && data.audit && !isFocusedAudit(data.audit) && data.audit.scope?.coverage !== 'page' && <details className="border-y border-border py-3" onToggle={event => setStrengthOpen(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-semibold">Domain strength and external signals</summary>{strengthOpen && <div className="pt-4"><DomainStrengthCard domain={data.audit.hostname} auditScores={data.finalReport.scores} /></div>}</details>}
  </div>;
});
