import { lazy, Suspense, useId, useState } from 'react';
import { AUDIT_CHECK_GROUPS, AUDIT_GROUP_DETAILS, makeAuditScope, type AuditFocus, type AuditScope } from '../../lib/audit/audit-scope';
import { getAuditModeConfig, type AuditMode } from '../../lib/audit/audit-config';
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
  const [expanded, setExpanded] = useState(false);
  const changeFocus = (focus: AuditFocus) => {
    onChange(makeAuditScope(focus));
    if (focus === 'custom') setExpanded(true);
  };

  return <div className="audit-scope-controls">
    {!fixedFocus && <div className="audit-focus-field"><label htmlFor={`${id}-focus`}>Audit focus</label><select id={`${id}-focus`} className="suite-input" value={scope.focus} onChange={event => changeFocus(event.target.value as AuditFocus)}>
      <option value="full">Full audit</option>
      {AUDIT_CHECK_GROUPS.map(group => <option key={group} value={group}>{AUDIT_GROUP_DETAILS[group].label}</option>)}
      <option value="custom">Custom checks</option>
    </select></div>}
    <details className="audit-advanced-options" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>Options <span>{getAuditModeConfig(mode).label} / {scope.coverage === 'page' ? 'Single page' : 'Website'}</span></summary>
      {expanded && <Suspense fallback={<p role="status" className="py-4 text-sm">Loading options...</p>}><AuditAdvancedOptions {...{scope,onChange,mode,onModeChange,modes,limits,loading}} /></Suspense>}
    </details>
  </div>;
}
