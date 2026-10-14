import { Gauge,Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { AUDIT_MODES, type AuditMode } from '../../lib/audit/audit-config';
import { planPageCeiling } from '../../lib/audit/scalable-policy';
import type { ActionResult, AdminRecord } from '../../lib/admin/types';
import { adminGet, adminPost, adminRecord } from './client';
import { ActionFeedback, DataNotice } from './operations-shared';
import { Notice } from '../ui/page-system';
import { useAdminActionReason } from './AdminActionDialog';
import { useAdminData } from './useAdminData';


import { Loading,NumberInput,Panel } from './shared';
export default function AdminPlans(_props: { adminUserId: string }) {
  const requestAdminReason = useAdminActionReason();
  const plans = useAdminData(async signal => (await adminGet<AdminRecord[]>('plans', signal)).map(adminRecord), []);
  const [updatingPlan, setUpdatingPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const busy = useRef(false);
  const update = async (plan: string, key: string, value: number | boolean | AuditMode[]) => {
    await applyPatch(plan, { [key]: value });
  };
  const applyPatch = async (plan: string, patch: Record<string, unknown>) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const current = plans.data?.find(row => row.plan === plan);
      const reason = await requestAdminReason(`changing the ${plan} plan limits`, { changes: Object.entries(patch).map(([key, value]) => ({ label: key.replace(/[A-Z]/g, letter => ` ${letter.toLowerCase()}`), before: current?.[key], after: value })), warning: 'This changes entitlements for all accounts on the plan. Roles and suspension are not changed.' });
      if (!reason) return;
      setUpdatingPlan(plan); setError(null); setResult(null);
      const row = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`), value]));
      const next = await adminPost<ActionResult>(`plans/${encodeURIComponent(plan)}`, { patch: row, reason });
      setResult(next);
      await plans.refresh();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Plan limit update failed.');
    } finally {
      setUpdatingPlan(null);
      busy.current = false;
    }
  };
  const toggleMode = (plan: any, mode: AuditMode, checked: boolean) => {
    const current = Array.isArray(plan.allowedModes) ? plan.allowedModes.filter((value: unknown): value is AuditMode => AUDIT_MODES.includes(value as AuditMode)) : [];
    const next = AUDIT_MODES.filter((value) => value === mode ? checked : current.includes(value));
    void update(plan.plan, 'allowedModes', next);
  };
  if (plans.loading && !plans.data) return <Loading />;
  return (
    <Panel title="Plan limits" icon={Gauge}>
      <DataNotice {...plans} />
      {error && <Notice tone="danger" className="mb-4">{error}</Notice>}
      {result && <div className="mb-4"><ActionFeedback result={result} /></div>}
      <div className="admin-plan-grid grid gap-8 md:grid-cols-2">
        {(plans.data || []).map((plan: AdminRecord) => <article key={plan.plan} className="admin-plan min-w-0 rounded-lg border border-border bg-card p-6">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0"><h3 className="break-words text-xl font-semibold">{updatingPlan === plan.plan && <Loader2 className="mr-2 inline h-4 w-4 animate-spin text-accent" />}{plan.label || plan.plan}</h3><p className="mt-2 text-xs text-muted-foreground">Configurable ceiling: {planPageCeiling(plan.plan).toLocaleString()} pages</p></div>
            <label className="text-xs text-muted-foreground">Preset<select aria-label={`${plan.plan} limit preset`} value="" disabled={Boolean(updatingPlan)} onChange={event => { const preset = event.target.value; if (preset === 'quick') void applyPatch(plan.plan, { allowedModes: ['quick'], maxPagesStandard: 0, maxPagesDeep: 0 }); else if (preset === 'pause') void applyPatch(plan.plan, { dailyAudits: 0, monthlyAudits: 0 }); }} className="suite-input mt-2 min-h-11 w-auto text-sm"><option value="">Choose preset</option><option value="quick">Quick only</option><option value="pause">Pause quotas</option></select></label>
          </header>
          <fieldset className="mt-6 grid grid-cols-3 gap-4"><legend className="sr-only">{plan.label || plan.plan} quota and priority</legend>
            <label className="admin-plan-number flex min-w-0 flex-col gap-3 text-xs text-muted-foreground"><span>Daily audits</span><NumberInput fullWidth label={`${plan.label || plan.plan} daily audits`} value={plan.dailyAudits} disabled={updatingPlan === plan.plan} onBlur={(value) => update(plan.plan, 'dailyAudits', value)} /></label>
            <label className="admin-plan-number flex min-w-0 flex-col gap-3 text-xs text-muted-foreground"><span>Monthly audits</span><NumberInput fullWidth label={`${plan.label || plan.plan} monthly audits`} value={plan.monthlyAudits} disabled={updatingPlan === plan.plan} onBlur={(value) => update(plan.plan, 'monthlyAudits', value)} /></label>
            <label className="admin-plan-number flex min-w-0 flex-col gap-3 text-xs text-muted-foreground"><span>Queue priority</span><NumberInput fullWidth label={`${plan.label || plan.plan} queue priority`} value={plan.priority} max={1000} disabled={updatingPlan === plan.plan} onBlur={(value) => update(plan.plan, 'priority', value)} /></label>
          </fieldset>
          <fieldset className="mt-6 border-t border-border pt-5"><legend className="sr-only">{plan.label || plan.plan} audit modes and page limits</legend>
            <div className="mb-2 flex justify-between text-xs text-muted-foreground"><span>Available modes</span><span>Pages per audit</span></div>
            {AUDIT_MODES.map(mode => {
              const field = mode === 'quick' ? 'maxPagesQuick' : mode === 'standard' ? 'maxPagesStandard' : 'maxPagesDeep';
              return <div key={mode} className="flex items-center justify-between gap-4 py-2"><label className="flex min-h-11 items-center gap-3 text-sm capitalize"><input type="checkbox" checked={Array.isArray(plan.allowedModes) && plan.allowedModes.includes(mode)} disabled={updatingPlan === plan.plan} onChange={event => toggleMode(plan, mode, event.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />{mode}</label><NumberInput label={`${plan.label || plan.plan} ${mode} page limit`} value={plan[field]} max={planPageCeiling(plan.plan)} disabled={updatingPlan === plan.plan} onBlur={value => update(plan.plan, field, value)} /></div>;
            })}
          </fieldset>
          <fieldset className="mt-5 flex flex-wrap gap-x-6 border-t border-border pt-4"><legend className="sr-only">{plan.label || plan.plan} features</legend>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(plan.exportsEnabled)} disabled={updatingPlan === plan.plan} onChange={(event) => void update(plan.plan, 'exportsEnabled', event.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />Exports</label>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(plan.pdfEnabled)} disabled={updatingPlan === plan.plan} onChange={(event) => void update(plan.plan, 'pdfEnabled', event.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />PDF</label>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(plan.scheduledAuditsEnabled)} disabled={updatingPlan === plan.plan} onChange={(event) => void update(plan.plan, 'scheduledAuditsEnabled', event.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />Scheduling</label>
          </fieldset>
        </article>)}
      </div>
    </Panel>
  );
}
