import { Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from '../../app/router';
import type { ActionResult, AuditAction, AuditDetail, PriorityLevel, UserDetail } from '../../lib/admin/types';
import { Notice } from '../ui/page-system';
import { adminGet, adminPost, adminRecord } from './client';
import { DetailDrawer, DetailFields } from './DetailDrawer';
import { useAdminData } from './useAdminData';
import { useAdminActionReason } from './AdminActionDialog';
import { ActionFeedback, DataNotice, Evidence, HealthBadge, timestamp } from './operations-shared';
import { Loading } from './shared';

function realLease(detail: AuditDetail) {
  const audit = adminRecord(detail.audit);
  return audit.processingVersion === 2 ? detail.worker?.leaseExpiresAt ?? null : detail.worker?.leaseExpiresAt ?? audit.leaseExpiresAt ?? null;
}
const failureGuidance: Record<string, string> = {
  'target-site': 'The target site or network request failed. Confirm target availability and the recorded failure code before retrying; changing platform settings is not a target-site fix.',
  system: 'Platform processing failed. Check database, worker heartbeat, queue leases, and deployment compatibility before retrying. Recover only a server-confirmed expired lease.',
  'security-policy': 'The URL was rejected by a security policy. Do not bypass the policy or repeatedly retry the same URL. Correct the target to an allowed public URL and review admission checks.',
  unknown: 'The available evidence does not establish a cause. Inspect the failure code and processing state before choosing an action.',
};

export function AuditControls({ detail, onChanged }: { detail: AuditDetail; onChanged: () => void | Promise<void> }) {
  const requestReason = useAdminActionReason();
  const busy = useRef(false);
  const [pending, setPending] = useState<AuditAction | null>(null);
  const [priority, setPriority] = useState<PriorityLevel>('normal');
  const [result, setResult] = useState<ActionResult | null>(null);
  const [error, setError] = useState('');
  const audit = adminRecord(detail.audit);
  const active = ['queued', 'running'].includes(audit.status);
  const lease = realLease(detail);
  const expired = audit.status === 'running' && Boolean(lease) && new Date(lease).getTime() < Date.now();
  const act = async (action: AuditAction) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const reason = await requestReason(`${action === 'priority' ? `setting ${priority} priority for` : action === 'cancel' ? 'cancelling' : action === 'retry' ? 'retrying' : 'requesting stale recovery for'} audit ${audit.id}`, {
        changes: [{ label: action === 'priority' ? 'Priority boost' : 'Audit state', before: action === 'priority' ? audit.adminPriorityBoost ?? 0 : audit.status, after: action === 'priority' ? `${priority} (temporary)` : action === 'cancel' ? 'cancelled' : action === 'retry' ? 'New linked attempt' : 'Recovery requested; awaiting worker' }],
        warning: action === 'retry' ? 'Retry creates a new linked attempt without charging quota. The original audit remains unchanged.' : action === 'requeue' ? 'The server must confirm the lease is stale before recovery.' : undefined,
      });
      if (!reason) return;
      setPending(action); setResult(null); setError('');
      const next = await adminPost<ActionResult>(`audits/${encodeURIComponent(audit.id)}/action`, { action, reason, ...(action === 'priority' ? { priorityLevel: priority } : {}) });
      setResult(next);
      await onChanged();
    } catch (error) { setError(error instanceof Error ? error.message : 'Audit action failed.'); }
    finally { setPending(null); busy.current = false; }
  };
  const linkedId = result && (result.newAuditId || result.retryAuditId || result.attemptId || (result.originalAuditId ? result.auditId : null));
  return <section aria-label="Audit actions" className="space-y-3 border-t border-border pt-4">
    {pending && <Notice tone="info"><span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Request pending: {pending}. Waiting for server confirmation.</span></Notice>}
    {error && <Notice tone="danger">{error}</Notice>}
    {result && <ActionFeedback result={result} />}
    {linkedId && <Link to={`/admin/audits?auditId=${encodeURIComponent(String(linkedId))}`} className="quiet-button min-h-11">Inspect new linked attempt</Link>}
    {(result?.quotaCharged === false || result?.quotaExempt === true) && <p className="text-xs text-muted-foreground">Server confirmed no quota charge.</p>}
    <div className="flex flex-wrap gap-2">
      {active && <button type="button" className="quiet-button min-h-11 text-red-700 dark:text-red-300" disabled={Boolean(pending)} onClick={() => act('cancel')}>Cancel audit</button>}
      {detail.retryEligible && <button type="button" className="quiet-button min-h-11" disabled={Boolean(pending) || detail.failureClass === 'security-policy'} onClick={() => act('retry')}>Retry as new attempt</button>}
      {expired && <button type="button" className="quiet-button min-h-11" disabled={Boolean(pending)} onClick={() => act('requeue')}>Recover stale lease</button>}
    </div>
    {active && audit.processingVersion !== 1 && <div className="flex flex-wrap gap-2"><label className="flex items-center gap-2 text-sm">Priority<select className="suite-input min-h-11 w-auto" value={priority} disabled={Boolean(pending)} onChange={event => setPriority(event.target.value as PriorityLevel)}>{['normal', 'elevated', 'urgent'].map(value => <option key={value} value={value}>{value}</option>)}</select></label><button type="button" className="quiet-button min-h-11" disabled={Boolean(pending)} onClick={() => act('priority')}>Set priority</button></div>}
  </section>;
}

export function AuditDetailDrawer({ id, onClose, onChanged = () => {} }: { id: string; onClose: () => void; onChanged?: () => void | Promise<void> }) {
  const state = useAdminData(signal => adminGet<AuditDetail>(`audits/${encodeURIComponent(id)}/detail`, signal), [id]);
  const audit = state.data && adminRecord(state.data.audit);
  const processing = state.data?.processing;
  const failureClass = state.data?.failureClass || 'unknown';
  return <DetailDrawer title="Audit diagnostics" onClose={onClose}>
    <DataNotice {...state} />
    {state.loading && !audit ? <Loading /> : audit && state.data ? <>
      <HealthBadge status={audit.status || 'unknown'} />
      <DetailFields fields={[[ 'Website', audit.normalizedUrl || audit.domain ], ['Audit ID', audit.id], ['State', audit.status], ['Phase', audit.currentPhase], ['Plan', audit.plan], ['Mode', audit.effectiveMode || audit.requestedMode], ['Priority', audit.queuePriority], ['Priority boost', audit.adminPriorityBoost], ['Boost expires', timestamp(audit.adminPriorityExpiresAt)], ['Created', timestamp(audit.createdAt)], ['Updated', timestamp(audit.updatedAt)], ['Started', timestamp(audit.startedAt)], ['Completed', timestamp(audit.completedAt)], ['Lease expires', timestamp(realLease(state.data))], ['Pages discovered', audit.pagesDiscovered], ['Pages crawled', audit.pagesCrawled], ['Attempted', processing?.attempted as number | undefined], ['Analysed', processing?.analysed as number | undefined], ['Failed pages', processing?.failed as number | undefined], ['Blocked pages', processing?.blocked as number | undefined], ['Failure class', failureClass], ['Error', audit.error]]} />
      <section className="space-y-2 border-t border-border pt-4"><h3 className="text-sm font-semibold">Recommended safe actions</h3><p className="text-sm text-muted-foreground">{['failed', 'abandoned'].includes(audit.status) ? failureGuidance[failureClass] || failureGuidance.unknown : audit.status === 'queued' ? 'Verify worker readiness and queue wait. A temporary priority boost changes ordering, not admission rules or completion.' : audit.status === 'running' ? 'Verify processing progress and the real worker lease. Allow a current lease to finish; recover only when the server confirms it is expired.' : 'This audit is terminal. Inspect recorded outcomes; no queue recovery is needed.'}</p><p className="text-xs text-muted-foreground">{state.data.retryEligible ? failureClass === 'security-policy' ? 'Retry is blocked in this UI until the target-policy issue is corrected.' : 'Server reports retry eligibility; a retry is a new quota-exempt attempt, not an overwrite.' : 'Server does not report retry eligibility.'}</p></section>
      {audit.userId && <div className="flex flex-wrap gap-2"><Link className="quiet-button min-h-11" to={`/admin/users?userId=${encodeURIComponent(audit.userId)}`}>Account details</Link><Link className="quiet-button min-h-11" to={`/admin/audits?userId=${encodeURIComponent(audit.userId)}`}>All account audits</Link></div>}
      <Evidence value={state.data.diagnostics} label="Diagnostic evidence" />
      <Evidence value={{ worker: state.data.worker, processing: state.data.processing }} label="Worker and processing evidence" />
      <AuditControls key={audit.id} detail={state.data} onChanged={async () => { await state.refresh(); await onChanged(); }} />
    </> : null}
  </DetailDrawer>;
}

export function UserDetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const state = useAdminData(signal => adminGet<UserDetail>(`users/${encodeURIComponent(id)}/detail`, signal), [id]);
  const profile = state.data && adminRecord(state.data.profile);
  const latest = state.data?.latestAudit && adminRecord(state.data.latestAudit);
  const usage = state.data?.usage;
  return <DetailDrawer title="Account details and usage" onClose={onClose}>
    <DataNotice {...state} />
    {state.loading && !profile ? <Loading /> : profile && usage ? <>
      <DetailFields fields={[[ 'Name', profile.displayName || profile.fullName ], ['Email', profile.email], ['Account ID', profile.id], ['Role', profile.role], ['Plan', profile.plan], ['Subscription', profile.subscriptionStatus], ['Access', profile.disabled ? 'Suspended' : 'Active'], ...(profile.disabled ? [['Suspension reason', profile.disabledReason] as [string, string]] : []), ['Created', timestamp(profile.createdAt)]]} />
      <h3 className="text-sm font-semibold">Quota and audit history</h3>
      <dl className="grid grid-cols-2 gap-4 text-sm">{[['Daily usage', `${usage.dailyUsed} / ${usage.dailyLimit}`], ['Monthly usage', `${usage.monthlyUsed} / ${usage.monthlyLimit}`], ['Queued', usage.queued], ['Running', usage.running], ['Total audits', usage.totalAudits], ['Completed', usage.completed], ['Warnings', usage.warnings], ['Failed', usage.failed]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold">{value}</dd></div>)}</dl>
      <Link className="quiet-button min-h-11" to={`/admin/audits?userId=${encodeURIComponent(id)}`}>All account audits</Link>
      {latest ? <div className="space-y-3 border-t border-border pt-4"><h3 className="text-sm font-semibold">Latest audit</h3><p className="break-all text-sm">{latest.domain || latest.normalizedUrl || latest.id}</p><HealthBadge status={latest.status || 'unknown'} /><DetailFields fields={[[ 'Audit mode', latest.mode || latest.effectiveMode || latest.requestedMode ], ['Overall score', latest.score], ['Audit completed', timestamp(latest.completedAt)]]} /><Link className="quiet-button min-h-11" to={`/admin/audits?auditId=${encodeURIComponent(latest.id)}&userId=${encodeURIComponent(id)}`}>Inspect latest audit</Link></div> : <p className="text-sm text-muted-foreground">No audits recorded.</p>}
    </> : null}
  </DetailDrawer>;
}
