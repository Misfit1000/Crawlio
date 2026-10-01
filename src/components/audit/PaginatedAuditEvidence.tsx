import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getAuditAccessHeaders } from '../../lib/api/auth-headers';
import type { ResourceAuditIssue, ResourceAuditPage } from '../../lib/audit/resource-types';
import type { ReportSectionId } from '../../lib/audit/report-insights';
import { useUrlFilter } from '../../app/use-url-filter';
import FindingWorkspace, { type EvidenceFilters } from './FindingWorkspace';
import { AuditPagesTable, PageEvidenceDrawer } from './PageEvidenceDrawer';

type Props = Omit<React.ComponentProps<typeof FindingWorkspace>, 'issues' | 'evidenceFilters'> & {
  auditId: string;
  kind: 'pages' | 'issues';
  section?: ReportSectionId;
  pageIssues?: ResourceAuditIssue[];
};
type EvidencePage = { items: Array<ResourceAuditIssue | ResourceAuditPage>; nextCursor: string | null; total: number | null; requestKey: string };

export default React.memo(function PaginatedAuditEvidence(props: Props) {
  return <EvidenceSession key={`${props.auditId}:${props.kind}:${props.section || ''}`} {...props} />;
});

function EvidenceSession({ auditId, kind, section, pageIssues = [], ...workflow }: Props) {
  const [search, setSearch] = useUrlFilter('finding');
  const [severity, setSeverity] = useUrlFilter('priority', 'all');
  const [category, setCategory] = useUrlFilter('category', 'all');
  const [reportSection, setReportSection] = useUrlFilter('section', section || 'all');
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [page, setPage] = useState<EvidencePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<ResourceAuditPage | null>(null);
  const close = useCallback(() => setSelected(null), []);
  const cursor = cursors.at(-1);
  const filters = useMemo<EvidenceFilters>(() => ({
    query: search, severity, category, section: reportSection,
    onChange: (key, value) => {
      if (key === 'query') setSearch(value);
      if (key === 'severity') setSeverity(value);
      if (key === 'category') setCategory(value);
      if (key === 'section') setReportSection(value);
      setCursors([undefined]);
    },
  }), [search, severity, category, reportSection, setSearch, setSeverity, setCategory, setReportSection]);
  const filterKey = kind === 'issues' ? JSON.stringify([search.trim(), severity, category, reportSection]) : 'pages';
  // A restored URL must not reuse a cursor from a different filter.
  const [sessionFilter, setSessionFilter] = useState(filterKey);
  const activeCursor = sessionFilter === filterKey ? cursor : undefined;
  useEffect(() => { setSessionFilter(filterKey); setCursors([undefined]); }, [filterKey]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setPage(null); setSelected(null);
    const loadPage = async () => {
      try {
        const query = new URLSearchParams({ limit: '50' });
        if (activeCursor) query.set('cursor', activeCursor);
        if (kind === 'issues') {
          if (severity !== 'all') query.set('severity', severity);
          if (category !== 'all') query.set('category', category.trim());
          if (reportSection !== 'all') query.set('section', reportSection);
          if (search.trim()) query.set('query', search.trim());
        }
        const headers = await getAuditAccessHeaders();
        if (controller.signal.aborted) return;
        const response = await fetch(`/api/tools/audit/${encodeURIComponent(auditId)}/evidence/${kind}?${query}`, { headers, cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 404 ? 'Audit unavailable or access denied.' : 'Evidence could not be loaded.');
        const body = await response.json();
        if (!body.success || !Array.isArray(body.data?.items)) throw new Error('Invalid evidence response.');
        if (!controller.signal.aborted) setPage({ ...body.data, requestKey: query.toString() });
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Evidence could not be loaded.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    };
    const timer = window.setTimeout(() => { void loadPage(); }, kind === 'issues' ? 300 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [auditId, kind, activeCursor, severity, category, reportSection, search, retry]);

  return <section className="min-w-0 space-y-3" aria-label={`Paginated ${kind}`} aria-busy={loading}>
    {kind === 'issues' && <FindingWorkspace auditId={auditId} issues={page?.items as ResourceAuditIssue[] || []} {...workflow} evidenceFilters={filters} />}
    {kind === 'pages' && <><h2 className="text-lg font-semibold">Pages</h2><AuditPagesTable pages={page?.items as ResourceAuditPage[] || []} onSelect={setSelected} /><PageEvidenceDrawer page={selected} issues={pageIssues} onClose={close} /></>}
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <p role="status">{loading ? 'Loading stored evidence...' : error ? 'Evidence unavailable' : `Evidence page ${cursors.length}: ${page?.items.length || 0} records${page?.total != null ? ` of ${page.total} matching ${kind}` : ''}.`}{kind === 'issues' && ' Filters apply to all stored findings.'}</p>
      <nav className="flex flex-wrap gap-2" aria-label="Evidence pagination">
        <button type="button" className="quiet-button min-h-9 px-3 py-1 text-xs" disabled={loading} onClick={() => { setCursors([undefined]); setRetry(value => value + 1); }}>Refresh</button>
        <button type="button" className="quiet-button min-h-9 px-3 py-1 text-xs" disabled={loading || !!error || cursors.length === 1} onClick={() => setCursors(values => values.slice(0, -1))}>Previous</button>
        <button type="button" className="quiet-button min-h-9 px-3 py-1 text-xs" disabled={loading || !!error || !page?.nextCursor} onClick={() => { if (page?.nextCursor) setCursors(values => [...values, page.nextCursor!]); }}>Next</button>
      </nav>
    </div>
    {error && <div role="alert" className="text-sm text-[var(--danger)]">{error} <button type="button" className="quiet-button min-h-9 text-xs" onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
  </section>;
}
