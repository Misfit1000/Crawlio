import { AlertTriangle,Loader2 } from 'lucide-react';
import React,{ useState } from 'react';
import { isCompletedAuditStatus } from '../../lib/audit/audit-time';
import {
updateAuditAdminAction
} from '../../services/supabaseDataService';
import { Notice } from '../ui/page-system';
import { useAdminActionReason } from './AdminActionDialog';
import { DetailDrawer, DetailFields } from './DetailDrawer';


const DUPLICATE_AUDIT_WARNING_MS = 10 * 60 * 1000;
function auditOwnerKey(row: any) {
  return row.userId ? `user:${row.userId}` : row.guestKeyHash ? `guest:${row.guestKeyHash}` : null;
}

function duplicateAuditWarning(row: any, rows: any[]) {
  const rowTime = new Date(row.createdAt).getTime();
  if (!row.normalizedUrl || Number.isNaN(rowTime)) return null;
  const owner = auditOwnerKey(row);
  if (!owner) return null;
  const matches = rows.filter((candidate) => {
    const candidateTime = new Date(candidate.createdAt).getTime();
    return candidate.id !== row.id
      && candidate.normalizedUrl === row.normalizedUrl
      && auditOwnerKey(candidate) === owner
      && !Number.isNaN(candidateTime)
      && Math.abs(candidateTime - rowTime) <= DUPLICATE_AUDIT_WARNING_MS;
  });
  return matches.length
    ? `${matches.length + 1} audits for same URL and owner within 10 minutes`
    : null;
}

export function AuditTable({ rows, adminUserId, refresh }: { rows: any[]; adminUserId: string; refresh: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = rows.find(row => row.id === selectedId);
  const requestAdminReason = useAdminActionReason();
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const updateAudit = async (id: string, patch: any) => {
    const reason = await requestAdminReason(patch.status === 'cancelled' ? 'cancelling this audit job' : patch.status === 'queued' ? 'requeuing this audit job' : 'changing this audit priority');
    if (!reason) return;
    setUpdatingId(id);
    setError(null);
    try {
      await updateAuditAdminAction(id, patch, adminUserId, reason);
      refresh();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Audit update failed.');
    } finally {
      setUpdatingId(null);
    }
  };
  return (
    <div>
      {error && <Notice tone="danger" className="mb-4">{error}</Notice>}
      <div className="max-w-full overflow-x-auto rounded-lg border border-border">
      <table className="suite-table min-w-[980px]">
        <thead>
          <tr><th>URL and phase</th><th>Status</th><th>Plan</th><th>Mode</th><th>Priority</th><th>Lease</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.id}>
              <td className="max-w-sm break-all">
                <button type="button" onClick={() => setSelectedId(item.id)} className="text-left font-semibold text-accent hover:underline">{item.normalizedUrl}</button>
                {duplicateAuditWarning(item, rows) && (
                  <div className="mt-1 text-xs text-yellow-600 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    {duplicateAuditWarning(item, rows)}
                  </div>
                )}
                <div className="text-xs text-muted-foreground">{item.error || item.currentPhase}</div>
              </td>
              <td><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(item.status)}`}>{item.status}</span></td>
              <td className="capitalize">{item.plan || 'free'}</td>
              <td>{item.effectiveMode || item.requestedMode || 'quick'}</td>
              <td><input type="number" aria-label={`Priority for ${item.normalizedUrl}`} defaultValue={item.queuePriority ?? 10} disabled={updatingId === item.id} className="w-20 rounded-lg border border-border bg-background px-2 py-1.5" onBlur={(event) => {
                const value = event.currentTarget.valueAsNumber;
                if (Number.isFinite(value) && value !== (item.queuePriority ?? 10)) void updateAudit(item.id, { queuePriority: value });
                event.currentTarget.value = String(item.queuePriority ?? 10);
              }} /></td>
              <td className="text-xs"><div className="max-w-[150px] truncate">{item.lockedBy || 'Not locked'}</div><div className="mt-1 text-muted-foreground">{item.leaseExpiresAt ? new Date(item.leaseExpiresAt).toLocaleString() : 'No lease'}</div></td>
              <td><div className="flex flex-wrap gap-2">
                {updatingId === item.id && <Loader2 className="h-4 w-4 animate-spin text-accent" />}
                {['queued', 'running'].includes(item.status) && <button disabled={updatingId === item.id} onClick={() => updateAudit(item.id, { status: 'cancelled', currentPhase: 'Cancelled by admin', lockedBy: null, lockedAt: null, leaseExpiresAt: null })} className="quiet-button min-h-8 px-2.5 py-1 text-xs text-red-600">Cancel</button>}
                {item.status === 'failed' && <button disabled={updatingId === item.id} onClick={() => updateAudit(item.id, { status: 'queued', currentPhase: 'Retry queued', error: null, lockedBy: null, lockedAt: null, leaseExpiresAt: null })} className="quiet-button min-h-8 px-2.5 py-1 text-xs">Retry</button>}
                {item.leaseExpiresAt && new Date(item.leaseExpiresAt).getTime() < Date.now() && <button disabled={updatingId === item.id} onClick={() => updateAudit(item.id, { status: 'queued', currentPhase: 'Recovered by admin', lockedBy: null, lockedAt: null, leaseExpiresAt: null })} className="quiet-button min-h-8 px-2.5 py-1 text-xs">Recover</button>}
              </div>
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={7}><Empty text="No audits found." /></td></tr>}
        </tbody>
      </table>
      </div>
      {selected && <DetailDrawer title="Audit details" onClose={() => setSelectedId(null)}><DetailFields fields={[
        ['Website', selected.normalizedUrl], ['Audit ID', selected.id], ['Status', selected.status],
        ['Current activity', selected.currentPhase], ['Plan', selected.plan], ['Audit type', selected.effectiveMode || selected.requestedMode],
        ['Queue priority', selected.queuePriority], ['Created', selected.createdAt], ['Last updated', selected.updatedAt], ['Reported error', selected.error],
      ]} /></DetailDrawer>}
    </div>
  );
}


export function WorkerRow({ worker }: { worker: any }) {
  const value = worker.value || {};
  const lastSeen = value.lastSeenAt || worker.updatedAt;
  const stale = lastSeen ? Date.now() - new Date(lastSeen).getTime() > 90_000 : true;
  return (
    <div className="mb-3 rounded-xl border border-border bg-background/60 p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 font-semibold"><span className={`h-2.5 w-2.5 rounded-full ${stale ? 'bg-amber-500' : 'bg-emerald-500'}`} />{value.workerId || worker.id}</div>
          <div className="mt-1 text-sm text-muted-foreground">Runtime: {value.runtime || 'unknown'} / Active audit: {value.currentAuditId || 'none'}</div>
        </div>
        <div className={`text-sm font-semibold ${stale ? 'text-yellow-600' : 'text-green-600'}`}>{stale ? 'Stale or sleeping' : 'Healthy'}</div>
      </div>
      <div className="mt-3 grid gap-2 border-t border-border pt-3 text-xs text-muted-foreground sm:grid-cols-2"><span>Last contact: {lastSeen ? new Date(lastSeen).toLocaleString() : 'Never'}</span><span>Modes: {(value.supportedModes || []).join(', ') || 'Unknown'}</span></div>
    </div>
  );
}


export function Metric({ icon: Icon, label, value, detail, tone = 'accent' }: { icon: any; label: string; value: React.ReactNode; detail: string; tone?: 'accent' | 'success' | 'warning' | 'danger' }) {
  const tones = { accent: 'bg-blue-500/10 text-blue-600', success: 'bg-emerald-500/10 text-emerald-600', warning: 'bg-amber-500/10 text-amber-600', danger: 'bg-red-500/10 text-red-600' };
  return <div className="admin-stat"><div className="flex items-start justify-between gap-3"><div><div className="text-sm text-muted-foreground">{label}</div><div className="mt-2 text-3xl font-semibold">{value}</div></div><span className={`flex h-10 w-10 items-center justify-center rounded-lg ${tones[tone]}`}><Icon className="h-5 w-5" /></span></div><div className="mt-3 text-xs text-muted-foreground">{detail}</div></div>;
}


export function Panel({ title, description, icon: Icon, action, children }: { title: string; description?: string; icon?: any; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="suite-panel p-4 sm:p-5"><div className="mb-5 flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between"><div className="flex min-w-0 gap-3">{Icon && <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"><Icon className="h-5 w-5" /></span>}<div><h2 className="text-lg font-semibold">{title}</h2>{description && <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>}</div></div>{action && <div className="shrink-0">{action}</div>}</div>{children}</section>;
}


export function Empty({ text }: { text: string }) {
  return <div className="p-6 text-center text-muted-foreground">{text}</div>;
}


export function Loading() {
  return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>;
}


export function Select({ value, options, onChange, disabled = false }: { value: string; options: string[]; onChange: (value: string) => void; disabled?: boolean }) {
  return <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="rounded-lg border border-border bg-background px-2.5 py-1.5 capitalize disabled:opacity-50">{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
}


export function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block text-sm"><span className="font-semibold">{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} className="suite-input mt-2" /></label>;
}


export function NumberInput({ value, onBlur, disabled = false }: { value: number; onBlur: (value: number) => void; disabled?: boolean }) {
  return <input type="number" min={0} defaultValue={value} disabled={disabled} onBlur={(event) => onBlur(Math.max(0, Number(event.currentTarget.value)))} className="w-24 rounded-lg border border-border bg-background px-2.5 py-1.5 disabled:opacity-50" />;
}


export function SimpleTable({ rows, columns }: { rows: any[]; columns: string[] }) {
  return (
    <div className="max-w-full overflow-x-auto rounded-lg border border-border">
      <table className="suite-table min-w-[680px]">
        <thead><tr>{columns.map((column) => <th key={column}>{column.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={row.id || index}>{columns.map((column) => <td key={column}>{column === 'createdAt' && row[column] ? new Date(row[column]).toLocaleString() : String(row[column] ?? '')}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}


export function statusClass(status: string) {
  if (isCompletedAuditStatus(status)) return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'failed' || status === 'cancelled') return 'bg-red-500/10 text-red-700 dark:text-red-300';
  if (status === 'running') return 'bg-violet-500/10 text-violet-700 dark:text-violet-300';
  return 'bg-blue-500/10 text-blue-700 dark:text-blue-300';
}
