import { useMemo } from 'react';
import type { AuditScope } from '../../lib/audit/audit-scope';
import { scopeIncludesGroup } from '../../lib/audit/audit-scope';
import { scopeIncludesReportSection } from '../../lib/report/scope-presentation';
import { REPORT_SECTIONS, formatBytes } from '../../lib/audit/report-insights';
import { MetricBarChart } from '../ui/visual-system';
import type { samplePresentation } from './audit-presentation';
import { CATEGORY_TONES } from '../ui/category-presentation';
import './audit-report.css';

export function AuditDeliveryCharts({ presentation, scope, complete }: { presentation: ReturnType<typeof samplePresentation>; scope?: AuditScope | null; complete: boolean }) {
  const responses = useMemo(() => [
    { label: '2xx success', value: presentation.responseOutcomes.success, color: 'bg-[var(--success)]' },
    { label: '3xx redirect', value: presentation.responseOutcomes.redirect, color: 'bg-accent' },
    { label: '4xx client error', value: presentation.responseOutcomes.clientError, color: 'bg-[var(--warning)]' },
    { label: '5xx server error', value: presentation.responseOutcomes.serverError, color: 'bg-[var(--danger)]' },
    { label: 'Unavailable', value: presentation.responseOutcomes.unavailable, color: 'bg-muted-foreground' },
  ], [presentation]);
  const depths = useMemo(() => Object.entries(presentation.depthCounts).sort(([a], [b]) => Number(a) - Number(b)).map(([depth, value]) => ({ label: `Depth ${depth}`, value, color: 'bg-[var(--category-cyan)]' })), [presentation]);
  const findings = useMemo(() => REPORT_SECTIONS.filter(section => scopeIncludesReportSection(scope, section.id)).map(section => {
    const group = section.id === 'on-page' ? 'seo' : section.id === 'internal-links' ? 'links' : section.id === 'mobile' ? 'performance' : section.id;
    const colors = { cobalt: 'bg-[var(--category-cobalt)]', teal: 'bg-[var(--category-teal)]', cyan: 'bg-[var(--category-cyan)]', violet: 'bg-[var(--category-violet)]' };
    return { label: section.label, value: presentation.findingsBySection[section.id] || 0, color: colors[CATEGORY_TONES[group]] };
  }).filter(item => item.value > 0), [presentation, scope]);
  return <section aria-labelledby="audit-delivery-heading" className="border-y border-border py-5">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-2"><h2 id="audit-delivery-heading" className="text-lg font-semibold">Delivery and crawl evidence</h2><span className="text-xs text-muted-foreground">{complete ? 'Complete stored aggregates' : 'Loaded sample only'}</span></div>
    <div className="audit-overview-charts">
      <section className="min-w-0"><h3 className="mb-4 text-sm font-semibold">Response outcomes</h3><MetricBarChart items={responses} title="" description="" framed={false} /></section>
      <section className="min-w-0"><h3 className="mb-4 text-sm font-semibold">Findings by section</h3>{findings.length ? <MetricBarChart items={findings} title="" description="" framed={false} /> : <p className="text-sm text-muted-foreground">No findings in {complete ? 'stored aggregates' : 'this sample'}.</p>}</section>
      {scopeIncludesGroup(scope, 'performance') && <section className="min-w-0"><h3 className="mb-4 text-sm font-semibold">Observed delivery</h3><dl className="grid grid-cols-2 gap-x-4 gap-y-5">
        {[[presentation.delivery.averageResponseMs == null ? 'Not measured' : `${Math.round(presentation.delivery.averageResponseMs)} ms`, 'Average response'], [formatBytes(presentation.delivery.averagePageBytes), 'Average HTML size'], [presentation.pagesWithFindings.toLocaleString(), 'Pages with findings'], [presentation.attemptedPages.toLocaleString(), 'Attempted pages']].map(([value, label]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd></div>)}
      </dl><p className="mt-4 text-xs leading-5 text-muted-foreground">HTML response observations, not browser-measured Core Web Vitals.</p></section>}
      <section className="min-w-0"><h3 className="mb-4 text-sm font-semibold">Crawl depth</h3><div className="max-h-64 overflow-y-auto"><MetricBarChart items={depths} title="" description="" framed={false} /></div></section>
    </div>
  </section>;
}
