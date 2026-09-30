import React, { useEffect, useState } from 'react';
import { getAuditAccessHeaders } from '../../lib/api/auth-headers';
import type { ResourceAuditIssue, ResourceAuditPage } from '../../lib/audit/resource-types';
import { classifyReportSection } from '../../lib/audit/report-insights';
import FindingWorkspace from './FindingWorkspace';

type Props = Omit<React.ComponentProps<typeof FindingWorkspace>, 'issues'> & {
  auditId: string;
  kind: 'pages' | 'issues';
  section?: ReturnType<typeof classifyReportSection>;
};
type EvidencePage = { items: Array<ResourceAuditIssue | ResourceAuditPage>; nextCursor: string | null; total: number | null; batch: number; requestKey: string };

export default function PaginatedAuditEvidence(props: Props) {
  // Keyed sessions discard cursors, stale requests and filters when switching audits/views.
  return <EvidenceSession key={`${props.auditId}:${props.kind}:${props.section || ''}`} {...props} />;
}

function EvidenceSession({ auditId, kind, section, ...workflow }: Props) {
  const [severity, setSeverity] = useState('');
  const [category, setCategory] = useState('');
  const [categoryDraft, setCategoryDraft] = useState('');
  const [search, setSearch] = useState('');
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [page, setPage] = useState<EvidencePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const cursor = cursors.at(-1);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    const loadPage = async () => {
      try {
        const query = new URLSearchParams({ limit: '50' });
        if (cursor) query.set('cursor', cursor);
        if (kind === 'issues') {
          if (severity) query.set('severity', severity);
          if (category) query.set('category', category);
          if (search.trim()) query.set('query', search.trim());
        }
        const headers = await getAuditAccessHeaders();
        if (controller.signal.aborted) return;
        const response = await fetch(`/api/tools/audit/${encodeURIComponent(auditId)}/evidence/${kind}?${query}`, {
          headers, cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) throw new Error(response.status === 404 ? 'Audit unavailable or access denied.' : 'Evidence could not be loaded.');
        const body = await response.json();
        if (!body.success || !Array.isArray(body.data?.items)) throw new Error('Invalid evidence response.');
        if (!controller.signal.aborted) setPage({ ...body.data, batch: cursors.length, requestKey: query.toString() });
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Evidence could not be loaded.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    };
    const timer = window.setTimeout(() => { void loadPage(); }, kind === 'issues' ? 300 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [auditId, kind, cursor, cursors.length, severity, category, search, retry]);
  const issues = kind === 'issues' ? (page?.items as ResourceAuditIssue[] || []).filter(issue => !section || classifyReportSection(issue) === section) : [];
  return <section className="min-w-0 space-y-4" aria-label={`Paginated ${kind}`} aria-busy={loading}>
    {kind === 'issues' && <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); setCategory(categoryDraft.trim()); setCursors([undefined]); }}>
      <label className="min-w-0 text-sm">All-evidence search<input type="search" className="suite-input mt-1" maxLength={160} value={search} onChange={event => { setSearch(event.target.value); setCursors([undefined]); }} placeholder="Title, description or URL" /></label>
      <label className="text-sm">All-evidence severity<select className="suite-input mt-1" value={severity} onChange={event => { setSeverity(event.target.value); setCursors([undefined]); }}><option value="">All severities</option>{['critical', 'high', 'medium', 'low', 'info'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="text-sm">All-evidence category<input className="suite-input mt-1" maxLength={100} value={categoryDraft} onChange={event => setCategoryDraft(event.target.value)} placeholder="Exact category" /></label>
      <button className="quiet-button" type="submit">Apply category</button>
    </form>}
    <p className="text-xs text-muted-foreground" role="status">Evidence batch {page?.batch ?? cursors.length}, up to 50 records{page?.total != null ? `; ${page.total} ${kind} in the audit` : ''}. {kind === 'issues' && 'Search, severity and category above apply to all audit findings. Section, search, workflow filters and sorting below apply to this batch only.'}</p>
    {loading && <p role="status">{page ? 'Loading evidence... Showing the previous batch until it is ready.' : 'Loading evidence...'}</p>}
    {error && <div role="alert">{error} <button type="button" className="quiet-button" onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
    {page && (kind === 'issues'
      ? <><FindingWorkspace key={page.requestKey} auditId={auditId} issues={issues} {...workflow} />{!issues.length && page.nextCursor && <p className="text-sm text-muted-foreground">No section findings in this batch. More evidence is available in the next batch.</p>}</>
      : <div className="overflow-x-auto" role="region" aria-label="Audit page evidence" tabIndex={0}><table className="suite-table w-full min-w-[640px]"><caption className="sr-only">Current batch of stored page evidence</caption><thead><tr><th>URL</th><th>Status</th><th>Response</th><th>Size</th><th>Findings</th></tr></thead><tbody>{(page.items as ResourceAuditPage[]).map(item => <tr key={item.id}><td className="max-w-md break-all"><div>{item.title || 'Untitled page'}</div><div className="text-xs text-muted-foreground">{item.url}</div></td><td>{item.statusCode || '-'}</td><td>{item.responseTimeMs} ms</td><td>{Math.round(item.pageSizeBytes / 1024)} KB</td><td>{item.issueCount}</td></tr>)}{!page.items.length && <tr><td colSpan={5}>No page evidence in this batch.</td></tr>}</tbody></table></div>)}
    <nav className="flex flex-wrap gap-2" aria-label="Evidence pagination">
      <button type="button" className="quiet-button" disabled={loading} onClick={() => { setCursors([undefined]); setRetry(value => value + 1); }}>Refresh evidence</button>
      <button type="button" className="quiet-button" disabled={loading || !!error || cursors.length === 1} onClick={() => setCursors(values => values.slice(0, -1))}>Previous batch</button>
      <button type="button" className="quiet-button" disabled={loading || !!error || !page?.nextCursor} onClick={() => { if (page?.nextCursor) setCursors(values => [...values, page.nextCursor!]); }}>Next batch</button>
    </nav>
  </section>;
}
