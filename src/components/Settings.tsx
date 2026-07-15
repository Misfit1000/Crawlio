import { useState } from 'react';
import { Database, Download, Loader2, Save, Settings as SettingsIcon, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { FormField, Notice, PageHeader, PageSection, Panel } from './ui/page-system';
import { useAuth } from '../contexts/AuthContext';
import { getAuthHeaders } from '../lib/api/auth-headers';
import { safeJsonFetch } from '../lib/http/safe-json';

const SETTINGS_KEY = 'crawlio_preferences';
const LEGACY_SETTINGS_KEY = 'seointel_preferences';

function readPreferences() {
  try {
    return { maxPages: 25, engineName: 'CrawlioBot/1.0', ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || localStorage.getItem(LEGACY_SETTINGS_KEY) || '{}') };
  } catch {
    return { maxPages: 25, engineName: 'CrawlioBot/1.0' };
  }
}

export default function Settings() {
  const { user, logout } = useAuth();
  const [preferences, setPreferences] = useState(readPreferences);
  const [saved, setSaved] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [accountMessage, setAccountMessage] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);

  const save = () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(preferences));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 3000);
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
        description="Manage browser preferences and understand which product settings are controlled by your plan or deployment."
        actions={<button type="button" onClick={save} className="trust-button"><Save className="h-4 w-4" /> Save preferences</button>}
      />

      {saved && <Notice tone="success" title="Preferences saved">These browser settings will be used on this device.</Notice>}

      <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="h-fit space-y-1 lg:sticky lg:top-24" aria-label="Settings sections">
          {[
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
          <PageSection id="scan-preferences" title="Audit preferences" description="Local defaults for starting an audit. Server-enforced plan limits always take priority.">
            <Panel className="grid gap-5 p-5 sm:p-6 md:grid-cols-2">
              <FormField label="Preferred full-audit page limit" htmlFor="max-pages" hint="Your active plan and audit-engine capacity may apply a lower limit.">
                <input id="max-pages" type="number" min={1} max={500} value={preferences.maxPages} onChange={(event) => setPreferences((value) => ({ ...value, maxPages: Number(event.target.value) }))} className="suite-input" />
              </FormField>
              <FormField label="Audit engine label" htmlFor="engine-name" hint="Used only as a local display preference; it does not change the deployed engine identity.">
                <input id="engine-name" type="text" value={preferences.engineName} onChange={(event) => setPreferences((value) => ({ ...value, engineName: event.target.value }))} className="suite-input" />
              </FormField>
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
