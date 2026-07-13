import { API_ROUTES } from '../lib/api/routes';
import { getAuditAccessHeaders, getAuditStartHeaders } from '../lib/api/auth-headers';
import { createAuditSubmitGuard } from '../lib/api/audit-submit-guard';
import { safeJsonFetch } from '../lib/http/safe-json';
import { AUDIT_TARGET_INPUT_PROPS, normalizeAuditTarget } from '../lib/url/normalize-audit-target';
import React, { useRef, useState } from 'react';
import { LiveAuditProgress } from './audit/LiveAuditProgress';
import { ShieldCheck, ShieldAlert, AlertTriangle, Info, CheckCircle2, Loader2, Lock, Download, Printer } from 'lucide-react';
import { SecurityAuditResult, SecurityIssue } from '../lib/security/types';
import { FormField, Notice, PageHeader, Panel, ResponsiveTable } from './ui/page-system';
import { MetricCard } from './ui/visual-system';

export default function SecurityAudit() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [auditId, setAuditId] = useState<string | null>(null);
  const [result, setResult] = useState<SecurityAuditResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const auditStartGuardRef = useRef(createAuditSubmitGuard());

  const startAudit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeAuditTarget(url);
    if (!normalized.isValid) {
      setError(normalized.error || 'Enter a valid public website or domain.');
      return;
    }
    if (!auditStartGuardRef.current.begin()) return;
    
    setLoading(true);
    setError(null);
    setResult(null);
    
    try {
      const dataResp = await safeJsonFetch<any>(API_ROUTES.auditStart, {
        method: 'POST',
        headers: await getAuditStartHeaders({ 'Content-Type': 'application/json' }),
        
        body: JSON.stringify({ url, mode: 'quick', type: 'security', options: {} })
      });
      const data = dataResp.success ? dataResp.data : { success: false, error: (dataResp as any).error };
      if (!data.success) throw new Error(data.error);
      
      setAuditId(data.data.auditId);
      setLoading(false);
      return;
    } catch(err: any) {
      setError(err.message);
    } finally {
      auditStartGuardRef.current.end();
      setLoading(false);
    }
  };

  return (
    <div className="w-full space-y-9 animate-rise">
      <PageHeader eyebrow="Non-invasive checks" icon={ShieldCheck} title="Passive Security Review" description="Inspect public HTTPS and browser protection signals without port scanning, attack payloads, credential testing, or exploitation." />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <Panel className="p-5 sm:p-7">
          <form onSubmit={startAudit} noValidate className="space-y-5">
            <FormField label="Website URL" htmlFor="security-url" hint="The audit engine follows safe public redirects and records only structured observations.">
              <input id="security-url" {...AUDIT_TARGET_INPUT_PROPS} value={url} onChange={(e) => setUrl(e.target.value)} className="suite-input" />
            </FormField>
            <button type="submit" disabled={loading || !url.trim()} className="trust-button w-full sm:w-auto">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Lock className="h-5 w-5" />}
              {loading ? 'Starting review...' : 'Start passive review'}
            </button>
          </form>
        </Panel>
        <Panel className="p-5 sm:p-7">
          <h2 className="text-xl font-semibold">Public signals checked</h2>
          <ul className="mt-5 grid gap-3 text-sm leading-6 text-muted-foreground">
            {['HTTPS delivery and certificate reachability', 'Browser security protection headers', 'Frame, content-type, referrer, and permissions policies', 'Insecure form or mixed-content indicators when available'].map((item) => <li key={item} className="flex gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" />{item}</li>)}
          </ul>
        </Panel>
      </div>

      {auditId && !result && (
        <LiveAuditProgress 
          auditId={auditId} 
          onComplete={async () => {
            const dataResp = await safeJsonFetch<any>(API_ROUTES.auditResult(auditId), { headers: await getAuditAccessHeaders() });
        const data = dataResp.success ? dataResp.data : { success: false, error: (dataResp as any).error };
            if (data.success) {
              setResult(data.data.result || data.data);
              setAuditId(null);
            }
          }} 
        />
      )}
      
      {error && <Notice tone="danger" title="Review could not start">{error}</Notice>}

      {result && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Security score" value={result.securityScore} detail="Passive observations out of 100" icon={<ShieldCheck className="h-5 w-5" />} tone={result.securityScore >= 90 ? 'green' : result.securityScore >= 70 ? 'yellow' : 'red'} />
            <MetricCard label="Fix now" value={result.criticalCount} detail="Critical observations" icon={<ShieldAlert className="h-5 w-5" />} tone={result.criticalCount ? 'red' : 'green'} />
            <MetricCard label="High priority" value={result.highCount} detail="Review soon" icon={<AlertTriangle className="h-5 w-5" />} tone={result.highCount ? 'yellow' : 'green'} />
            <MetricCard label="Total findings" value={result.issues.length} detail="Measured public signals" icon={<Info className="h-5 w-5" />} />
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="p-4 border-b border-border bg-muted/20">
              <h3 className="font-bold text-lg font-display">Passive security findings</h3>
            </div>
            <ResponsiveTable label="Passive security findings" minWidth={840}>
              <table className="suite-table">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="p-4 font-medium">Finding</th>
                    <th className="p-4 font-medium">Area</th>
                    <th className="p-4 font-medium">Fix priority</th>
                    <th className="p-4 font-medium">Proof</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {result.issues.map((issue, idx) => (
                    <tr key={idx} className="hover:bg-muted/20">
                      <td className="p-4">
                        <div className="font-medium text-foreground">{humanizeSecurityText(issue.title)}</div>
                        <div className="text-xs text-muted-foreground mt-1">{humanizeSecurityText(issue.description)}</div>
                        <div className="text-xs text-emerald-600 mt-1">How to fix: {humanizeSecurityText(issue.recommendation)}</div>
                      </td>
                      <td className="p-4">
                        <span className="px-2 py-1 bg-muted rounded-md text-xs font-medium">{humanizeSecurityText(issue.category)}</span>
                      </td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded-md text-xs font-bold uppercase tracking-wider ${
                          issue.severity === 'critical' ? 'bg-red-500/20 text-red-500' :
                          issue.severity === 'high' ? 'bg-amber-500/20 text-amber-500' :
                          issue.severity === 'medium' ? 'bg-yellow-500/20 text-yellow-500' :
                          issue.severity === 'low' ? 'bg-blue-500/20 text-blue-500' :
                          'bg-muted text-muted-foreground'
                        }`}>
                          {priorityLabel(issue.severity)}
                        </span>
                      </td>
                      <td className="p-4 font-mono text-xs text-muted-foreground truncate max-w-[200px]">
                        {humanizeSecurityText(issue.evidence)}
                      </td>
                    </tr>
                  ))}
                  {result.issues.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-muted-foreground flex flex-col items-center gap-2">
                        <CheckCircle2 className="w-8 h-8 text-green-500" />
                        <p>No urgent passive security fixes found.</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </ResponsiveTable>
          </div>
        </div>
      )}
    </div>
  );
}

function priorityLabel(severity: string) {
  if (severity === 'critical') return 'fix now';
  if (severity === 'high') return 'high priority';
  if (severity === 'medium') return 'review soon';
  if (severity === 'low') return 'nice to fix';
  return severity;
}

function humanizeSecurityText(value?: string) {
  if (!value) return '';
  return value
    .replace(/security headers/gi, 'browser protections')
    .replace(/Strict-Transport-Security|HSTS/gi, 'HTTPS protection')
    .replace(/Content-Security-Policy|CSP/gi, 'content protection policy')
    .replace(/X-Frame-Options/gi, 'clickjacking protection')
    .replace(/X-Content-Type-Options/gi, 'file type protection')
    .replace(/Referrer-Policy/gi, 'referrer privacy policy')
    .replace(/vulnerabilities/gi, 'security weaknesses');
}
