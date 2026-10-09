import { SlidersHorizontal } from 'lucide-react';
import { useAdminList } from './useAdminList';
import { Pagination } from './Pagination';
import { DataNotice } from './operations-shared';
import { useAdminFilter } from './useAdminFilter';
import { AdminSort, allowedSort } from './AdminSort';


import { AuditTable,Loading,Panel } from './shared';
export default function AdminQueue({ adminUserId }: { adminUserId: string }) {
  const [sort, setSort] = useAdminFilter('sort', 'queue_priority');
  const [direction, setDirection] = useAdminFilter('direction', 'desc');
  const [mode, setMode] = useAdminFilter('mode', 'all');
  const [plan, setPlan] = useAdminFilter('plan', 'all');
  const audits = useAdminList('audits', { status: 'active', mode, plan, sort: allowedSort('audits', sort), direction: direction === 'asc' ? 'asc' : 'desc' });
  const rows = audits.rows;

  return (
    <Panel title="Active audit queue" description="Active jobs with server-side ordering across all result pages." icon={SlidersHorizontal}>
      <DataNotice {...audits} />
      <AdminSort kind="audits" sort={sort} direction={direction} onSort={setSort} onDirection={setDirection} />
      <div className="mb-4 flex flex-wrap gap-3"><label className="flex items-center gap-2 text-sm">Mode<select className="suite-input min-h-11 w-auto" value={mode} onChange={event => setMode(event.target.value)}><option value="all">All modes</option>{['quick', 'standard', 'deep'].map(value => <option key={value}>{value}</option>)}</select></label><label className="flex items-center gap-2 text-sm">Plan<select className="suite-input min-h-11 w-auto" value={plan} onChange={event => setPlan(event.target.value)}><option value="all">All plans</option>{['free', 'paid', 'agency', 'admin'].map(value => <option key={value}>{value}</option>)}</select></label></div>
      <Pagination page={audits.page} hasMore={audits.hasMore} loading={audits.loading} onChange={audits.setPage} />
      {audits.loading && !audits.data ? <Loading /> : <AuditTable rows={rows} adminUserId={adminUserId} refresh={audits.refresh} />}
    </Panel>
  );
}
