import { RefreshCw,Wifi } from 'lucide-react';
import {
getAdminWorkers
} from '../../services/supabaseDataService';
import { Notice } from '../ui/page-system';
import { useAdminData } from './useAdminData';


import { Empty,Loading,Panel,WorkerRow } from './shared';
export default function AdminWorkers() {
  const workers = useAdminData(() => getAdminWorkers(), []);
  if (workers.loading) return <Loading />;
  return (
    <Panel title="Audit engine health" description="Worker heartbeat, runtime, active job, supported modes, and last contact." icon={Wifi} action={<button type="button" onClick={workers.refresh} className="quiet-button min-h-9 px-3 py-1.5 text-xs"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>}>
      {workers.error && <Notice tone="danger" className="mb-4">{workers.error}</Notice>}
      {(workers.data || []).length ? (workers.data || []).map((worker: any) => <WorkerRow key={worker.id} worker={worker} />) : <Empty text="No audit engine heartbeat rows found." />}
      <Notice tone="info" className="mt-4">Render Free Web Service can sleep. Uptime monitors must ping only <code>https://seointel-audit-worker.onrender.com/health</code>, never the homepage or audit start routes.</Notice>
    </Panel>
  );
}
