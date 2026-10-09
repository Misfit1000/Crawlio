import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import './audit-report.css';
import type { ResourceAuditLiveData } from '../../lib/audit/resource-types';
import { SitePreviewSection, StatusBadge } from '../ui/visual-system';
import { AuditPageMap } from './AuditPageMap';
import { completePresentationSummary, samplePresentation } from './audit-presentation';
import { isTerminalAuditStatus } from '../../lib/audit/audit-time';
import { Link } from '../../app/router';
import { isFocusedAudit } from '../../lib/audit/audit-scope';
import { scopeFindings } from '../../lib/report/scope-presentation';
import { AuditDeliveryCharts } from './AuditDeliveryCharts';
const AuditToolsWorkspace = lazy(() => import('../tools/AuditToolsWorkspace'));
const DomainStrengthCard = lazy(() => import('../backlinks/DomainStrengthCard'));

function VisibleDomainStrength({ domain, auditScores }: { domain: string; auditScores: Record<string, unknown> }) {
  const container = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!('IntersectionObserver' in window)) { setReady(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setReady(true); observer.disconnect(); }
    }, { rootMargin: '300px' });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  return <section ref={container} aria-label="Domain strength and external signals" style={{ minHeight: 240 }}>
    {ready ? <Suspense fallback={<p className="text-sm text-muted-foreground">Loading domain evidence...</p>}><DomainStrengthCard domain={domain} auditScores={auditScores} /></Suspense> : <h2 className="text-lg font-semibold">Domain strength and external signals</h2>}
  </section>;
}

export const AuditOverview = memo(function AuditOverview({ data, onViewFindings }: { data: ResourceAuditLiveData; onViewFindings: () => void }) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const complete = useMemo(() => completePresentationSummary(data.audit, data.finalReport), [data.audit, data.finalReport]);
  const issues = useMemo(() => scopeFindings(data.audit?.scope, data.latestIssues), [data.audit?.scope, data.latestIssues]);
  const sample = useMemo(() => complete ? null : samplePresentation(data.latestPages, issues), [complete, data.latestPages, issues]);
  const presentation = complete || sample!;
  const firstPage = useMemo(() => data.latestPages.find(page => page.title || page.metaDescription) || data.latestPages[0], [data.latestPages]);
  const recommendationsPending = Boolean(data.audit && !isTerminalAuditStatus(data.audit.status) && data.audit.issuesFound > 0 && !presentation.topRecommendations.length);
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground" data-presentation-scope={complete ? 'complete' : 'sample'}>
      <span>{complete ? `${complete.analysedPages.toLocaleString()} analysed / ${complete.attemptedPages.toLocaleString()} attempted pages` : `Loaded sample: ${data.latestPages.length} pages and ${data.latestIssues.length} findings, not full audit totals.`}</span>
      {complete && <span>Updated {new Date(complete.updatedAt).toLocaleString()}</span>}
    </div>
    {data.finalReport?.summary && <section className="max-w-5xl"><h2 className="text-lg font-semibold">Executive summary</h2><p className="mt-2 text-sm leading-7 text-muted-foreground">{data.finalReport.summary}</p></section>}
    <section aria-labelledby="overview-priorities"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="overview-priorities" className="text-base font-semibold">What to fix first</h2><button type="button" className="quiet-button min-h-9 px-3 py-1 text-xs" onClick={onViewFindings}>View findings</button></div>
      <div className="mt-3 divide-y divide-border border-y border-border">{presentation.topRecommendations.slice(0, 4).map((item, index) => <article key={item.key} className="grid gap-3 py-4 sm:grid-cols-[24px_minmax(0,1fr)_auto]"><span className="text-sm tabular-nums text-accent">{index + 1}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-semibold">{item.title}</h3><StatusBadge tone={item.severity === 'critical' ? 'danger' : item.severity === 'high' || item.severity === 'medium' ? 'warning' : 'neutral'}>{item.severity}</StatusBadge></div><p className="mt-2 text-sm leading-6 text-muted-foreground">{item.recommendation}</p></div><span className="text-xs text-muted-foreground">{item.affectedPages.toLocaleString()} affected pages</span></article>)}</div>
      {!presentation.topRecommendations.length && <p className="py-4 text-sm text-muted-foreground">{recommendationsPending ? 'Recommendations are prepared at finalization. View Findings to review the evidence collected so far.' : data.audit?.issuesFound ? `No recommendations are included in ${complete ? 'this stored aggregate' : 'the loaded sample'}. View Findings to review the recorded evidence.` : `No recommendations in ${complete ? 'the stored aggregate' : 'this sample'}. Review coverage and unavailable checks before treating the audit as clear.`}</p>}
    </section>
    <AuditDeliveryCharts presentation={presentation} scope={data.audit?.scope} complete={Boolean(complete)} />
    {firstPage && !isFocusedAudit(data.audit) && <SitePreviewSection url={firstPage.url} hostname={data.audit?.hostname} title={firstPage.title} description={firstPage.metaDescription} h1={firstPage.h1} canonicalUrl={firstPage.canonicalUrl} siteName={firstPage.siteName} faviconUrl={firstPage.faviconUrl} openGraphImage={firstPage.openGraphImage} screenshotUrl={firstPage.screenshotUrl} themeColor={firstPage.themeColor} />}
    <AuditPageMap pages={data.latestPages} issues={issues} audit={data.audit || undefined} />
    {!isFocusedAudit(data.audit) && <section className="border-y border-border py-5 no-print"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Audit tools</h2><Link to="/app/tools" className="quiet-button min-h-9 text-xs">Open Tools workspace</Link></div><p className="mt-2 text-sm text-muted-foreground">Metadata previews, robots rules, response headers, sitemap checks, and crawl analysis.</p><details className="mt-4" onToggle={event => setToolsOpen(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-semibold">Advanced utilities for this audit</summary>{toolsOpen && <div className="pt-5"><Suspense fallback={<p className="text-sm">Loading audit tools...</p>}><AuditToolsWorkspace key={data.audit?.id} data={data} /></Suspense></div>}</details></section>}
    {data.finalReport && data.audit && !isFocusedAudit(data.audit) && data.audit.scope?.coverage !== 'page' && <VisibleDomainStrength key={data.audit.id} domain={data.audit.hostname} auditScores={data.finalReport.scores} />}
  </div>;
});
