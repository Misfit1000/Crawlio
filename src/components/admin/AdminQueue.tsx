import { RefreshCw,SlidersHorizontal } from 'lucide-react';
import { Notice } from '../ui/page-system';
import { useAdminList } from './useAdminList';
import { Pagination } from './Pagination';


import { AuditTable,Loading,Panel } from './shared';
export default function AdminQueue({ adminUserId }: { adminUserId: string }) {
  const audits = useAdminList('audits', { status: 'active' });
  const rows = audits.rows
    .filter((item: any) => item.status === 'queued' || item.status === 'running')
    .sort((a: any, b: any) => (b.queuePriority - a.queuePriority) || String(a.createdAt).localeCompare(String(b.createdAt)));

  if (audits.loading) return <Loading />;
  return (
    <Panel title="Active audit queue" description="Active jobs only. Each page is ordered by priority and creation time." icon={SlidersHorizontal} action={<button type="button" onClick={audits.refresh} className="quiet-button min-h-9 px-3 py-1.5 text-xs"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>}>
      {audits.error && <Notice tone="danger" className="mb-4">{audits.error}</Notice>}
      <Pagination page={audits.page} hasMore={audits.hasMore} loading={audits.loading} onChange={audits.setPage} />
      <AuditTable rows={rows} adminUserId={adminUserId} refresh={audits.refresh} />
    </Panel>
  );
}
