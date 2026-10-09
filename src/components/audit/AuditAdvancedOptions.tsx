import { useId } from 'react';
import { AUDIT_CHECK_GROUPS, AUDIT_GROUP_DETAILS, makeAuditScope, type AuditCheckGroup, type AuditScope } from '../../lib/audit/audit-scope';
import type { AuditMode } from '../../lib/audit/audit-config';

export default function AuditAdvancedOptions({scope,onChange}: {
  scope: AuditScope; onChange: (scope: AuditScope) => void; mode: AuditMode; onModeChange: (mode: AuditMode) => void;
  modes: readonly AuditMode[]; limits: Record<AuditMode,number>; loading: boolean;
}) {
  const id=useId();
  const toggleGroup=(group:AuditCheckGroup,checked:boolean) => onChange(makeAuditScope('custom',scope.coverage,
    checked ? [...scope.checkGroups,group] : scope.checkGroups.filter(value=>value!==group)));
  return <div className="pt-4">
    <fieldset aria-describedby={`${id}-hint`}><legend className="mb-3 text-sm font-semibold">Check groups</legend><div className="grid gap-2 sm:grid-cols-2">{AUDIT_CHECK_GROUPS.map(group=><label key={group} className="flex min-h-11 items-center gap-3 rounded-lg bg-muted px-3 text-sm"><input type="checkbox" checked={scope.checkGroups.includes(group)} onChange={event=>toggleGroup(group,event.target.checked)} /><span>{AUDIT_GROUP_DETAILS[group].label}</span></label>)}</div><p id={`${id}-hint`} className="mt-2 text-xs text-muted-foreground">Select at least one group.</p></fieldset>
  </div>;
}
