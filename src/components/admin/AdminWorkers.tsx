import { Loader2, Power, Wifi } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from '../../app/router';
import type { ActionResult, OperationsWorker } from '../../lib/admin/types';
import { Notice } from '../ui/page-system';
import { useAdminData } from './useAdminData';
import { useAdminActionReason } from './AdminActionDialog';
import { adminGet, adminPost } from './client';
import { ActionFeedback, DataNotice, HealthBadge, timestamp } from './operations-shared';
import { Empty, Loading, Panel } from './shared';

export function WorkerWake({ refresh }: { refresh: () => void | Promise<void> }) {
  const requestReason = useAdminActionReason();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [error, setError] = useState('');
  const wake = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const reason = await requestReason('requesting an audit-engine wake check', { warning: 'A successful health request does not confirm worker readiness or audit progress. Verify the next heartbeat.' });
      if (!reason) return;
      setPending(true); setResult(null); setError('');
      setResult(await adminPost<ActionResult>('workers/wake', { reason }));
      await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : 'Wake request failed.'); }
    finally { setPending(false); busy.current = false; }
  };
  return <div className="min-w-0 space-y-3"><button type="button" disabled={pending} onClick={wake} className="quiet-button min-h-11">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}{pending ? 'Wake request pending...' : 'Request worker wake'}</button>{error && <Notice tone="danger">{error}</Notice>}{result && <><ActionFeedback result={result} /><p className="text-xs text-muted-foreground">Verify a fresh heartbeat, database connection, and queue progress below.</p></>}</div>;
}
export function WorkerStatus({ worker }: { worker: OperationsWorker }) {
  return <article className="min-w-0 border-b border-border py-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="break-all text-sm font-semibold">{worker.id}</h3><HealthBadge status={worker.state} /></div><dl className="mt-3 grid min-w-0 gap-3 text-xs sm:grid-cols-2">{[['Last seen', timestamp(worker.lastSeenAt)], ['Database', worker.databaseConnected == null ? 'Unknown' : worker.databaseConnected ? 'Connected' : 'Disconnected'], ['Commit', worker.commitIdentifier || 'Unknown'], ['API schema', worker.apiSchemaVersion ?? 'Unknown'], ['Audit engine', worker.auditEngineVersion || 'Unknown'], ['Scoring', worker.scoringVersion || 'Unknown'], ['Deep audit', worker.deepAuditEnabled == null ? 'Unknown' : worker.deepAuditEnabled ? 'Enabled' : 'Disabled']].map(([label, value]) => <div className="min-w-0" key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 break-all">{value}</dd></div>)}<div className="min-w-0"><dt className="text-muted-foreground">Current audit</dt><dd className="mt-1 break-all">{worker.currentAuditId ? <Link className="inline-flex min-h-11 items-center text-accent hover:underline" to={`/admin/audits?auditId=${encodeURIComponent(worker.currentAuditId)}`}>{worker.currentAuditId}</Link> : 'None reported'}</dd></div></dl></article>;
}
export default function AdminWorkers() {
  const workers = useAdminData(signal => adminGet<OperationsWorker[]>('workers', signal), []);
  return <Panel title="Audit engine health" description="Heartbeat, database connection, active jobs, and runtime versions." icon={Wifi}>
    <DataNotice {...workers} />
    <WorkerWake refresh={workers.refresh} />
    {workers.loading && !workers.data ? <Loading /> : workers.data?.length ? workers.data.map(worker => <WorkerStatus key={worker.id} worker={worker} />) : <Empty text="No audit-engine heartbeat found." />}
  </Panel>;
}
