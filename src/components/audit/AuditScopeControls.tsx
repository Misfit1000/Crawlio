import { lazy, Suspense, useId } from 'react';
import { AUDIT_CHECK_GROUPS, AUDIT_GROUP_DETAILS, makeAuditScope, type AuditFocus, type AuditScope } from '../../lib/audit/audit-scope';
import { getAuditModeConfig, type AuditMode } from '../../lib/audit/audit-config';
import { AuditModePicker } from './AuditModePicker';
const AuditAdvancedOptions = lazy(() => import('./AuditAdvancedOptions'));

export function AuditScopeControls({ scope, onChange, mode, onModeChange, modes, limits, loading, fixedFocus = false }: {
  scope: AuditScope;
  onChange: (scope: AuditScope) => void;
  mode: AuditMode;
  onModeChange: (mode: AuditMode) => void;
  modes: readonly AuditMode[];
  limits: Record<AuditMode, number>;
  loading: boolean;
  fixedFocus?: boolean;
}) {
  const id = useId();
  const changeFocus = (focus: AuditFocus) => {
    onChange(makeAuditScope(focus));
  };

  return <div className="audit-scope-controls">
    <div className="audit-choice-row">{!fixedFocus && <div className="audit-focus-field"><label htmlFor={`${id}-focus`}>Focus</label><select id={`${id}-focus`} className="suite-input" value={scope.focus} onChange={event => changeFocus(event.target.value as AuditFocus)}>
      <option value="full">Full audit</option>
      {AUDIT_CHECK_GROUPS.map(group => <option key={group} value={group}>{AUDIT_GROUP_DETAILS[group].label}</option>)}
      <option value="custom">Custom checks</option>
    </select></div>}
    <fieldset className="audit-coverage-field"><legend>Coverage</legend><div className="audit-coverage-options">{(['page', 'site'] as const).map(coverage => <label key={coverage} data-selected={scope.coverage === coverage}><input type="radio" name={`${id}-coverage`} checked={scope.coverage === coverage} onChange={() => onChange({ ...scope, coverage })} />{coverage === 'page' ? 'This page' : 'Website'}</label>)}</div></fieldset></div>
    <div className="audit-depth-field"><p className="text-sm font-semibold">Depth</p><AuditModePicker value={mode} onChange={onModeChange} modes={modes} limits={limits} loading={loading} coverage={scope.coverage} /><p className="audit-depth-description">{getAuditModeConfig(mode).description}</p></div>
    {scope.focus === 'custom' && <Suspense fallback={<p role="status" className="py-4 text-sm">Loading check groups...</p>}><AuditAdvancedOptions {...{scope,onChange,mode,onModeChange,modes,limits,loading}} /></Suspense>}
  </div>;
}
