import React, { useEffect, useMemo, useState } from 'react';
import { Archive, BarChart3, ChevronLeft, ChevronRight, History, Loader2, Search, Trash2 } from 'lucide-react';
import { Link } from '../../app/router';
import { auditWorkspacePath } from '../../app/routes';
import { isCompletedAuditStatus } from '../../lib/audit/audit-time';
import { API_ROUTES } from '../../lib/api/routes';
import { getAuditAccessHeaders } from '../../lib/api/auth-headers';
import type { AuditHistoryPage, AuditReportSummary } from '../../lib/audit/resource-types';
import { safeJsonFetch } from '../../lib/http/safe-json';
import { EmptyState, StatusBadge, SurfaceCard } from '../ui/visual-system';
import { Notice, PageHeader } from '../ui/page-system';
import { auditFocusLabel } from '../../lib/audit/audit-scope';
import './audit-report.css';

function scoreFor(item: AuditHistoryPage<AuditReportSummary>['items'][number]) {
  const raw = item.finalReport?.scores?.overall;
  const score = Number(raw);
  return raw == null || !Number.isFinite(score) ? null : Math.round(score);
}

export default function AuditHistoryPageView({ onStartAudit }: { onStartAudit: () => void }) {
  const [history, setHistory] = useState<AuditHistoryPage<AuditReportSummary> | null>(null);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: '12', offset: String(page * 12), view: 'summary' });
    if (status) params.set('status', status);
    if (includeArchived) params.set('archived', 'true');
    getAuditAccessHeaders()
      .then((headers) => safeJsonFetch<any>(`${API_ROUTES.auditHistory}?${params}`, { headers }))
      .then((response) => {
        if (!active) return;
        if (!response.success) throw new Error((response as any).error || 'Audit history is unavailable.');
        setHistory((response.data.data || response.data) as AuditHistoryPage<AuditReportSummary>);
      })
      .catch((nextError) => active && setError(nextError instanceof Error ? nextError.message : 'Audit history is unavailable.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [includeArchived, page, refreshKey, status]);

  const mutateAudit = async (auditId: string, action: 'archive' | 'restore' | 'delete') => {
    const question = action === 'delete' ? 'Permanently delete this audit and its report?' : action === 'restore' ? 'Restore this audit to history?' : 'Archive this audit?';
    if (!window.confirm(question)) return;
    setMutatingId(auditId);
    setError(null);
    const response = await safeJsonFetch<any>(action === 'delete' ? API_ROUTES.auditDelete(auditId) : API_ROUTES.auditArchive(auditId), {
      method: action === 'delete' ? 'DELETE' : 'POST',
      headers: await getAuditAccessHeaders({ 'Content-Type': 'application/json' }),
      body: action === 'delete' ? undefined : JSON.stringify({ archived: action !== 'restore' }),
    });
    if (response.success === false) setError(response.error);
    else setRefreshKey((value) => value + 1);
    setMutatingId(null);
  };

  const items = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (history?.items || []).filter((item) => !normalized || `${item.audit.hostname} ${item.audit.normalizedUrl}`.toLowerCase().includes(normalized));
  }, [history, query]);

  return (
    <div className="audit-customer-workspace w-full space-y-6 animate-rise">
      <PageHeader eyebrow="Audit history" icon={History} title="Your audits" description="Stored runs, measured results, and comparisons." actions={<button type="button" className="trust-button" onClick={onStartAudit}>Start audit</button>} />
      <div className="grid gap-3 border-y border-border py-4 sm:grid-cols-[minmax(0,1fr)_200px_auto] sm:items-center">
        <label className="relative"><span className="sr-only">Filter websites</span><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><input className="suite-input pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by website" /></label>
        <select className="suite-input" value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }} aria-label="Filter audit status"><option value="">All statuses</option><option value="completed">Completed</option><option value="completed_with_warnings">Completed with warnings</option><option value="running">Running</option><option value="queued">Waiting</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option><option value="abandoned">Abandoned</option></select>
        <label className="flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold"><input type="checkbox" checked={includeArchived} onChange={(event) => { setIncludeArchived(event.target.checked); setPage(0); }} className="h-4 w-4 accent-[var(--accent)]" /> Include archived</label>
      </div>
      {loading && <SurfaceCard className="flex items-center gap-3 p-6"><Loader2 className="h-5 w-5 animate-spin text-accent" /> Loading audit history...</SurfaceCard>}
      {error && <Notice tone="danger" title="Audit history could not load">{error}</Notice>}
      {!loading && !error && !items.length && <SurfaceCard className="p-6"><EmptyState icon={History} title="No matching audits" description="Run an audit or change the current filters." action={<button type="button" className="trust-button" onClick={onStartAudit}>Start website audit</button>} /></SurfaceCard>}
      {!!items.length && <section className="divide-y divide-border border-y border-border" aria-label="Stored audit runs">{items.map((item) => {
        const score = scoreFor(item);
        return <article key={item.audit.id} className="grid min-w-0 gap-5 py-5 xl:grid-cols-2">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="break-all text-lg font-semibold">{item.audit.hostname}</h2>{item.audit.archivedAt && <StatusBadge tone="neutral">Archived</StatusBadge>}<StatusBadge tone={isCompletedAuditStatus(item.audit.status) ? 'success' : item.audit.status === 'failed' ? 'danger' : 'warning'}>{item.audit.status.replace(/_/g, ' ')}</StatusBadge></div><p className="mt-2 text-xs text-muted-foreground">{new Date(item.audit.createdAt).toLocaleString()}</p><p className="mt-2 text-xs text-muted-foreground">{item.audit.scope ? `${auditFocusLabel(item.audit.scope)} · ${item.audit.scope.coverage} coverage · ` : ''}{item.audit.effectiveMode} audit</p></div>
          <div className="grid gap-4 sm:grid-cols-2 sm:items-center"><dl className="grid grid-cols-3 gap-4">{[['Score', score ?? 'Not measured'], ['Pages', item.audit.pagesCrawled], ['Findings', item.audit.issuesFound]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd></div>)}</dl><div className="flex flex-wrap gap-2 sm:justify-end">{!['queued', 'running'].includes(item.audit.status) && <><button type="button" className="quiet-button min-h-9 min-w-9 p-2" title={item.audit.archivedAt ? 'Restore audit' : 'Archive audit'} aria-label={`${item.audit.archivedAt ? 'Restore' : 'Archive'} ${item.audit.hostname}`} disabled={mutatingId === item.audit.id} onClick={() => mutateAudit(item.audit.id, item.audit.archivedAt ? 'restore' : 'archive')}><Archive className="h-4 w-4" /></button><button type="button" className="quiet-button min-h-9 min-w-9 p-2 text-[var(--danger)]" title="Delete audit" aria-label={`Delete ${item.audit.hostname}`} disabled={mutatingId === item.audit.id} onClick={() => mutateAudit(item.audit.id, 'delete')}><Trash2 className="h-4 w-4" /></button></>}<Link className="trust-button min-h-9 px-3 text-xs" to={auditWorkspacePath(item.audit.id, 'overview')}><BarChart3 className="h-4 w-4" />Open</Link></div></div>
        </article>;
      })}</section>}
      {history && history.total > history.limit && <nav className="flex items-center justify-between border-t border-border pt-4" aria-label="Audit history pages"><button type="button" className="quiet-button" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}><ChevronLeft className="h-4 w-4" /> Previous</button><span className="text-sm text-muted-foreground">Page {page + 1} of {Math.ceil(history.total / history.limit)}</span><button type="button" className="quiet-button" disabled={(page + 1) * history.limit >= history.total} onClick={() => setPage((value) => value + 1)}>Next <ChevronRight className="h-4 w-4" /></button></nav>}
    </div>
  );
}
