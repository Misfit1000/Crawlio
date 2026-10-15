import { useMemo, useState, type ComponentProps } from 'react';
import { StatusBadge, type FindingRow } from '../ui/visual-system';
import { findingWorkflowResolutionDetail, findingWorkflowStatusLabel, type FindingWorkflowStatus } from '../../lib/audit/finding-workflow';
import type { FindingComparisonChange } from '../../lib/audit/report-insights';

const EVIDENCE_PAGE_SIZE = 10;

type Props = ComponentProps<typeof FindingRow> & {
  affectedCount?: number;
  workflowStatus?: FindingWorkflowStatus;
  comparisonChange?: FindingComparisonChange;
};

export function AuditFindingRow({ severity, category, title, description, whyItMatters, recommendation, evidence = [], affectedUrls = [], impactLabel, effortLabel, confidenceLabel, statusControl, affectedCount, workflowStatus, comparisonChange }: Props) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const urls = useMemo(() => [...new Set(affectedUrls.filter(Boolean))], [affectedUrls]);
  const samples = useMemo(() => [...new Set(evidence.filter(Boolean))], [evidence]);
  const pageCount = Math.max(1, Math.ceil(Math.max(urls.length, samples.length) / EVIDENCE_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const offset = (currentPage - 1) * EVIDENCE_PAGE_SIZE;
  const resolutionDetail = workflowStatus ? findingWorkflowResolutionDetail(workflowStatus) : null;
  return <article className="audit-report-finding min-w-0 border-b border-border py-6">
    <div className="audit-report-finding-heading flex flex-wrap items-center gap-3"><StatusBadge tone={severity === 'critical' ? 'danger' : severity === 'high' || severity === 'medium' ? 'warning' : 'neutral'}>{severity}</StatusBadge><h3 className="min-w-0 flex-1 break-words text-base font-semibold">{title}</h3><span className="text-xs text-muted-foreground">{category}</span></div>
    <div className="audit-report-finding-body mt-4">
      {description && <p className="text-sm leading-6 text-muted-foreground">{description}</p>}
      {recommendation && <p className="mt-3 text-sm leading-7"><span className="font-semibold text-accent">Next step: </span>{recommendation}</p>}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">{urls.length > 0 && <span>{urls.length} affected URL{urls.length === 1 ? '' : 's'}</span>}{Number.isSafeInteger(affectedCount) && affectedCount! > urls.length && <span>Reported reach: {affectedCount} pages; URL list is incomplete</span>}{[impactLabel, effortLabel, confidenceLabel].filter(Boolean).map(label => <span key={label}>{label}</span>)}{workflowStatus && <span className="capitalize">{findingWorkflowStatusLabel(workflowStatus)}</span>}{comparisonChange && <StatusBadge tone={comparisonChange === 'new' ? 'warning' : 'neutral'}>{comparisonChange === 'resolved' ? 'No longer detected in comparison' : `${comparisonChange} in comparison`}</StatusBadge>}</div>
      {samples.length > 0 && <p className="mt-3 break-words text-xs leading-5 text-muted-foreground"><span className="font-semibold">Representative evidence: </span>{samples[0].length > 320 ? `${samples[0].slice(0, 320)}...` : samples[0]}</p>}
      {resolutionDetail && <p className="mt-3 text-xs leading-5 text-muted-foreground">{resolutionDetail}</p>}
      {comparisonChange === 'resolved' && <p className="mt-2 text-xs text-muted-foreground">Not detected in the selected repeat audit. Review crawl coverage before treating this as verified resolution.</p>}
      {statusControl && <div className="mt-3">{statusControl}</div>}
      {(whyItMatters || samples.length > 0 || urls.length > 0) && <details className="mt-4" onToggle={event => setOpen(event.currentTarget.open)}><summary className="audit-evidence-toggle inline-flex min-h-11 cursor-pointer items-center py-2.5 text-sm font-semibold text-accent">Evidence and affected pages ({urls.length})</summary>{open && <div className="mt-4 space-y-4 border-t border-border pt-4">{whyItMatters && <div><h4 className="text-sm font-semibold">Why it matters</h4><p className="mt-2 text-sm leading-6 text-muted-foreground">{whyItMatters}</p></div>}<div className="grid min-w-0 gap-6 lg:grid-cols-2"><div className="min-w-0"><h4 className="text-xs font-semibold text-muted-foreground">Stored evidence</h4><ul className="mt-2 space-y-2 text-sm leading-6">{samples.slice(offset, offset + EVIDENCE_PAGE_SIZE).map(item => <li key={item} className="break-words">{item}</li>)}</ul></div><div className="min-w-0"><h4 className="text-xs font-semibold text-muted-foreground">Affected URLs</h4><ul className="mt-2 space-y-2 text-xs leading-5">{urls.slice(offset, offset + EVIDENCE_PAGE_SIZE).map(url => <li key={url} className="break-all">{url}</li>)}</ul></div></div>{pageCount > 1 && <nav className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground" aria-label={`Evidence pagination for ${title}`}><span>Evidence page {currentPage} of {pageCount}</span><button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="quiet-button min-h-9 px-3">Previous evidence</button><button type="button" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)} className="quiet-button min-h-9 px-3">Next evidence</button></nav>}</div>}</details>}
    </div>
  </article>;
}
