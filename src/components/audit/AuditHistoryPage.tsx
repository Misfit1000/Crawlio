import React, { useEffect, useMemo, useState } from 'react';
import { Archive, BarChart3, ChevronLeft, ChevronRight, History, Loader2, Search, Trash2 } from 'lucide-react';
import { Link } from '../../app/router';
import { auditWorkspacePath } from '../../app/routes';
import { isCompletedAuditStatus } from '../../lib/audit/audit-time';
import { API_ROUTES } from '../../lib/api/routes';
import { getAuditAccessHeaders } from '../../lib/api/auth-headers';
import type { AuditHistoryPage } from '../../lib/audit/resource-types';
import { safeJsonFetch } from '../../lib/http/safe-json';
import { EmptyState, StatusBadge, SurfaceCard } from '../ui/visual-system';
import { Notice, PageHeader } from '../ui/page-system';

function scoreFor(item: AuditHistoryPage['items'][number]) {
  const raw = item.finalReport?.scores?.overall;
  const score = Number(raw);
  return raw == null || !Number.isFinite(score) ? null : Math.round(score);
}

export default function AuditHistoryPageView({ onStartAudit }: { onStartAudit: () => void }) {
  const [history, setHistory] = useState<AuditHistoryPage | null>(null);
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
    const params = new URLSearchParams({ limit: '12', offset: String(page * 12) });
    if (status) params.set('status', status);
    if (includeArchived) params.set('archived', 'true');
    getAuditAccessHeaders()
      .then((headers) => safeJsonFetch<any>(`${API_ROUTES.auditHistory}?${params}`, { headers }))
      .then((response) => {
        if (!active) return;
        if (!response.success) throw new Error((response as any).error || 'Audit history is unavailable.');
        setHistory((response.data.data || response.data) as AuditHistoryPage);
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
    <div className="w-full space-y-6 animate-rise">
      <PageHeader eyebrow="Audit history" icon={History} title="Stored audit runs" description="Review audits by website, date, status, mode, and measured score. Open any completed run in its routed workspace." actions={<button type="button" className="trust-button" onClick={onStartAudit}>Start audit</button>} />
      <SurfaceCard className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_200px_auto] sm:items-center">
        <label className="relative"><span className="sr-only">Filter websites</span><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><input className="suite-input pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by website" /></label>
        <select className="suite-input" value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }} aria-label="Filter audit status"><option value="">All statuses</option><option value="completed">Completed</option><option value="completed_with_warnings">Completed with warnings</option><option value="running">Running</option><option value="queued">Waiting</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option><option value="abandoned">Abandoned</option></select>
        <label className="flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold"><input type="checkbox" checked={includeArchived} onChange={(event) => { setIncludeArchived(event.target.checked); setPage(0); }} className="h-4 w-4 accent-[var(--accent)]" /> Include archived</label>
      </SurfaceCard>
      {loading && <SurfaceCard className="flex items-center gap-3 p-6"><Loader2 className="h-5 w-5 animate-spin text-accent" /> Loading audit history...</SurfaceCard>}
      {error && <Notice tone="danger" title="Audit history could not load">{error}</Notice>}
      {!loading && !error && !items.length && <SurfaceCard className="p-6"><EmptyState icon={History} title="No matching audits" description="Run an audit or change the current filters." action={<button type="button" className="trust-button" onClick={onStartAudit}>Start website audit</button>} /></SurfaceCard>}
      {!!items.length && <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">{items.map((item) => {
        const score = scoreFor(item);
        return <SurfaceCard key={item.audit.id} className="flex h-full flex-col p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate text-lg font-semibold">{item.audit.hostname}</h2><p className="mt-1 text-xs text-muted-foreground">{new Date(item.audit.createdAt).toLocaleString()}</p></div><div className="flex flex-wrap justify-end gap-2">{item.audit.archivedAt && <StatusBadge tone="neutral">archived</StatusBadge>}<StatusBadge tone={isCompletedAuditStatus(item.audit.status) ? 'success' : item.audit.status === 'failed' ? 'danger' : 'warning'}>{item.audit.status.replace(/_/g, ' ')}</StatusBadge></div></div><div className="my-5 grid grid-cols-3 gap-2 text-sm"><div className="rounded-lg bg-muted/35 p-3"><span className="block text-xs text-muted-foreground">Score</span><strong className="text-xl">{score ?? '--'}</strong></div><div className="rounded-lg bg-muted/35 p-3"><span className="block text-xs text-muted-foreground">Pages</span><strong className="text-xl">{item.audit.pagesCrawled}</strong></div><div className="rounded-lg bg-muted/35 p-3"><span className="block text-xs text-muted-foreground">Findings</span><strong className="text-xl">{item.audit.issuesFound}</strong></div></div><div className="mt-auto flex flex-wrap items-center justify-between gap-3"><span className="text-xs font-semibold text-muted-foreground">{item.audit.effectiveMode} audit</span><div className="flex flex-wrap gap-2">{!['queued', 'running'].includes(item.audit.status) && <><button type="button" className="quiet-button min-h-9 px-2.5 text-xs" disabled={mutatingId === item.audit.id} onClick={() => mutateAudit(item.audit.id, item.audit.archivedAt ? 'restore' : 'archive')}><Archive className="h-3.5 w-3.5" /> {item.audit.archivedAt ? 'Restore' : 'Archive'}</button><button type="button" className="quiet-button min-h-9 px-2.5 text-xs text-red-600" disabled={mutatingId === item.audit.id} onClick={() => mutateAudit(item.audit.id, 'delete')}><Trash2 className="h-3.5 w-3.5" /> Delete</button></>}<Link className="trust-button min-h-9 px-3 text-xs" to={auditWorkspacePath(item.audit.id, 'overview')}><BarChart3 className="h-4 w-4" /> Open</Link></div></div></SurfaceCard>;
      })}</div>}
      {history && history.total > history.limit && <nav className="flex items-center justify-between border-t border-border pt-4" aria-label="Audit history pages"><button type="button" className="quiet-button" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}><ChevronLeft className="h-4 w-4" /> Previous</button><span className="text-sm text-muted-foreground">Page {page + 1} of {Math.ceil(history.total / history.limit)}</span><button type="button" className="quiet-button" disabled={(page + 1) * history.limit >= history.total} onClick={() => setPage((value) => value + 1)}>Next <ChevronRight className="h-4 w-4" /></button></nav>}
    </div>
  );
}
