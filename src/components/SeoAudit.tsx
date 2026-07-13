import { API_ROUTES } from '../lib/api/routes';
import { getAuditAccessHeaders, getAuditStartHeaders } from '../lib/api/auth-headers';
import { createAuditSubmitGuard } from '../lib/api/audit-submit-guard';
import { safeJsonFetch } from '../lib/http/safe-json';
import { LiveAuditProgress } from './audit/LiveAuditProgress';
import React, { useState, useEffect, useRef } from 'react';
import { Activity, Play, RefreshCw, AlertTriangle, CheckCircle2, Globe, Layers, ShieldAlert, Lock } from 'lucide-react';
import { FullAuditResult, AuditIssue } from '../lib/audit/types';
import { useAuth } from '../contexts/AuthContext';
import { FormField, Notice, PageHeader, Panel, SegmentedControl } from './ui/page-system';
import { FindingRow, MetricCard } from './ui/visual-system';
import { AUDIT_TARGET_INPUT_PROPS, normalizeAuditTarget } from '../lib/url/normalize-audit-target';

export default function SeoAudit({ initialUrl }: { initialUrl?: string }) {
  const { user } = useAuth();
  const [url, setUrl] = useState(initialUrl || '');
  const [mode, setMode] = useState<'quick' | 'standard' | 'deep'>('quick');
  const [loading, setLoading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [auditResult, setAuditResult] = useState<FullAuditResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const auditStartGuardRef = useRef(createAuditSubmitGuard());
  const autoStartedRef = useRef(false);
  const plan = user?.plan || 'free';
  const canUseStandard = plan === 'paid' || plan === 'agency' || plan === 'admin';
  const canUseDeep = plan === 'agency' || plan === 'admin';

  useEffect(() => {
    if (initialUrl && !autoStartedRef.current && !loading && !jobId && !auditResult) {
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
    setAuditResult(null);
    setJobId(null);
    setError(null);

    setError(null);
    setAuditResult(null);
    setStatus('Starting audit...');
    
    try {
      const dataResp = await safeJsonFetch<any>(API_ROUTES.auditStart, {
        method: 'POST',
        headers: await getAuditStartHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ url: url.trim(), mode })
      });
      const data = dataResp.success ? dataResp.data : { success: false, error: (dataResp as any).error };
      if (!data.success) throw new Error(data.error);
      const auditId = data.data.auditId;
      setJobId(auditId);
      window.history.pushState(null, '', `/audit/live/${auditId}`);
      window.dispatchEvent(new CustomEvent('navigate-live-audit', { detail: auditId }));
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
      
      {jobId && !auditResult && (
  <LiveAuditProgress 
    auditId={jobId} 
     
    onComplete={async () => {
      try {
        const dataResp = await safeJsonFetch<any>(API_ROUTES.auditResult(jobId), { headers: await getAuditAccessHeaders() });
        const data = dataResp.success ? dataResp.data : { success: false, error: (dataResp as any).error };
        if (data.success) {
          setAuditResult(data.data);
          setJobId(null);
        }
      } catch(e) {}
    }} 
  />
)}

      {auditResult && auditResult.status === 'completed' && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Overall score" value={auditResult.overallScore} detail="Measured audit score" icon={<Activity className="h-5 w-5" />} tone={auditResult.overallScore >= 80 ? 'green' : auditResult.overallScore >= 50 ? 'yellow' : 'red'} />
            <MetricCard label="Pages checked" value={auditResult.pagesCrawled} detail="Stored page summaries" icon={<Layers className="h-5 w-5" />} />
            <MetricCard label="Fix now" value={auditResult.criticalIssues} detail="Critical findings" icon={<ShieldAlert className="h-5 w-5" />} tone={auditResult.criticalIssues ? 'red' : 'green'} />
            <MetricCard label="Open fixes" value={auditResult.allIssues.length} detail="Across checked pages" icon={<AlertTriangle className="h-5 w-5" />} tone={auditResult.allIssues.length ? 'yellow' : 'green'} />
          </div>
          
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="p-4 border-b border-border bg-muted/20 flex justify-between items-center">
              <h3 className="font-semibold text-lg">Top SEO fixes first</h3>
            </div>
            <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
              {auditResult.allIssues.length === 0 ? (
                <div className="p-8 text-center text-green-500 flex flex-col items-center gap-3">
                  <CheckCircle2 className="w-10 h-10" />
                  <p className="font-medium text-lg">No SEO fixes found on scanned pages.</p>
                </div>
              ) : (
                auditResult.allIssues
                  .sort((a, b) => {
                    const weight = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
                    return weight[b.severity] - weight[a.severity];
                  })
                  .slice(0, 50) // Show top 50 issues
                  .map((issue, i) => (
                  <div key={i} className="p-4 hover:bg-muted/30 transition-colors flex gap-4 items-start">
                    <div className={`mt-1 flex-shrink-0 ${
                      issue.severity === 'critical' ? 'text-red-500' : 
                      issue.severity === 'high' ? 'text-orange-500' : 
                      issue.severity === 'medium' ? 'text-yellow-500' : 'text-accent'
                    }`}>
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between items-start mb-1">
                        <h4 className="font-semibold text-[15px]">{issue.title}</h4>
                        <div className="flex gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded-md font-medium border ${
                            issue.severity === 'critical' ? 'bg-red-500/10 text-red-500 border-red-500/20' : 
                            issue.severity === 'high' ? 'bg-orange-500/10 text-orange-500 border-orange-500/20' : 
                            issue.severity === 'medium' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' : 
                            'bg-accent/10 text-accent border-accent/20'
                          }`}>
                            {priorityLabel(issue.severity)}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded-md bg-muted text-muted-foreground border border-border capitalize">
                            {issue.category}
                          </span>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Why it matters:</span> {issue.description}</p>
                      {issue.affectedUrl && (
                        <p className="text-xs mt-2 text-muted-foreground break-all bg-background p-1.5 rounded border border-border inline-block">
                          Page: <a href={issue.affectedUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">{issue.affectedUrl}</a>
                        </p>
                      )}
                      {issue.recommendation && (
                        <p className="mt-2 text-sm"><span className="font-medium">How to fix:</span> {issue.recommendation}</p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function priorityLabel(severity: string) {
  if (severity === 'critical') return 'FIX NOW';
  if (severity === 'high') return 'HIGH PRIORITY';
  if (severity === 'medium') return 'REVIEW SOON';
  if (severity === 'low') return 'NICE TO FIX';
  return severity.toUpperCase();
}
