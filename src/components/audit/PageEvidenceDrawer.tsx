import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { ResourceAuditIssue, ResourceAuditPage } from '../../lib/audit/resource-types';
import { formatBytes } from '../../lib/audit/report-insights';
import { customerSafeDiagnosticText } from '../../lib/audit/audit-failures';
import { scopeIncludesGroup, type AuditScope } from '../../lib/audit/audit-scope';
import { isOperationalFinding, scopeFindings } from '../../lib/report/scope-presentation';
const ToolsPage = lazy(() => import('../tools/ToolsPage'));

function hasDeliveryMeasurement(page: ResourceAuditPage) {
  return page.fetchStatus === 'success' || (!page.fetchStatus && page.statusCode >= 200 && page.statusCode < 400);
}

function pageBytes(page: ResourceAuditPage) {
  return hasDeliveryMeasurement(page) && Number.isFinite(page.pageSizeBytes) && page.pageSizeBytes >= 0 ? formatBytes(page.pageSizeBytes) : 'Not measured';
}

function responseTime(page: ResourceAuditPage) {
  return hasDeliveryMeasurement(page) && Number.isFinite(page.responseTimeMs) && page.responseTimeMs >= 0 ? `${page.responseTimeMs} ms` : 'Not measured';
}

export function PageEvidenceDrawer({ page, issues = [], onClose, scope }: { page: ResourceAuditPage | null; issues?: ResourceAuditIssue[]; onClose: () => void; scope?: AuditScope | null }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pageIssues = useMemo(() => page ? scopeFindings(scope, issues).filter(issue => issue.affectedUrl === page.url) : [], [page, issues, scope]);
  useEffect(() => {
    if (!page) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab' && dialogRef.current) {
        const controls = [...dialogRef.current.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary, [tabindex="0"]')].filter(element => element.getClientRects().length && !element.hasAttribute('disabled'));
        const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', onKeyDown); previous?.focus(); };
  }, [page?.id, onClose]);
  if (!page) return null;
  const metrics = [['HTTP response', page.statusCode || 'Unavailable'], ['Findings', page.issueCount], ['Crawl depth', page.crawlDepth],
    ...(scopeIncludesGroup(scope, 'performance') ? [['Response time', responseTime(page)], ['Page size', pageBytes(page)]] : []),
    ...(scopeIncludesGroup(scope, 'seo') ? [['Words', hasDeliveryMeasurement(page) ? page.wordCount : 'Not measured']] : [])];
  const fields = [...(scopeIncludesGroup(scope, 'seo') ? [['Description', page.metaDescription], ['H1', page.h1]] : []),
    ...(scopeIncludesGroup(scope, 'crawlability') ? [['Preferred URL', page.canonicalUrl]] : []), ['Discovered from', page.sourceUrl],
    ...(scopeIncludesGroup(scope, 'links') ? [['Link anchor', page.anchorText]] : [])];
  return createPortal(<div className="fixed inset-0 z-[90] flex justify-end bg-black/65" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <aside ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="page-evidence-title" className="flex h-full w-full max-w-xl flex-col border-l border-border bg-card shadow-xl">
      <header className="flex items-start justify-between gap-3 border-b border-border p-5"><div className="min-w-0"><p className="text-xs text-muted-foreground">Stored page evidence</p><h2 id="page-evidence-title" className="mt-1 break-words text-lg font-semibold">{scopeIncludesGroup(scope, 'seo') ? page.title || 'Untitled page' : 'Page evidence'}</h2><p className="mt-2 break-all text-xs text-muted-foreground">{page.url}</p></div><button ref={closeRef} type="button" className="quiet-button min-h-10 min-w-10 p-2" onClick={onClose} aria-label="Close page evidence" title="Close page evidence"><X className="h-5 w-5" /></button></header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5">{metrics.map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd></div>)}</dl>
        {page.safeExplanation && <p className="border-y border-border py-3 text-sm">{customerSafeDiagnosticText(page.safeExplanation)}</p>}
        {page.suggestedAction && <p className="text-sm text-muted-foreground">{customerSafeDiagnosticText(page.suggestedAction)}</p>}
        <dl className="space-y-4 border-t border-border pt-4">{fields.map(([label, value]) => <div key={label}><dt className="text-xs font-semibold text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm">{value || 'Not stored'}</dd></div>)}</dl>
        {(!scope || scope.focus === 'full') && <details className="border-t border-border pt-4" onToggle={event => setPreviewOpen(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-semibold">Preview metadata and local SEO tools for this page</summary>{previewOpen && <div className="pt-4"><Suspense fallback={<p className="text-sm">Loading local tools...</p>}><ToolsPage initialPage={page} embedded /></Suspense></div>}</details>}
        <section className="border-t border-border pt-4"><h3 className="text-sm font-semibold">Findings in loaded evidence</h3><p className="mt-1 text-xs text-muted-foreground">{pageIssues.length} loaded of {page.issueCount} recorded for this page. Use Findings to browse all stored evidence.</p><ul className="mt-3 divide-y divide-border">{pageIssues.map(issue => <li key={issue.id} className="py-3"><p className="text-sm font-semibold">{issue.title}</p><p className="mt-1 text-xs text-muted-foreground">{issue.evidence || issue.description}</p><p className="mt-2 text-sm">{issue.recommendation}</p></li>)}</ul></section>
        {scope && pageIssues.some(isOperationalFinding) && <p className="text-xs text-muted-foreground">Retrieval failures describe access to this page, not results from unselected checks.</p>}
        <p className="text-xs text-muted-foreground">Collected {new Date(page.crawledAt).toLocaleString()}.{scopeIncludesGroup(scope, 'performance') && ' Response observations are not browser-measured Core Web Vitals.'}</p>
      </div>
    </aside>
  </div>, document.body);
}

export const AuditPagesTable = memo(function AuditPagesTable({ pages, onSelect, scope }: { pages: ResourceAuditPage[]; onSelect: (page: ResourceAuditPage) => void; scope?: AuditScope | null }) {
  const performance = scopeIncludesGroup(scope, 'performance');
  return <div className="overflow-x-auto" role="region" aria-label="Stored page evidence" tabIndex={0}><table className="suite-table w-full min-w-[640px]"><caption className="sr-only">Stored pages; select a page to inspect its evidence</caption><thead><tr><th>Page</th><th>Status</th>{performance && <><th>Response</th><th>Size</th></>}<th>Findings</th></tr></thead><tbody>{pages.map(page => <tr key={page.id}><td className="max-w-md"><button type="button" onClick={() => onSelect(page)} className="block w-full min-w-0 text-left hover:text-accent"><span className="block truncate font-semibold">{scopeIncludesGroup(scope, 'seo') ? page.title || 'Untitled page' : page.url}</span>{scopeIncludesGroup(scope, 'seo') && <span className="mt-1 block truncate text-xs text-muted-foreground">{page.url}</span>}</button></td><td>{page.statusCode || 'Unavailable'}</td>{performance && <><td>{responseTime(page)}</td><td>{pageBytes(page)}</td></>}<td>{page.issueCount}</td></tr>)}{!pages.length && <tr><td colSpan={performance ? 5 : 3} className="py-8 text-center text-muted-foreground">No stored page evidence yet.</td></tr>}</tbody></table></div>;
});
