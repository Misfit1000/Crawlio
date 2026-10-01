import type { ActionResult } from '../../lib/admin/types';
import { Notice } from '../ui/page-system';
import type { ReactNode } from 'react';

export function QuietNotice({ tone = 'info', title, children }: { tone?: 'info' | 'success' | 'warning' | 'danger'; title?: string; children: ReactNode }) {
  const classes = { info: 'border-blue-500/20 bg-blue-500/7', success: 'border-emerald-500/20 bg-emerald-500/8', warning: 'border-amber-500/25 bg-amber-500/10', danger: 'border-red-500/25 bg-red-500/10' };
  return <div className={`min-w-0 rounded-lg border p-4 text-sm leading-6 ${classes[tone]}`}>{title && <p className="font-semibold">{title}</p>}<div className={title ? 'mt-1' : ''}>{children}</div></div>;
}

export function duration(seconds: number | null | undefined) { return seconds == null ? 'Unavailable' : seconds < 60 ? `${Math.round(seconds)}s` : seconds < 3600 ? `${Math.round(seconds / 60)}m` : `${(seconds / 3600).toFixed(1)}h`; }
export function timestamp(value: string | null | undefined) { return value ? new Date(value).toLocaleString() : 'Not reported'; }
export function healthTone(status: string): 'success' | 'danger' | 'warning' | 'info' {
  return ['healthy', 'online', 'ready', 'compatible', 'commits match', 'ok'].includes(status) ? 'success' : ['critical', 'failed', 'unhealthy', 'offline', 'incompatible', 'error'].includes(status) ? 'danger' : status === 'unknown' ? 'info' : 'warning';
}
export function HealthBadge({ status }: { status: string }) {
  const tone = healthTone(status);
  const classes = { success: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', danger: 'bg-red-500/10 text-red-700 dark:text-red-300', warning: 'bg-amber-500/10 text-amber-900 dark:text-amber-200', info: 'bg-muted text-muted-foreground' };
  return <span className={`inline-flex max-w-full break-words rounded px-2 py-1 text-xs font-semibold capitalize ${classes[tone]}`}>{status.replace(/_/g, ' ')}</span>;
}
export function DataNotice({ error, stale, updatedAt, loading }: { error: string | null; stale: boolean; updatedAt: string | null; loading: boolean }) {
  return <div className="mb-4 space-y-2">
    {error && <QuietNotice tone="danger" title={stale ? 'Refresh failed; showing stale data' : 'Data unavailable'}>{error}</QuietNotice>}
    {updatedAt && <p className="text-xs text-muted-foreground">Last successful refresh: {timestamp(updatedAt)}{loading ? ' / Refreshing...' : ''}</p>}
  </div>;
}
export function Evidence({ value, label = 'Server evidence' }: { value: unknown; label?: string }) {
  return <details className="min-w-0 border-t border-border pt-3"><summary className="min-h-11 cursor-pointer text-sm font-semibold">{label}</summary><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all bg-muted p-3 text-xs">{JSON.stringify(value, null, 2) ?? 'Not reported'}</pre></details>;
}
export function ActionFeedback({ result }: { result: ActionResult }) {
  const verified = result.confirmedState != null || ['cancelled', 'priority_updated', 'retry_queued', 'applied'].includes(String(result.outcome));
  const requested = /request|pending/i.test(String(result.outcome)) || result.outcome === 'retry_queued';
  const failed = /fail|reject|conflict|error/i.test(String(result.outcome || ''));
  return <Notice tone={failed ? 'danger' : requested ? 'info' : verified ? 'success' : 'info'} title={failed ? 'Action did not complete' : requested ? 'Request recorded; completion pending' : verified ? 'Server state confirmed' : 'Request received; verification pending'}>
    <p>Outcome: {String(result.outcome || 'Not reported')}.{result.status ? ` Server audit state: ${result.status}.` : ''} {requested ? 'This is not evidence that the worker has completed the operation.' : verified ? 'This confirms the administrative change only.' : 'Refresh details before treating the change as complete.'}</p>
    {result.warning && <p className="mt-2 font-semibold">{result.warning}</p>}
    {result.reason && <p className="mt-2 break-words">Reason: {result.reason}</p>}
    {result.requestId && <p className="mt-2 break-all text-xs">Request ID: {result.requestId}</p>}
    {verified && <div className="mt-2"><Evidence value={result.confirmedState ?? { outcome: result.outcome, status: result.status, auditId: result.auditId, quotaExempt: result.quotaExempt }} label="Server confirmation" /></div>}
  </Notice>;
}
