import { API_ROUTES } from '../lib/api/routes';
import { getAuditStartHeaders } from '../lib/api/auth-headers';
import { createAuditSubmitGuard } from '../lib/api/audit-submit-guard';
import { safeJsonFetch } from '../lib/http/safe-json';
import { AUDIT_TARGET_INPUT_PROPS, normalizeAuditTarget } from '../lib/url/normalize-audit-target';
import React, { useRef, useState } from 'react';
import { ShieldCheck, CheckCircle2, Loader2, Lock } from 'lucide-react';
import { useNavigate } from 'react-router';
import { FormField, Notice, PageHeader, Panel } from './ui/page-system';

export default function SecurityAudit() {
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
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
    
    try {
      const dataResp = await safeJsonFetch<any>(API_ROUTES.auditStart, {
        method: 'POST',
        headers: await getAuditStartHeaders({ 'Content-Type': 'application/json' }),
        
        body: JSON.stringify({ url, mode: 'quick', type: 'security', options: {} })
      });
      const data = dataResp.success ? dataResp.data : { success: false, error: (dataResp as any).error };
      if (!data.success) throw new Error(data.error);
      
      navigate(`/audit/live/${encodeURIComponent(data.data.auditId)}?section=security`);
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

      {error && <Notice tone="danger" title="Review could not start">{error}</Notice>}
    </div>
  );
}
