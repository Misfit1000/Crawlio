import { Gauge,Loader2,RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { AUDIT_MODES, type AuditMode } from '../../lib/audit/audit-config';
import { planPageCeiling } from '../../lib/audit/scalable-policy';
import {
getPlanLimits,
updatePlanLimit
} from '../../services/supabaseDataService';
import { Notice } from '../ui/page-system';
import { useAdminActionReason } from './AdminActionDialog';
import { useAdminData } from './useAdminData';


import { Loading,NumberInput,Panel } from './shared';
export default function AdminPlans({ adminUserId }: { adminUserId: string }) {
  const requestAdminReason = useAdminActionReason();
  const plans = useAdminData(() => getPlanLimits(), []);
  const [updatingPlan, setUpdatingPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const update = async (plan: string, key: string, value: number | boolean | AuditMode[]) => {
    const reason = await requestAdminReason(`changing the ${plan} plan`);
    if (!reason) return;
    setUpdatingPlan(plan);
    setError(null);
    try {
      await updatePlanLimit(plan, { [key]: value }, adminUserId, reason);
      plans.refresh();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Plan limit update failed.');
    } finally {
      setUpdatingPlan(null);
    }
  };
  const toggleMode = (plan: any, mode: AuditMode, checked: boolean) => {
    const current = Array.isArray(plan.allowedModes) ? plan.allowedModes.filter((value: unknown): value is AuditMode => AUDIT_MODES.includes(value as AuditMode)) : [];
    const next = AUDIT_MODES.filter((value) => value === mode ? checked : current.includes(value));
    void update(plan.plan, 'allowedModes', next);
  };
  if (plans.loading) return <Loading />;
  return (
    <Panel title="Plan limits" description="Edit audit quotas, page limits, and queue priority using current supported plan fields." icon={Gauge} action={<button type="button" onClick={plans.refresh} className="quiet-button min-h-9 px-3 py-1.5 text-xs"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>}>
      {(plans.error || error) && <Notice tone="danger" className="mb-4">{plans.error || error}</Notice>}
      <div className="max-w-full overflow-x-auto rounded-lg border border-border">
        <table className="suite-table min-w-[1240px]">
          <thead><tr><th>Plan</th><th>Plan modes</th><th>Daily</th><th>Monthly</th><th>Quick pages</th><th>Standard pages</th><th>Deep pages</th><th>Priority</th><th>Features</th></tr></thead>
          <tbody>
            {(plans.data || []).map((plan: any) => (
              <tr key={plan.plan}>
                <td className="font-semibold capitalize">{updatingPlan === plan.plan && <Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin text-accent" />}{plan.label || plan.plan}</td>
                <td className="text-xs">
                  {AUDIT_MODES.map((mode) => <label key={mode} className="flex items-center gap-2 py-0.5 capitalize"><input type="checkbox" checked={Array.isArray(plan.allowedModes) && plan.allowedModes.includes(mode)} disabled={updatingPlan === plan.plan} onChange={(event) => toggleMode(plan, mode, event.target.checked)} /> {mode}</label>)}
                </td>
                <td><NumberInput label={`${plan.label || plan.plan} daily audits`} value={plan.dailyAudits} disabled={updatingPlan === plan.plan} onBlur={(value) => update(plan.plan, 'dailyAudits', value)} /></td>
                <td><NumberInput label={`${plan.label || plan.plan} monthly audits`} value={plan.monthlyAudits} disabled={updatingPlan === plan.plan} onBlur={(value) => update(plan.plan, 'monthlyAudits', value)} /></td>
                <td><NumberInput label={`${plan.label || plan.plan} Quick page limit`} value={plan.maxPagesQuick} max={planPageCeiling(plan.plan)} disabled={updatingPlan === plan.plan} onBlur={(value) => update(plan.plan, 'maxPagesQuick', value)} />{<div className="mt-1 max-w-28 text-[11px] text-muted-foreground">Maximum supported: {planPageCeiling(plan.plan)}</div>}</td>
                <td><NumberInput label={`${plan.label || plan.plan} Standard page limit`} value={plan.maxPagesStandard} max={planPageCeiling(plan.plan)} disabled={updatingPlan === plan.plan} onBlur={(value) => update(plan.plan, 'maxPagesStandard', value)} />{<div className="mt-1 max-w-28 text-[11px] text-muted-foreground">Maximum supported: {planPageCeiling(plan.plan)}</div>}</td>
                <td><NumberInput label={`${plan.label || plan.plan} Deep page limit`} value={plan.maxPagesDeep} max={planPageCeiling(plan.plan)} disabled={updatingPlan === plan.plan} onBlur={(value) => update(plan.plan, 'maxPagesDeep', value)} />{<div className="mt-1 max-w-28 text-[11px] text-muted-foreground">Maximum supported: {planPageCeiling(plan.plan)}</div>}</td>
                <td><NumberInput label={`${plan.label || plan.plan} queue priority`} value={plan.priority} max={1000} disabled={updatingPlan === plan.plan} onBlur={(value) => update(plan.plan, 'priority', value)} /></td>
                <td className="text-xs">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(plan.exportsEnabled)} disabled={updatingPlan === plan.plan} onChange={(event) => void update(plan.plan, 'exportsEnabled', event.target.checked)} /> Exports</label>
                  <label className="mt-1 flex items-center gap-2"><input type="checkbox" checked={Boolean(plan.pdfEnabled)} disabled={updatingPlan === plan.plan} onChange={(event) => void update(plan.plan, 'pdfEnabled', event.target.checked)} /> PDF</label>
                  <label className="mt-1 flex items-center gap-2"><input type="checkbox" checked={Boolean(plan.scheduledAuditsEnabled)} disabled={updatingPlan === plan.plan} onChange={(event) => void update(plan.plan, 'scheduledAuditsEnabled', event.target.checked)} /> Scheduling</label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
