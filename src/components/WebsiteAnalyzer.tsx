import { API_ROUTES } from '../lib/api/routes';
import { getAuditStartHeaders } from '../lib/api/auth-headers';
import { createAuditSubmitGuard } from '../lib/api/audit-submit-guard';
import { safeJsonFetch } from '../lib/http/safe-json';
import React, { useEffect, useRef, useState } from 'react';
import { Globe, Loader2, FileText, AlertTriangle, Search, Link2, ShieldCheck, Route } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import { FormField, Notice, PageHeader, PageSection, Panel, SegmentedControl } from './ui/page-system';
import { AUDIT_TARGET_INPUT_PROPS, normalizeAuditTarget } from '../lib/url/normalize-audit-target';

export default function WebsiteAnalyzer() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<'quick' | 'standard' | 'deep'>('standard');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const auditStartGuardRef = useRef(createAuditSubmitGuard());
  const plan = user?.plan || 'free';
  const canUseStandard = plan === 'paid' || plan === 'agency' || plan === 'admin';
  const canUseDeep = plan === 'agency' || plan === 'admin';
  const freeMiniTools = [
    { title: 'Title and description checker', text: 'Review title, meta description, and Google-style preview quality.', icon: Search },
    { title: 'SERP preview checker', text: 'See if the page snippet is clear before users click.', icon: FileText },
    { title: 'Redirect and status checker', text: 'Check final URL, status code, response timing, and redirect health.', icon: Route },
    { title: 'Sitemap and search access checker', text: 'Review sitemap and search engine access signals.', icon: Link2 },
    { title: 'Passive Security Review', text: 'Check HTTPS and public browser protection signals without attack testing.', icon: ShieldCheck },
  ];

  useEffect(() => {
    if (mode === 'standard' && !canUseStandard) setMode('quick');
    if (mode === 'deep' && !canUseDeep) setMode('quick');
  }, [canUseDeep, canUseStandard, mode]);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeAuditTarget(url);
    if (!normalized.isValid) {
      setError(normalized.error || 'Enter a valid public website or domain.');
      return;
    }
    if (!auditStartGuardRef.current.begin()) return;

    setLoading(true);
    setError(null);

    try {
      const dataResp = await safeJsonFetch<any>(API_ROUTES.websiteAnalyze, {
        method: 'POST',
        headers: await getAuditStartHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ url: url.trim(), mode })
      });
      const data = dataResp.success ? dataResp.data : { success: false, error: (dataResp as any).error };
      if (!data.success) throw new Error(data.error || 'Failed to analyze website');
      
      const nextAuditId = data.data.auditId;
      navigate(`/audit/live/${encodeURIComponent(nextAuditId)}?section=overview`);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    } finally {
      auditStartGuardRef.current.end();
    }
  };

  return (
    <div className="w-full space-y-9 animate-rise">
      <PageHeader eyebrow="Website health" icon={Globe} title="Website scan" description="Review page delivery, redirects, response signals, search access, and the fixes that matter most." />

      <Panel className="p-5 sm:p-7">
        <form onSubmit={handleAnalyze} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_auto]">
            <FormField label="Website URL" htmlFor="website-scan-url">
              <div className="relative"><Globe className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" /><input id="website-scan-url" {...AUDIT_TARGET_INPUT_PROPS} value={url} onChange={e => setUrl(e.target.value)} className="suite-input pl-10" /></div>
            </FormField>
            <FormField label="Scan type">
              <SegmentedControl<'quick' | 'standard' | 'deep'> label="Scan type" value={mode} onChange={setMode} options={[{ value: 'quick', label: 'Quick' }, { value: 'standard', label: 'Full', disabled: !canUseStandard }, { value: 'deep', label: 'Deep', disabled: !canUseDeep }]} />
            </FormField>
          </div>
          <button type="submit" disabled={loading || !url.trim()} className="trust-button w-full lg:w-auto">
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Globe className="h-5 w-5" />}{loading ? 'Starting scan...' : 'Start scan'}
          </button>
        </form>
        {mode === 'deep' && <Notice tone="warning" className="mt-5">Deep scans require eligible plan access and available audit engine capacity.</Notice>}
      </Panel>

      <PageSection title="Included quick checks" description="These checks all start the same real quick-audit workflow; the cards explain coverage and are intentionally not duplicate buttons.">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {freeMiniTools.map((tool) => {
          const Icon = tool.icon;
          return (
            <Panel
              key={tool.title}
              className="p-5"
            >
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="font-semibold">{tool.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{tool.text}</p>
            </Panel>
          );
        })}
      </div>
      </PageSection>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl flex items-center gap-2">
          <AlertTriangle className="w-5 h-5" /> {error}
        </div>
      )}

    </div>
  );
}
