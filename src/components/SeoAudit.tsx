import { API_ROUTES } from '../lib/api/routes';
import { getAuditStartHeaders } from '../lib/api/auth-headers';
import { createAuditSubmitGuard } from '../lib/api/audit-submit-guard';
import { safeJsonFetch } from '../lib/http/safe-json';
import React, { useState, useEffect, useRef } from 'react';
import { Activity, Play, RefreshCw, CheckCircle2, Globe, Lock } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import { FormField, Notice, PageHeader, Panel, SegmentedControl } from './ui/page-system';
import { AUDIT_TARGET_INPUT_PROPS, normalizeAuditTarget } from '../lib/url/normalize-audit-target';

export default function SeoAudit({ initialUrl }: { initialUrl?: string }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [url, setUrl] = useState(initialUrl || '');
  const [mode, setMode] = useState<'quick' | 'standard' | 'deep'>('quick');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const auditStartGuardRef = useRef(createAuditSubmitGuard());
  const autoStartedRef = useRef(false);
  const plan = user?.plan || 'free';
  const canUseStandard = plan === 'paid' || plan === 'agency' || plan === 'admin';
  const canUseDeep = plan === 'agency' || plan === 'admin';

  useEffect(() => {
    if (initialUrl && !autoStartedRef.current && !loading) {
      autoStartedRef.current = true;
      void startAudit();
    }
  }, [initialUrl]);

  useEffect(() => {
    if (mode === 'standard' && !canUseStandard) setMode('quick');
    if (mode === 'deep' && !canUseDeep) setMode('quick');
  }, [canUseDeep, canUseStandard, mode]);

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
      const dataResp = await safeJsonFetch<any>(API_ROUTES.auditStart, {
        method: 'POST',
        headers: await getAuditStartHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ url: url.trim(), mode })
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
              <SegmentedControl<'quick' | 'standard' | 'deep'>
                label="Audit type"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'quick', label: 'Quick' },
                  { value: 'standard', label: 'Full', disabled: !canUseStandard },
                  { value: 'deep', label: 'Deep', disabled: !canUseDeep },
                ]}
              />
            </FormField>
            {mode === 'deep' && <Notice tone="warning">Deep audits require an agency or admin plan and an available audit engine.</Notice>}
            {plan === 'free' && <Notice tone="info" title="Free plan">Quick audits check up to 5 pages with core SEO, technical, and passive security observations. Server-side entitlements enforce the final limit.</Notice>}
            <button type="submit" disabled={loading || !url.trim()} className="trust-button w-full sm:w-auto">
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
