import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Globe } from 'lucide-react';
import { FormField, Notice, PageHeader } from './ui/page-system';
import { AUDIT_TARGET_INPUT_PROPS, normalizeAuditTarget } from '../lib/url/normalize-audit-target';
import { getAuditModeConfig, type AuditMode } from '../lib/audit/audit-config';
import { useAuditEntitlements } from '../hooks/useAuditEntitlements';
import { useAuditLaunch } from '../contexts/AuditLaunchContext';
import { AuditModePicker } from './audit/AuditModePicker';

export default function SeoAudit({ initialUrl }: { initialUrl?: string }) {
  const { startAudit: launchAudit } = useAuditLaunch();
  const { authLoading, pageLimits, selectableModes, hasCurrentEntitlements, guestPlanError, retryGuestPlan } = useAuditEntitlements();
  const [url, setUrl] = useState(initialUrl || '');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [mode, setMode] = useState<AuditMode>('quick');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoStarted = useRef(false);

  useEffect(() => {
    if (initialUrl) return;
    const prefill = localStorage.getItem('crawlio_prefill_audit_url');
    const linkedProject = localStorage.getItem('crawlio_prefill_project_id');
    if (prefill) setUrl(prefill);
    if (linkedProject) setProjectId(linkedProject);
    localStorage.removeItem('crawlio_prefill_audit_url');
    localStorage.removeItem('crawlio_prefill_project_id');
  }, [initialUrl]);
  useEffect(() => {
    if (hasCurrentEntitlements && !selectableModes.includes(mode) && selectableModes[0]) setMode(selectableModes[0]);
  }, [hasCurrentEntitlements, mode, selectableModes.join(',')]);
  useEffect(() => {
    if (initialUrl && !autoStarted.current && !authLoading) {
      autoStarted.current = true;
      void submit();
    }
  }, [initialUrl, authLoading]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (loading) return;
    const normalized = normalizeAuditTarget(url);
    if (!normalized.isValid) { setError(normalized.error || 'Enter a public website.'); return; }
    setLoading(true);
    setError(null);
    try { await launchAudit({ url, mode, projectId, section: 'seo' }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The audit could not start.'); }
    finally { setLoading(false); }
  };

  return <div className="mx-auto w-full max-w-3xl space-y-7">
    <PageHeader title="Start a website audit" />
    <form onSubmit={submit} noValidate className="space-y-5">
      <FormField label="Website or domain" htmlFor="audit-url">
        <div className="relative"><Globe className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" /><input id="audit-url" {...AUDIT_TARGET_INPUT_PROPS} value={url} onChange={event => setUrl(event.target.value)} className="suite-input pl-10" autoFocus /></div>
      </FormField>
      <AuditModePicker value={mode} onChange={setMode} modes={selectableModes} limits={pageLimits} loading={!hasCurrentEntitlements} />
      <p className="text-sm text-muted-foreground">{getAuditModeConfig(mode).description}</p>
      {guestPlanError && <Notice tone="warning">{guestPlanError}<button type="button" className="ml-2 font-semibold underline" onClick={retryGuestPlan}>Retry</button></Notice>}
      {hasCurrentEntitlements && !selectableModes.length && <Notice tone="warning">No audit type is currently available. Review your plan or contact the administrator.</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      <button type="submit" disabled={loading || !url.trim() || hasCurrentEntitlements && !selectableModes.includes(mode)} className="trust-button">Start audit <ArrowRight className="h-4 w-4" /></button>
    </form>
    <details className="border-t border-border py-4"><summary className="cursor-pointer text-sm font-semibold">What gets checked</summary><ul className="mt-4 grid gap-3 text-sm text-muted-foreground sm:grid-cols-2"><li>Titles, headings and metadata</li><li>Crawlability and internal links</li><li>Status codes and redirects</li><li>Response and page-size observations</li><li>Structured data and accessibility signals</li><li>Passive browser security</li></ul></details>
  </div>;
}
