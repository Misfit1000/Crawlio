import { Gauge,Loader2,RefreshCw } from 'lucide-react';
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
    <Panel title="Plan limits" description="Edit audit quotas, page limits, and queue priority using current supported plan fields." icon={Gauge} action={<button type="button" onClick={plans.refresh} className="quiet-button min-h-11 px-3 py-1.5 text-xs"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>}>
      <DataNotice {...plans} />
      {error && <Notice tone="danger" className="mb-4">{error}</Notice>}
      {result && <div className="mb-4"><ActionFeedback result={result} /></div>}
      <div className="max-w-full overflow-x-auto rounded-lg border border-border">
        <table className="suite-table min-w-[1240px]">
          <caption className="sr-only">Plan entitlements and guarded preset changes</caption>
          <thead><tr>{['Plan', 'Plan modes', 'Daily', 'Monthly', 'Quick pages', 'Standard pages', 'Deep pages', 'Priority', 'Features'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody>
            {(plans.data || []).map((plan: any) => (
              <tr key={plan.plan}>
                <th scope="row" className="font-semibold capitalize">{updatingPlan === plan.plan && <Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin text-accent" />}{plan.label || plan.plan}<label className="mt-3 block text-xs font-normal">Preset<select aria-label={`${plan.plan} limit preset`} value="" disabled={Boolean(updatingPlan)} onChange={event => { const preset = event.target.value; if (preset === 'quick') void applyPatch(plan.plan, { allowedModes: ['quick'], maxPagesStandard: 0, maxPagesDeep: 0 }); else if (preset === 'pause') void applyPatch(plan.plan, { dailyAudits: 0, monthlyAudits: 0 }); }} className="suite-input mt-1 min-h-11 w-auto text-xs"><option value="">Choose preset</option><option value="quick">Quick only</option><option value="pause">Pause quotas</option></select></label></th>
                <td className="text-xs">
                  {AUDIT_MODES.map((mode) => <label key={mode} className="flex min-h-11 items-center gap-2 capitalize"><input type="checkbox" checked={Array.isArray(plan.allowedModes) && plan.allowedModes.includes(mode)} disabled={updatingPlan === plan.plan} onChange={(event) => toggleMode(plan, mode, event.target.checked)} /> {mode}</label>)}
                </td>
                <td><NumberInput label={`${plan.label || plan.plan} daily audits`} value={plan.dailyAudits} disabled={updatingPlan === plan.plan} onBlur={(value) => update(plan.plan, 'dailyAudits', value)} /></td>
                <td><NumberInput label={`${plan.label || plan.plan} monthly audits`} value={plan.monthlyAudits} disabled={updatingPlan === plan.plan} onBlur={(value) => update(plan.plan, 'monthlyAudits', value)} /></td>
                <td><NumberInput label={`${plan.label || plan.plan} Quick page limit`} value={plan.maxPagesQuick} max={planPageCeiling(plan.plan)} disabled={updatingPlan === plan.plan} onBlur={(value) => update(plan.plan, 'maxPagesQuick', value)} />{<div className="mt-1 max-w-28 text-[11px] text-muted-foreground">Maximum supported: {planPageCeiling(plan.plan)}</div>}</td>
                <td><NumberInput label={`${plan.label || plan.plan} Standard page limit`} value={plan.maxPagesStandard} max={planPageCeiling(plan.plan)} disabled={updatingPlan === plan.plan} onBlur={(value) => update(plan.plan, 'maxPagesStandard', value)} />{<div className="mt-1 max-w-28 text-[11px] text-muted-foreground">Maximum supported: {planPageCeiling(plan.plan)}</div>}</td>
                <td><NumberInput label={`${plan.label || plan.plan} Deep page limit`} value={plan.maxPagesDeep} max={planPageCeiling(plan.plan)} disabled={updatingPlan === plan.plan} onBlur={(value) => update(plan.plan, 'maxPagesDeep', value)} />{<div className="mt-1 max-w-28 text-[11px] text-muted-foreground">Maximum supported: {planPageCeiling(plan.plan)}</div>}</td>
                <td><NumberInput label={`${plan.label || plan.plan} queue priority`} value={plan.priority} max={1000} disabled={updatingPlan === plan.plan} onBlur={(value) => update(plan.plan, 'priority', value)} /></td>
                <td className="text-xs">
                  <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={Boolean(plan.exportsEnabled)} disabled={updatingPlan === plan.plan} onChange={(event) => void update(plan.plan, 'exportsEnabled', event.target.checked)} /> Exports</label>
                  <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={Boolean(plan.pdfEnabled)} disabled={updatingPlan === plan.plan} onChange={(event) => void update(plan.plan, 'pdfEnabled', event.target.checked)} /> PDF</label>
                  <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={Boolean(plan.scheduledAuditsEnabled)} disabled={updatingPlan === plan.plan} onChange={(event) => void update(plan.plan, 'scheduledAuditsEnabled', event.target.checked)} /> Scheduling</label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
