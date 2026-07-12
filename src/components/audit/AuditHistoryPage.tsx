import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, History, Loader2, Search } from 'lucide-react';
import { Link } from 'react-router';
import { auditWorkspacePath } from '../../app/routes';
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

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: '100' });
    if (status) params.set('status', status);
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
  }, [status]);

  const items = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (history?.items || []).filter((item) => !normalized || `${item.audit.hostname} ${item.audit.normalizedUrl}`.toLowerCase().includes(normalized));
  }, [history, query]);

  return (
    <div className="w-full space-y-6 animate-rise">
      <PageHeader eyebrow="Audit history" icon={History} title="Stored audit runs" description="Review Supabase-backed audits by website, date, status, mode, and measured score. Open any completed run in its routed workspace." actions={<button type="button" className="trust-button" onClick={onStartAudit}>Start audit</button>} />
      <SurfaceCard className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_200px]">
        <label className="relative"><span className="sr-only">Filter websites</span><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><input className="suite-input pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by website" /></label>
        <select className="suite-input" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter audit status"><option value="">All statuses</option><option value="completed">Completed</option><option value="running">Running</option><option value="queued">Waiting</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option></select>
      </SurfaceCard>
      {loading && <SurfaceCard className="flex items-center gap-3 p-6"><Loader2 className="h-5 w-5 animate-spin text-accent" /> Loading audit history...</SurfaceCard>}
      {error && <Notice tone="danger" title="Audit history could not load">{error}</Notice>}
      {!loading && !error && !items.length && <SurfaceCard className="p-6"><EmptyState icon={History} title="No matching audits" description="Run an audit or change the current filters." action={<button type="button" className="trust-button" onClick={onStartAudit}>Start website audit</button>} /></SurfaceCard>}
      {!!items.length && <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">{items.map((item) => {
        const score = scoreFor(item);
        return <SurfaceCard key={item.audit.id} className="flex h-full flex-col p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate text-lg font-semibold">{item.audit.hostname}</h2><p className="mt-1 text-xs text-muted-foreground">{new Date(item.audit.createdAt).toLocaleString()}</p></div><StatusBadge tone={item.audit.status === 'completed' ? 'success' : item.audit.status === 'failed' ? 'danger' : 'warning'}>{item.audit.status}</StatusBadge></div><div className="my-5 grid grid-cols-3 gap-2 text-sm"><div className="rounded-lg bg-muted/35 p-3"><span className="block text-xs text-muted-foreground">Score</span><strong className="text-xl">{score ?? '--'}</strong></div><div className="rounded-lg bg-muted/35 p-3"><span className="block text-xs text-muted-foreground">Pages</span><strong className="text-xl">{item.audit.pagesCrawled}</strong></div><div className="rounded-lg bg-muted/35 p-3"><span className="block text-xs text-muted-foreground">Findings</span><strong className="text-xl">{item.audit.issuesFound}</strong></div></div><div className="mt-auto flex items-center justify-between gap-3"><span className="text-xs font-semibold text-muted-foreground">{item.audit.effectiveMode} audit</span><Link className="trust-button" to={auditWorkspacePath(item.audit.id, 'overview')}><BarChart3 className="h-4 w-4" /> Open workspace</Link></div></SurfaceCard>;
      })}</div>}
    </div>
  );
}
