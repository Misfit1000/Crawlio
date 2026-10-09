import { Lock } from 'lucide-react';
import { useId } from 'react';
import { AUDIT_MODES, getAuditModeConfig, type AuditMode } from '../../lib/audit/audit-config';

export function AuditModePicker({ value, onChange, modes, limits, loading = false, coverage = 'site' }: {
  value: AuditMode;
  onChange: (mode: AuditMode) => void;
  modes: readonly AuditMode[];
  limits: Record<AuditMode, number>;
  loading?: boolean;
  coverage?: 'page' | 'site';
}) {
  const id = useId();
  return <fieldset className="audit-mode-picker">
    <legend className="sr-only">Audit depth</legend>
    {AUDIT_MODES.map(mode => {
      const enabled = modes.includes(mode) || loading && mode === 'quick';
      return <label key={mode} className={`audit-mode-option ${value === mode ? 'is-selected' : ''} ${enabled ? '' : 'is-disabled'}`}>
        <input type="radio" name={`${id}-audit-mode`} value={mode} aria-label={getAuditModeConfig(mode).label} checked={value === mode} disabled={!enabled} onChange={() => onChange(mode)} className="sr-only" />
        <span className="flex items-center gap-1.5 font-semibold">{mode === 'quick' ? 'Quick' : mode === 'standard' ? 'Standard' : 'Deep'}{!enabled && <Lock className="h-3 w-3" aria-hidden="true" />}</span>
        <span className="text-xs text-muted-foreground">{loading ? 'Plan allowance' : enabled ? coverage === 'page' ? '1 page' : `Up to ${limits[mode].toLocaleString()} pages` : 'Not in your plan'}</span>
      </label>;
    })}
  </fieldset>;
}
