import { Download, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import type { AdminActionRecord, AdminPage } from '../../lib/admin/types';
import { Link } from '../../app/router';
import { Notice } from '../ui/page-system';
import { adminGet, downloadAdminActions } from './client';
import { DataNotice, Evidence, HealthBadge, timestamp } from './operations-shared';
import { Empty, Loading, Panel } from './shared';
import { Pagination } from './Pagination';
import { useAdminData } from './useAdminData';

export default function AdminActions({ recent }: { recent: AdminActionRecord[] }) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const history = useAdminData(signal => adminGet<AdminPage<AdminActionRecord>>(`actions?limit=25&offset=${page * 25}`, signal), [page], { enabled: expanded });
  const rows = expanded ? history.data?.rows || [] : recent;
  const download = async () => { setExporting(true); setExportError(''); try { await downloadAdminActions(); } catch (error) { setExportError(error instanceof Error ? error.message : 'Export failed.'); } finally { setExporting(false); } };
  return <Panel title="Administrator activity" description="Verify recorded outcomes, reasons, and before/after evidence." icon={ShieldAlert} action={<div className="flex flex-wrap gap-2"><button type="button" className="quiet-button min-h-11" onClick={() => setExpanded(value => !value)}>{expanded ? 'Recent only' : 'Full history'}</button><button type="button" disabled={exporting} className="quiet-button min-h-11" title="Download up to 1,000 most recent actions" onClick={download}><Download className="h-4 w-4" />{exporting ? 'Downloading...' : 'CSV (1,000 max)'}</button></div>}>
    {expanded && <DataNotice {...history} />}
    {exportError && <Notice tone="danger">{exportError}</Notice>}
    {expanded && history.loading && !history.data ? <Loading /> : rows.length ? <ul className="divide-y divide-border">{rows.map(row => <li key={row.id} className="min-w-0 space-y-2 py-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="break-all text-sm font-semibold">{row.action}</span><HealthBadge status={row.outcome || 'unknown'} /></div><p className="break-words text-sm">{row.reason || 'No reason recorded'}</p><p className="break-all text-xs text-muted-foreground">{row.targetType === 'audit' && row.targetId ? <Link className="inline-flex min-h-11 items-center text-accent hover:underline" to={`/admin/audits?auditId=${encodeURIComponent(row.targetId)}`}>Audit {row.targetId}</Link> : row.targetType === 'user' && row.targetId ? <Link className="inline-flex min-h-11 items-center text-accent hover:underline" to={`/admin/users?userId=${encodeURIComponent(row.targetId)}`}>Account {row.targetId}</Link> : `${row.targetType || 'Platform'} ${row.targetId || ''}`} / {timestamp(row.createdAt)}</p>{row.requestId && <p className="break-all text-xs text-muted-foreground">Request ID: {row.requestId}</p>}{expanded && <Evidence value={{ before: row.before, after: row.after, outcome: row.outcome, requestId: row.requestId }} label="Before / after evidence" />}</li>)}</ul> : <Empty text="No administrative actions recorded." />}
    {expanded && <Pagination page={page} hasMore={history.data?.hasMore || false} loading={history.loading} onChange={setPage} />}
  </Panel>;
}
