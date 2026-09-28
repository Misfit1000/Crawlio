import { useState } from 'react';
import { Accessibility, CheckCircle2, Database, Download, Loader2, LockKeyhole, RefreshCw, RotateCcw, Settings as SettingsIcon, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { FormField, Notice, PageHeader, PageSection, Panel } from './ui/page-system';
import { useAuth } from '../contexts/AuthContext';
import { getAuthHeaders } from '../lib/api/auth-headers';
import { safeJsonFetch } from '../lib/http/safe-json';
import { useAccessibilityPreferences } from '../contexts/AccessibilityContext';
import { useAuditEntitlements } from '../hooks/useAuditEntitlements';
import { AUDIT_MODES, getAuditModeConfig } from '../lib/audit/audit-config';

export default function Settings() {
  const { user, logout } = useAuth();
  const { preferences: accessibility, updatePreferences: updateAccessibility, resetPreferences: resetAccessibility } = useAccessibilityPreferences();
  const auditEntitlements = useAuditEntitlements();
  const [refreshingAuditAccess, setRefreshingAuditAccess] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [accountMessage, setAccountMessage] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const planLabel = auditEntitlements.plan === 'paid' ? 'Plus' : auditEntitlements.plan === 'agency' ? 'Pro' : auditEntitlements.plan[0].toUpperCase() + auditEntitlements.plan.slice(1);

  const refreshAuditAccess = async () => {
    setRefreshingAuditAccess(true);
    await auditEntitlements.refreshAuditEntitlements().catch(() => null);
    setRefreshingAuditAccess(false);
  };

  const exportAccount = async () => {
    setExporting(true);
    setAccountError(null);
    try {
      const response = await fetch('/api/tools/me/export', { headers: await getAuthHeaders(), credentials: 'same-origin' });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message || payload?.error || 'Account export could not be created.');
      }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = 'crawlio-account-export.json';
      anchor.click();
      URL.revokeObjectURL(href);
      setAccountMessage('Account export created.');
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : 'Account export failed.');
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = async () => {
    if (deleteConfirmation !== 'DELETE') return;
    setDeleting(true);
    setAccountError(null);
    setAccountMessage(null);
    const response = await safeJsonFetch<{ success: true }>('/api/tools/me/delete', {
      method: 'POST',
      credentials: 'same-origin',
      headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ confirmation: deleteConfirmation }),
    });
    if (response.success === false) {
      setAccountError(response.error);
      setDeleting(false);
      return;
    }
    await logout().catch(() => undefined);
    window.location.assign('/');
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-9 animate-rise">
      <PageHeader
        eyebrow="Account"
        icon={SettingsIcon}
        title="Settings"
        description="Manage accessibility, review plan-controlled audit access, and control your account data."
      />

      <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="h-fit space-y-1 lg:sticky lg:top-24" aria-label="Settings sections">
          {[
            ['accessibility-preferences', Accessibility, 'Display and accessibility'],
            ['scan-preferences', ShieldCheck, 'Audit preferences'],
            ['account-plan', UserRound, 'Account and plan'],
            ['data-sources', Database, 'Data sources'],
            ['data-control', Trash2, 'Data and deletion'],
          ].map(([id, Icon, label]) => (
            <a key={id as string} href={`#${id}`} className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">
              <Icon className="h-4 w-4 text-accent" />{label as string}
            </a>
          ))}
        </nav>

        <div className="space-y-10">
          <PageSection id="accessibility-preferences" title="Display and accessibility" description="Adjust readability and motion on this device. Changes apply immediately and remain available after you return.">
            <Panel className="p-5 sm:p-6">
              <div className="grid gap-6 md:grid-cols-2">
                <FormField label="Text size" htmlFor="accessibility-text-size" hint="Large text increases the base interface size without using browser zoom.">
                  <select id="accessibility-text-size" className="suite-input" value={accessibility.textScale} onChange={(event) => updateAccessibility({ textScale: event.target.value as 'default' | 'large' })}>
                    <option value="default">Default</option>
                    <option value="large">Large</option>
                  </select>
                </FormField>
                <FormField label="Interface spacing" htmlFor="accessibility-density" hint="Compact mode reduces non-essential spacing in data-heavy workspaces.">
                  <select id="accessibility-density" className="suite-input" value={accessibility.density} onChange={(event) => updateAccessibility({ density: event.target.value as 'comfortable' | 'compact' })}>
                    <option value="comfortable">Comfortable</option>
                    <option value="compact">Compact</option>
                  </select>
                </FormField>
                <FormField label="Motion" htmlFor="accessibility-motion" hint="Reduced motion pauses decorative loops and shortens non-essential transitions.">
                  <select id="accessibility-motion" className="suite-input" value={accessibility.motion} onChange={(event) => updateAccessibility({ motion: event.target.value as 'system' | 'reduced' })}>
                    <option value="system">Follow device setting</option>
                    <option value="reduced">Reduce motion</option>
                  </select>
                </FormField>
                <FormField label="Chart contrast" htmlFor="accessibility-chart-contrast" hint="High contrast adds stronger chart colors and visible bar boundaries.">
                  <select id="accessibility-chart-contrast" className="suite-input" value={accessibility.chartContrast} onChange={(event) => updateAccessibility({ chartContrast: event.target.value as 'standard' | 'high' })}>
                    <option value="standard">Standard</option>
                    <option value="high">High contrast</option>
                  </select>
                </FormField>
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
                <p className="text-sm text-muted-foreground">Press <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">Ctrl</kbd> + <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">K</kbd> to open quick navigation.</p>
                <button type="button" className="quiet-button" onClick={resetAccessibility}><RotateCcw className="h-4 w-4" /> Reset display preferences</button>
              </div>
            </Panel>
          </PageSection>

          <PageSection
            id="scan-preferences"
            title="Audit access"
            description="These limits come from your active plan and the deployed audit engine. Administrators can change plan availability; the server enforces the values shown here."
            action={user ? (
              <button type="button" className="quiet-button" onClick={refreshAuditAccess} disabled={refreshingAuditAccess}>
                <RefreshCw className={`h-4 w-4 ${refreshingAuditAccess ? 'animate-spin' : ''}`} />
                {refreshingAuditAccess ? 'Refreshing…' : 'Refresh access'}
              </button>
            ) : undefined}
          >
            <Panel className="overflow-hidden">
              <div className="flex flex-col gap-2 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div>
                  <p className="text-sm font-semibold">{planLabel} plan</p>
                  <p className="mt-1 text-xs text-muted-foreground">Select an available mode when starting an audit. There is no separate browser-only page limit.</p>
                </div>
                <span className="w-fit rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
                  {auditEntitlements.selectableModes.length} of {AUDIT_MODES.length} modes available
                </span>
              </div>
              <div className="divide-y divide-border">
                {AUDIT_MODES.map((mode) => {
                  const config = getAuditModeConfig(mode);
                  const included = auditEntitlements.allowedModes.includes(mode) && auditEntitlements.pageLimits[mode] > 0;
                  const runtimeAvailable = auditEntitlements.availableModes.includes(mode);
                  const available = included && runtimeAvailable;
                  const reason = !included
                    ? 'Not included in the current plan.'
                    : auditEntitlements.unavailableReasons[mode] || 'Temporarily unavailable on the deployed audit engine.';
                  return (
                    <div key={mode} className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6">
                      <div className="flex min-w-0 gap-3">
                        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${available ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}>
                          {available ? <CheckCircle2 className="h-4 w-4" /> : <LockKeyhole className="h-4 w-4" />}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">{config.label}</p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">{available ? config.description : reason}</p>
                        </div>
                      </div>
                      <div className="pl-11 text-left sm:pl-0 sm:text-right">
                        <p className={`text-sm font-semibold ${available ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {included ? `Up to ${auditEntitlements.pageLimits[mode]} pages` : 'Unavailable'}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">{available ? 'Ready to run' : included ? 'Configured, engine unavailable' : 'Plan controlled'}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </PageSection>

          <PageSection id="account-plan" title="Account and plan" description="Review your current usage, plan access, and account role.">
            <Panel className="p-5 sm:p-6"><Notice tone="info">Open the Overview page to see current daily and monthly usage. Plan upgrades are shown only when a billing or administrator path is configured.</Notice></Panel>
          </PageSection>

          <PageSection id="data-sources" title="Optional data sources" description="Ranking, backlink, and search-performance views require user-provided data. Crawlio does not invent missing provider values.">
            <Panel className="p-5 sm:p-6"><Notice tone="warning" title="Provider credentials are not entered here">Use Data Imports for CSV, Google Search Console, or Bing exports. Service credentials remain server-side and are never accepted by this browser form.</Notice></Panel>
          </PageSection>

          <PageSection id="data-control" title="Data export and account deletion" description="Download your account data or permanently remove private account records.">
            <div className="space-y-5">
              {accountMessage && <Notice tone="success">{accountMessage}</Notice>}
              {accountError && <Notice tone="danger">{accountError}</Notice>}
              <Panel className="p-5 sm:p-6">
                <h3 className="text-base font-semibold">Export account data</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Exports profile details, projects, imported keyword records, competitors, and up to 500 recent audit summaries. Complete raw HTML is never included.</p>
                <button type="button" onClick={exportAccount} disabled={!user || exporting} className="quiet-button mt-4"><Download className="h-4 w-4" />{exporting ? 'Preparing export…' : 'Download JSON export'}</button>
              </Panel>
              <Panel className="border-red-500/25 p-5 sm:p-6">
                <h3 className="text-base font-semibold text-red-600 dark:text-red-400">Delete account permanently</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">This removes private audits, findings, projects, imports, and the sign-in account. Required administrator/security records are de-identified rather than reassigned. Sign in again first if your session is older than 30 minutes.</p>
                <FormField label="Type DELETE to confirm" htmlFor="delete-account-confirmation">
                  <input id="delete-account-confirmation" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} className="suite-input max-w-sm" autoComplete="off" />
                </FormField>
                <button type="button" onClick={deleteAccount} disabled={!user || deleting || deleteConfirmation !== 'DELETE'} className="mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">
                  {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}{deleting ? 'Deleting account…' : 'Delete account'}
                </button>
              </Panel>
            </div>
          </PageSection>
        </div>
      </div>
    </div>
  );
}
