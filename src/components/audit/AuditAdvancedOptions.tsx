import { useId } from 'react';
import { AUDIT_CHECK_GROUPS, AUDIT_GROUP_DETAILS, makeAuditScope, type AuditCheckGroup, type AuditScope } from '../../lib/audit/audit-scope';
import { getAuditModeConfig, type AuditMode } from '../../lib/audit/audit-config';
import { AuditModePicker } from './AuditModePicker';

export default function AuditAdvancedOptions({scope,onChange,mode,onModeChange,modes,limits,loading}: {
  scope: AuditScope; onChange: (scope: AuditScope) => void; mode: AuditMode; onModeChange: (mode: AuditMode) => void;
  modes: readonly AuditMode[]; limits: Record<AuditMode,number>; loading: boolean;
}) {
  const id=useId();
  const toggleGroup=(group:AuditCheckGroup,checked:boolean) => onChange(makeAuditScope('custom',scope.coverage,
    checked ? [...scope.checkGroups,group] : scope.checkGroups.filter(value=>value!==group)));
  return <div className="space-y-5 pt-4">
    <div><p className="mb-2 text-sm font-semibold">Audit depth</p><AuditModePicker value={mode} onChange={onModeChange} modes={modes} limits={limits} loading={loading} /><p className="mt-2 text-xs leading-6 text-muted-foreground">{getAuditModeConfig(mode).description}</p></div>
    <fieldset><legend className="mb-2 text-sm font-semibold">Coverage</legend><div className="flex flex-wrap gap-3">{(['page','site'] as const).map(coverage=><label key={coverage} className="flex min-h-10 items-center gap-2 rounded-md border border-border px-3 text-sm"><input type="radio" name={`${id}-coverage`} checked={scope.coverage===coverage} onChange={()=>onChange({...scope,coverage})} />{coverage==='page'?'This page':'Website'}</label>)}</div><p className="mt-2 text-xs leading-6 text-muted-foreground">{scope.coverage==='page'?'Check the submitted page without following internal pages.':'Follow discoverable pages within your plan and selected depth.'}</p></fieldset>
    {scope.focus==='custom' && <fieldset><legend className="mb-3 text-sm font-semibold">Check groups</legend><div className="grid gap-3 sm:grid-cols-2">{AUDIT_CHECK_GROUPS.map(group=><label key={group} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={scope.checkGroups.includes(group)} onChange={event=>toggleGroup(group,event.target.checked)} /><span>{AUDIT_GROUP_DETAILS[group].label}</span></label>)}</div></fieldset>}
  </div>;
}
