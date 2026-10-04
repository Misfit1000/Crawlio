import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Globe } from 'lucide-react';
import { useAuditLaunch } from '../../contexts/AuditLaunchContext';
import { useAuditEntitlements } from '../../hooks/useAuditEntitlements';
import { AUDIT_TARGET_INPUT_PROPS, normalizeAuditTarget } from '../../lib/url/normalize-audit-target';
import { makeAuditScope, type AuditFocus, type AuditScope } from '../../lib/audit/audit-scope';
import type { AuditMode } from '../../lib/audit/audit-config';
import type { AuditWorkspaceSection } from '../../app/routes';
import { AuditScopeControls } from '../audit/AuditScopeControls';

export default function AuditStartForm({ initialUrl = '', initialFocus = 'full', projectId, autoStart = false, fixedFocus = false, section, id: formId, onStartAudit }: {
  initialUrl?: string;
  initialFocus?: AuditFocus;
  projectId?: string | null;
  autoStart?: boolean;
  fixedFocus?: boolean;
  section?: AuditWorkspaceSection;
  id?: string;
  onStartAudit?: (url: string, mode: AuditMode, scope: AuditScope) => Promise<void> | void;
}) {
  const id = useId();
  const { startAudit } = useAuditLaunch();
  const [url, setUrl] = useState(initialUrl);
  const [scope, setScope] = useState(() => makeAuditScope(initialFocus));
  const [mode, setMode] = useState<AuditMode>('quick');
  const [optionsRequested, setOptionsRequested] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const autoStarted = useRef(false);
  const entitlements = useAuditEntitlements({ loadGuestPlan: optionsRequested });

  useEffect(() => { setUrl(initialUrl); }, [initialUrl]);
  useEffect(() => {
    if (entitlements.hasCurrentEntitlements && !entitlements.selectableModes.includes(mode) && entitlements.selectableModes[0]) setMode(entitlements.selectableModes[0]);
  }, [entitlements.hasCurrentEntitlements, entitlements.selectableModes.join(','), mode]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (submitting.current) return;
    const normalized = normalizeAuditTarget(url);
    if (!normalized.isValid) { setError(normalized.error || 'Enter a public website.'); return; }
    if (!scope.checkGroups.length) { setError('Select at least one check group in Options.'); return; }
    if (entitlements.hasCurrentEntitlements && !entitlements.selectableModes.includes(mode)) { setError('Choose an available audit depth.'); return; }
    submitting.current = true;
    setStarting(true);
    setError('');
    try {
      if (onStartAudit) await onStartAudit(url, mode, scope);
      else await startAudit({ url, mode, scope, projectId, section });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The audit could not start.'); }
    finally { submitting.current = false; setStarting(false); }
  };

  useEffect(() => {
    if (!autoStart || !initialUrl || autoStarted.current || entitlements.authLoading) return;
    autoStarted.current = true;
    void submit();
  }, [autoStart, initialUrl, entitlements.authLoading]);

  return <form id={formId} aria-label="Start a website audit" className="clarity-audit-form" onSubmit={submit} onFocusCapture={() => setOptionsRequested(true)} onPointerDownCapture={() => setOptionsRequested(true)} noValidate>
    <label htmlFor={`${id}-url`} className="sr-only">Website or domain</label>
    <div className="clarity-url-row"><Globe className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" /><input id={`${id}-url`} {...AUDIT_TARGET_INPUT_PROPS} value={url} onChange={event => setUrl(event.target.value)} aria-describedby={`${id}-scope${error ? ` ${id}-error` : ''}`} aria-invalid={Boolean(error)} placeholder="Enter your website or domain" /><button type="submit" className="trust-button" disabled={starting || !url.trim() || !scope.checkGroups.length || entitlements.hasCurrentEntitlements && !entitlements.selectableModes.includes(mode)}>Start audit <ArrowRight className="h-4 w-4" /></button></div>
    <AuditScopeControls scope={scope} onChange={setScope} mode={mode} onModeChange={setMode} modes={entitlements.selectableModes} limits={entitlements.pageLimits} loading={!entitlements.hasCurrentEntitlements} fixedFocus={fixedFocus} />
    <p id={`${id}-scope`} className="mt-3 text-xs leading-6 text-muted-foreground">{scope.focus === 'full' ? 'All eight check groups.' : scope.focus === 'custom' ? `${scope.checkGroups.length} check groups selected.` : 'Only the selected check group.'} {scope.coverage === 'page' ? 'Single-page coverage.' : 'Website coverage within your allowance.'}</p>
    {entitlements.guestPlanError && <p role="status" className="mt-2 text-xs text-[var(--warning)]">{entitlements.guestPlanError}<button type="button" onClick={entitlements.retryGuestPlan} className="ml-2 underline">Retry</button></p>}
    {entitlements.hasCurrentEntitlements && !entitlements.selectableModes.length && <p role="status" className="mt-2 text-xs text-[var(--warning)]">No audit depths are currently available. Review your plan or contact the administrator.</p>}
    {error && <p id={`${id}-error`} role="alert" className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
  </form>;
}
