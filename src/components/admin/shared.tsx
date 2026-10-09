import { AlertTriangle, Loader2 } from 'lucide-react';
import './admin-workspace.css';
import React from 'react';
import { Link } from '../../app/router';
import { isCompletedAuditStatus } from '../../lib/audit/audit-time';
import { AuditDetailDrawer } from './AdminDetails';
import { useAdminFilter } from './useAdminFilter';

function duplicateAuditWarning(row: any, rows: any[]) {
  const time = new Date(row.createdAt).getTime();
  const owner = row.userId || row.guestKeyHash;
  if (!row.normalizedUrl || !owner || !Number.isFinite(time)) return null;
  return rows.some(candidate => candidate.id !== row.id && candidate.normalizedUrl === row.normalizedUrl && (candidate.userId || candidate.guestKeyHash) === owner && Math.abs(new Date(candidate.createdAt).getTime() - time) <= 600000) ? 'Possible duplicate within 10 minutes (this page)' : null;
}
export function AuditTable({ rows, refresh }: { rows: any[]; adminUserId: string; refresh: () => void | Promise<void> }) {
  const [selectedId, setSelectedId] = useAdminFilter('auditId');
  const identity = (item: any) => <><button type="button" onClick={() => setSelectedId(item.id)} className="min-h-11 break-all text-left text-sm font-semibold text-accent hover:underline">{item.normalizedUrl || item.domain || item.id}</button>{duplicateAuditWarning(item, rows) && <div className="mt-1 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle className="h-3 w-3 shrink-0" />{duplicateAuditWarning(item, rows)}</div>}<div className="break-words text-xs text-muted-foreground">{item.error || item.currentPhase}</div>{item.userId && <Link to={`/admin/users?userId=${encodeURIComponent(item.userId)}`} className="mt-1 inline-flex min-h-11 items-center text-xs text-accent hover:underline">Account details</Link>}</>;
  return <div className="min-w-0">
    <div className="space-y-3 md:hidden">{rows.map(item => <article key={item.id} className="min-w-0 rounded-lg border border-border p-3">{identity(item)}<dl className="mt-3 grid grid-cols-2 gap-3 text-xs">{[['Status', item.status], ['Plan', item.plan || 'free'], ['Mode', item.effectiveMode || item.requestedMode || 'quick'], ['Priority', item.queuePriority ?? 'Not reported'], ['Worker', item.lockedBy || 'Not locked'], ['Lease', item.leaseExpiresAt ? new Date(item.leaseExpiresAt).toLocaleString() : 'No lease']].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 break-all">{value}</dd></div>)}</dl><button type="button" onClick={() => setSelectedId(item.id)} className="quiet-button mt-3 min-h-11">Inspect and act</button></article>)}</div>
    <div className="hidden max-w-full overflow-x-auto rounded-lg border border-border md:block"><table className="suite-table min-w-[900px]"><caption className="sr-only">Audit jobs, server ordered. Open a job to inspect diagnostics and take guarded actions.</caption><thead><tr>{['URL and phase', 'Status', 'Plan', 'Mode', 'Priority', 'Lease', 'Actions'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{rows.map(item => <tr key={item.id}><td className="max-w-xs">{identity(item)}</td><td><span className={`inline-flex rounded px-2 py-1 text-xs font-semibold ${statusClass(item.status)}`}>{item.status}</span></td><td>{item.plan || 'free'}</td><td>{item.effectiveMode || item.requestedMode || 'quick'}</td><td>{item.queuePriority ?? 'Not reported'}</td><td className="max-w-40 break-all text-xs">{item.lockedBy || 'Not locked'}<div className="mt-1 text-muted-foreground">{item.leaseExpiresAt ? new Date(item.leaseExpiresAt).toLocaleString() : 'No lease'}</div></td><td><button type="button" className="quiet-button min-h-11 whitespace-nowrap text-xs" onClick={() => setSelectedId(item.id)}>Inspect and act</button></td></tr>)}</tbody></table></div>
    {!rows.length && <Empty text="No audits match these filters." />}
    {selectedId && <AuditDetailDrawer key={selectedId} id={selectedId} onClose={() => setSelectedId('')} onChanged={refresh} />}
  </div>;
}
export function WorkerRow({ worker }: { worker: any }) {
  const value = worker.value || worker;
  const lastSeen = value.lastSeenAt || worker.updatedAt;
  const stale = lastSeen ? Date.now() - new Date(lastSeen).getTime() > 90000 : true;
  return <div className="mb-3 min-w-0 rounded-lg border border-border p-4"><div className="flex flex-wrap justify-between gap-2"><div className="min-w-0 break-all font-semibold">{value.workerId || worker.id}</div><div className={`text-sm ${stale ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{stale ? 'Stale or sleeping' : 'Heartbeat recent'}</div></div><div className="mt-2 break-all text-sm text-muted-foreground">Runtime: {value.runtime || 'unknown'} / Active audit: {value.currentAuditId || 'none'}</div><div className="mt-3 grid gap-2 border-t border-border pt-3 text-xs text-muted-foreground sm:grid-cols-2"><span>Last contact: {lastSeen ? new Date(lastSeen).toLocaleString() : 'Never'}</span><span>Modes: {(value.supportedModes || []).join(', ') || 'Unknown'}</span></div></div>;
}
export function Metric({ icon: Icon, label, value, detail, tone = 'accent' }: { icon: any; label: string; value: React.ReactNode; detail: string; tone?: 'accent' | 'success' | 'warning' | 'danger' }) {
  const tones = { accent: 'bg-blue-500/10 text-blue-600', success: 'bg-emerald-500/10 text-emerald-600', warning: 'bg-amber-500/10 text-amber-600', danger: 'bg-red-500/10 text-red-600' };
  return <div className="admin-stat min-w-0"><div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><div className="break-words text-sm text-muted-foreground">{label}</div><div className="mt-2 break-words text-2xl font-semibold">{value}</div></div><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}><Icon className="h-5 w-5" /></span></div><div className="mt-3 break-words text-xs text-muted-foreground">{detail}</div></div>;
}
export function Panel({ title, description, icon: Icon, action, children }: { title: string; description?: string; icon?: any; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="suite-panel min-w-0 max-w-full p-4 sm:p-5"><div className="mb-5 flex min-w-0 flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between"><div className="flex min-w-0 gap-3">{Icon && <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"><Icon className="h-5 w-5" /></span>}<div className="min-w-0"><h2 className="break-words text-lg font-semibold">{title}</h2>{description && <p className="mt-1 break-words text-sm leading-6 text-muted-foreground">{description}</p>}</div></div>{action && <div className="min-w-0">{action}</div>}</div>{children}</section>;
}
export function Empty({ text }: { text: string }) { return <div className="p-6 text-center text-muted-foreground">{text}</div>; }
export function Loading() { return <div role="status" aria-label="Loading admin data" className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-accent" /><span className="sr-only">Loading...</span></div>; }
export function Select({ value, options, onChange, disabled = false, label }: { value: string; options: string[]; onChange: (value: string) => void; disabled?: boolean; label?: string }) {
  return <select aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} className="block min-h-11 max-w-full rounded-md border border-border bg-background px-2.5 py-2 text-sm capitalize text-foreground disabled:opacity-50">{options.map(option => <option key={option} value={option}>{option}</option>)}</select>;
}
export function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="block min-w-0 text-sm"><span className="font-semibold">{label}</span><input value={value} onChange={event => onChange(event.target.value)} className="suite-input mt-2 min-h-11" /></label>; }
export function NumberInput({ value, onBlur, disabled = false, min = 0, max, label }: { value: number; onBlur: (value: number) => void; disabled?: boolean; min?: number; max?: number; label?: string }) {
  return <input key={value} type="number" min={min} max={max} step={1} aria-label={label} defaultValue={value} disabled={disabled} onBlur={event => { const next = event.currentTarget.valueAsNumber; if (Number.isInteger(next) && next >= min && (max == null || next <= max) && next !== value) onBlur(next); event.currentTarget.value = String(value); }} className="min-h-11 w-24 rounded-md border border-border bg-background px-2.5 py-2 disabled:opacity-50" />;
}
export function SimpleTable({ rows, columns }: { rows: any[]; columns: string[] }) {
  return <div className="max-w-full overflow-x-auto rounded-lg border border-border"><table className="suite-table min-w-[680px]"><caption className="sr-only">{columns.join(', ')} records</caption><thead><tr>{columns.map(column => <th scope="col" key={column}>{column.replace(/[A-Z]/g, letter => ` ${letter.toLowerCase()}`)}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || index}>{columns.map(column => <td className="max-w-xs break-words" key={column}>{column === 'createdAt' && row[column] ? new Date(row[column]).toLocaleString() : typeof row[column] === 'object' ? JSON.stringify(row[column]) : String(row[column] ?? '')}</td>)}</tr>)}</tbody></table></div>;
}
export function statusClass(status: string) {
  if (status === 'completed_with_warnings') return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (isCompletedAuditStatus(status)) return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (['failed', 'cancelled', 'abandoned'].includes(status)) return 'bg-red-500/10 text-red-700 dark:text-red-300';
  return 'bg-blue-500/10 text-blue-700 dark:text-blue-300';
}
