import { Database,RefreshCw,Search } from 'lucide-react';
import { useUrlFilter } from '../../app/use-url-filter';
import { Notice } from '../ui/page-system';
import { Pagination } from './Pagination';
import { useAdminList } from './useAdminList';


import { AuditTable,Panel } from './shared';
export default function AdminAudits({ adminUserId }: { adminUserId: string }) {
  const [query, setQuery] = useUrlFilter('search');
  const [status, setStatus] = useUrlFilter('status', 'all');
  const audits = useAdminList('audits', { search: query, status });
  const rows = audits.rows;
  return (
    <Panel title="Audit jobs" description="Inspect recent jobs, change queue priority, retry failures, or recover stale leases." icon={Database} action={<button type="button" onClick={audits.refresh} className="quiet-button min-h-9 px-3 py-1.5 text-xs"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>}>
      {audits.error && <Notice tone="danger" className="mb-4">{audits.error}</Notice>}
      <div className="mb-4 grid gap-3 md:grid-cols-[minmax(240px,1fr)_200px]"><label className="relative"><span className="sr-only">Search audit jobs</span><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search website URL" className="suite-input pl-9" /></label><select value={status} onChange={(event) => setStatus(event.target.value)} className="suite-input"><option value="all">All statuses</option>{['queued', 'running', 'completed', 'completed_with_warnings', 'failed', 'cancelled', 'abandoned'].map((item) => <option key={item} value={item}>{item.replace(/_/g, ' ')}</option>)}</select></div>
      <Pagination page={audits.page} hasMore={audits.hasMore} loading={audits.loading} onChange={audits.setPage} />
      <AuditTable rows={rows} adminUserId={adminUserId} refresh={audits.refresh} />
    </Panel>
  );
}
