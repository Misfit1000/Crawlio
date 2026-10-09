import { Database,RefreshCw,Search } from 'lucide-react';
import { useAdminFilter } from './useAdminFilter';
import { Pagination } from './Pagination';
import { useAdminList } from './useAdminList';
import { AdminSort, allowedSort } from './AdminSort';
import { DataNotice } from './operations-shared';


import { AuditTable,Panel } from './shared';
export default function AdminAudits({ adminUserId }: { adminUserId: string }) {
  const [query, setQuery] = useAdminFilter('search');
  const [status, setStatus] = useAdminFilter('status', 'all');
  const [userId, setUserId] = useAdminFilter('userId');
  const [sort, setSort] = useAdminFilter('sort', 'created_at');
  const [direction, setDirection] = useAdminFilter('direction', 'desc');
  const [mode, setMode] = useAdminFilter('mode', 'all');
  const [plan, setPlan] = useAdminFilter('plan', 'all');
  const audits = useAdminList('audits', { search: query, status, userId, mode, plan, sort: allowedSort('audits', sort), direction: direction === 'asc' ? 'asc' : 'desc' });
  const rows = audits.rows;
  return (
    <Panel title="Audit jobs" description="Inspect jobs, change queue priority, retry failures, or recover stale leases." icon={Database} action={<button type="button" onClick={audits.refresh} className="quiet-button min-h-11 px-3 py-1.5 text-xs"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>}>
      <DataNotice {...audits} />
      {userId && <div className="mb-4 flex min-w-0 flex-wrap items-center gap-3 text-sm"><span className="break-all">Account: {userId}</span><button type="button" className="quiet-button min-h-11" onClick={() => setUserId('')}>Clear account filter</button></div>}
      <div className="mb-4 grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_200px]"><label className="relative"><span className="sr-only">Search audit jobs</span><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search website URL" className="suite-input min-h-11 pl-9" /></label><select aria-label="Filter audit status" value={status} onChange={(event) => setStatus(event.target.value)} className="suite-input min-h-11"><option value="all">All statuses</option>{['queued', 'running', 'completed', 'completed_with_warnings', 'failed', 'cancelled', 'abandoned'].map((item) => <option key={item} value={item}>{item.replace(/_/g, ' ')}</option>)}</select></div>
      <AdminSort kind="audits" sort={sort} direction={direction} onSort={setSort} onDirection={setDirection} />
      <div className="mb-4 flex flex-wrap gap-3"><label className="flex items-center gap-2 text-sm">Mode<select className="suite-input min-h-11 w-auto" value={mode} onChange={event => setMode(event.target.value)}><option value="all">All modes</option>{['quick', 'standard', 'deep'].map(value => <option key={value}>{value}</option>)}</select></label><label className="flex items-center gap-2 text-sm">Plan<select className="suite-input min-h-11 w-auto" value={plan} onChange={event => setPlan(event.target.value)}><option value="all">All plans</option>{['free', 'paid', 'agency', 'admin'].map(value => <option key={value}>{value}</option>)}</select></label></div>
      <Pagination page={audits.page} hasMore={audits.hasMore} loading={audits.loading} onChange={audits.setPage} />
      <AuditTable rows={rows} adminUserId={adminUserId} refresh={audits.refresh} />
    </Panel>
  );
}
