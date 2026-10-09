import { Lock } from 'lucide-react';
import { AUDIT_MODES, getAuditModeConfig, type AuditMode } from '../../lib/audit/audit-config';

export function AuditModePicker({ value, onChange, modes, limits, loading = false }: {
  value: AuditMode;
  onChange: (mode: AuditMode) => void;
  modes: readonly AuditMode[];
  limits: Record<AuditMode, number>;
  loading?: boolean;
}) {
  return <fieldset className="audit-mode-picker">
    <legend className="sr-only">Audit type</legend>
    {AUDIT_MODES.map(mode => {
      const enabled = modes.includes(mode) || loading && mode === 'quick';
      return <label key={mode} className={`audit-mode-option ${value === mode ? 'is-selected' : ''} ${enabled ? '' : 'is-disabled'}`}>
        <input type="radio" name="audit-mode" value={mode} aria-label={getAuditModeConfig(mode).label} checked={value === mode} disabled={!enabled} onChange={() => onChange(mode)} className="sr-only" />
        <span className="flex items-center gap-1.5 font-semibold">{mode === 'quick' ? 'Quick' : mode === 'standard' ? 'Standard' : 'Deep'}{!enabled && <Lock className="h-3 w-3" aria-hidden="true" />}</span>
        <span className="text-xs text-muted-foreground">{loading ? mode === 'quick' ? 'Focused checks' : 'Plan-dependent' : enabled ? `Up to ${limits[mode]} pages` : 'Unavailable'}</span>
      </label>;
    })}
  </fieldset>;
}
