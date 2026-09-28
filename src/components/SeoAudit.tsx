import { API_ROUTES } from '../lib/api/routes';
import { getAuditStartHeaders } from '../lib/api/auth-headers';
import { createAuditSubmitGuard } from '../lib/api/audit-submit-guard';
import { safeJsonFetch } from '../lib/http/safe-json';
import React, { useState, useEffect, useRef } from 'react';
import { Activity, Play, RefreshCw, CheckCircle2, Globe, Lock } from 'lucide-react';
import { useNavigate } from '../app/router';
import { FormField, Notice, PageHeader, Panel, SegmentedControl } from './ui/page-system';
import { AUDIT_TARGET_INPUT_PROPS, normalizeAuditTarget } from '../lib/url/normalize-audit-target';
import { AUDIT_MODES, getAuditModeConfig, type AuditMode } from '../lib/audit/audit-config';
import { useAuditEntitlements } from '../hooks/useAuditEntitlements';

export default function SeoAudit({ initialUrl }: { initialUrl?: string }) {
  const navigate = useNavigate();
  const {
    user, authLoading, refreshAuditEntitlements, plan, allowedModes, availableModes,
    pageLimits, selectableModes, unavailableReasons,
  } = useAuditEntitlements();
  const [url, setUrl] = useState(initialUrl || '');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [mode, setMode] = useState<AuditMode>('quick');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const auditStartGuardRef = useRef(createAuditSubmitGuard());
  const autoStartedRef = useRef(false);

  useEffect(() => {
    if (initialUrl) return;
    const prefill = window.localStorage.getItem('crawlio_prefill_audit_url');
    const linkedProjectId = window.localStorage.getItem('crawlio_prefill_project_id');
    if (prefill) setUrl(prefill);
    if (linkedProjectId) setProjectId(linkedProjectId);
    window.localStorage.removeItem('crawlio_prefill_audit_url');
    window.localStorage.removeItem('crawlio_prefill_project_id');
  }, [initialUrl]);

  useEffect(() => {
    if (initialUrl && !autoStartedRef.current && !loading && !authLoading) {
      autoStartedRef.current = true;
      void startAudit();
    }
  }, [authLoading, initialUrl, loading]);

  useEffect(() => {
    if (!selectableModes.includes(mode) && selectableModes[0]) setMode(selectableModes[0]);
  }, [availableModes.join(','), allowedModes.join(','), mode, pageLimits.quick, pageLimits.standard, pageLimits.deep]);

  const startAudit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const normalized = normalizeAuditTarget(url);
    if (!normalized.isValid) {
      setError(normalized.error || 'Enter a valid public website or domain.');
      return;
    }
    if (!auditStartGuardRef.current.begin()) return;
    
    setLoading(true);
    setError(null);
    
    try {
      if (user) {
        const latest = await refreshAuditEntitlements();
        if (!latest?.allowedModes.includes(mode)) throw new Error(`${getAuditModeConfig(mode).label} is not enabled for your current plan.`);
        if (!latest.availableModes.includes(mode)) throw new Error(latest.unavailableReasons[mode] || `${getAuditModeConfig(mode).label} is temporarily unavailable.`);
      }
      const dataResp = await safeJsonFetch<any>(API_ROUTES.auditStart, {
        method: 'POST',
        headers: await getAuditStartHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ url: url.trim(), mode, projectId })
      });
      const data = dataResp.success ? dataResp.data : { success: false, error: (dataResp as any).error };
      if (!data.success) throw new Error(data.error);
      const auditId = data.data.auditId;
      navigate(`/audit/live/${encodeURIComponent(auditId)}?section=seo`);
    } catch(err: any) {
      setError(err.message);
      setLoading(false);
    } finally {
      auditStartGuardRef.current.end();
    }
  };

  return (
    <div className="w-full space-y-9 animate-rise">
      <PageHeader eyebrow="Start audit" icon={Activity} title="Audit a website" description="Run a live review of on-page SEO, technical delivery, search access, page health, and passive browser protections." />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <Panel className="p-5 sm:p-7">
          <form onSubmit={startAudit} noValidate className="space-y-6">
            <FormField label="Website URL" htmlFor="audit-url" hint="Use the public homepage or a specific page. Redirects and the final URL are recorded by the audit engine.">
              <div className="relative">
                <Globe className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <input id="audit-url" {...AUDIT_TARGET_INPUT_PROPS} value={url} onChange={e => setUrl(e.target.value)} className="suite-input pl-10" />
              </div>
            </FormField>
            <FormField label="Audit type" hint="Unavailable modes stay locked to protect plan limits and audit-engine capacity.">
              <SegmentedControl<AuditMode>
                label="Audit type"
                value={mode}
                onChange={setMode}
                options={AUDIT_MODES.map((candidate) => ({
                  value: candidate,
                  label: candidate === 'standard' ? 'Standard' : candidate[0].toUpperCase() + candidate.slice(1),
                  disabled: !allowedModes.includes(candidate) || !availableModes.includes(candidate) || pageLimits[candidate] < 1,
                }))}
              />
            </FormField>
            <div className="grid gap-3 sm:grid-cols-3" aria-label="Audit mode allowances">
              {AUDIT_MODES.map((candidate) => {
                const included = allowedModes.includes(candidate) && pageLimits[candidate] > 0;
                const available = included && availableModes.includes(candidate);
                const config = getAuditModeConfig(candidate);
                return <div key={candidate} className={`rounded-xl border p-3 text-sm ${mode === candidate ? 'border-accent bg-accent/5' : 'border-border bg-muted/35'} ${available ? '' : 'opacity-70'}`}>
                  <div className="flex items-center justify-between gap-2"><span className="font-semibold">{config.label}</span>{available ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Lock className="h-4 w-4 text-muted-foreground" />}</div>
                  <div className="mt-1 font-medium">{included ? `Up to ${pageLimits[candidate]} pages` : 'Not included'}</div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{included && !available ? unavailableReasons[candidate] || 'Temporarily unavailable.' : config.description}</p>
                </div>;
              })}
            </div>
            <Notice tone="info" title={`${plan === 'paid' ? 'Plus' : plan[0].toUpperCase() + plan.slice(1)} plan`}>
              {selectableModes.length
                ? `${getAuditModeConfig(mode).label} will analyse up to ${pageLimits[mode]} successfully reached page${pageLimits[mode] === 1 ? '' : 's'}. The server confirms the final allowance when the audit starts.`
                : 'No audit mode is currently available for this plan. Ask an administrator to review its mode settings.'}
            </Notice>
            <button type="submit" disabled={loading || authLoading || !url.trim() || !selectableModes.includes(mode)} className="trust-button w-full sm:w-auto">
              {loading ? <RefreshCw className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
              {loading ? 'Starting audit...' : 'Start live audit'}
            </button>
          </form>
        </Panel>

        <Panel className="p-5 sm:p-7">
          <h2 className="text-xl font-semibold">What this audit includes</h2>
          <div className="mt-5 space-y-4">
            {[
              ['On-page SEO', 'Titles, descriptions, headings, links, image text, and social metadata.'],
              ['Technical SEO', 'Status codes, redirects, preferred URLs, search access, and response signals.'],
              ['Passive security', 'HTTPS and public browser protection observations without attack traffic.'],
            ].map(([title, copy]) => (
              <div key={title} className="flex gap-3 border-b border-border pb-4 last:border-0 last:pb-0">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                <div><div className="font-semibold">{title}</div><p className="mt-1 text-sm leading-6 text-muted-foreground">{copy}</p></div>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-xl bg-muted p-4 text-sm leading-6 text-muted-foreground"><Lock className="mr-2 inline h-4 w-4" />No raw HTML is stored. Long-running work stays on the separate audit engine.</div>
        </Panel>
      </div>
      
      {error && <Notice tone="danger" title="Audit could not start">{error}</Notice>}
    </div>
  );
}
