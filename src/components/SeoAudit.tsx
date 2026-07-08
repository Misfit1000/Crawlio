import { API_ROUTES } from '../lib/api/routes';
import { safeJsonFetch } from '../lib/http/safe-json';
import { LiveAuditProgress } from './audit/LiveAuditProgress';
import React, { useState, useEffect } from 'react';
import { Activity, Play, RefreshCw, AlertTriangle, CheckCircle2, Globe, Clock, Layers, ShieldAlert, Zap } from 'lucide-react';
import { FullAuditResult, AuditIssue } from '../lib/audit/types';

export default function SeoAudit({ initialUrl }: { initialUrl?: string }) {
  const [url, setUrl] = useState(initialUrl || '');
  const [mode, setMode] = useState<'quick' | 'standard' | 'deep'>('quick');
  const [loading, setLoading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [auditResult, setAuditResult] = useState<FullAuditResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialUrl && !loading && !jobId && !auditResult) {
      startAudit();
    }
  }, [initialUrl]);

  const startAudit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!url.trim()) return;
    
    setLoading(true);
    setAuditResult(null);
    setJobId(null);
    setError(null);

    setError(null);
    setAuditResult(null);
    setStatus('pending');
    
    try {
      const dataResp = await safeJsonFetch<any>(API_ROUTES.auditStart, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Full SEO Audit</h1>
        <p className="text-muted-foreground">Run a comprehensive, rule-based SEO audit using local crawling and analysis.</p>
      </div>

      <div className="bg-card border border-border p-6 rounded-2xl shadow-sm">
        <form onSubmit={startAudit} className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="Enter website URL to audit (e.g. https://example.com)"
              className="w-full bg-muted/50 border border-border rounded-xl py-3 pl-10 pr-4 outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium whitespace-nowrap">Audit Mode</label>
            <select
              value={mode}
              onChange={e => setMode(e.target.value as any)}
              className="bg-muted/50 border border-border rounded-xl py-3 px-3 outline-none focus:border-accent"
            >
              <option value="quick">Quick - 10 pages</option>
              <option value="standard">Standard - 25 pages</option>
              <option value="deep">Deep - 50 pages</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={loading || !url.trim()}
            className="px-6 py-3 bg-accent text-accent-foreground font-semibold rounded-xl hover:bg-accent/90 disabled:opacity-50 flex items-center justify-center gap-2 min-w-[140px]"
          >
            {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
            {loading ? status.toUpperCase() : 'Start Audit'}
          </button>
        </form>
        {mode === 'deep' && (
          <div className="mt-3 text-sm text-yellow-600 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
            Deep audits may take longer and use more resources.
          </div>
        )}
      </div>
      
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl flex items-center gap-2">
          <AlertTriangle className="w-5 h-5" /> {error}
        </div>
      )}
      
      {jobId && !auditResult && (
  <LiveAuditProgress 
    auditId={jobId} 
     
    onComplete={async () => {
      try {
        const dataResp = await safeJsonFetch<any>(API_ROUTES.auditResult(jobId));
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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-card border border-border p-6 rounded-2xl flex items-center justify-between shadow-sm hover:shadow-md transition-shadow group">
              <div>
                <p className="text-sm text-muted-foreground">Overall SEO Score</p>
                <p className={`text-4xl font-bold font-display ${auditResult.overallScore >= 80 ? 'text-green-500' : auditResult.overallScore >= 50 ? 'text-yellow-500' : 'text-red-500'}`}>
                  {auditResult.overallScore}
                </p>
              </div>
              <Activity className="w-10 h-10 text-muted-foreground/20 group-hover:scale-110 transition-transform" />
            </div>
            
            <div className="bg-card border border-border p-6 rounded-2xl flex items-center justify-between shadow-sm hover:shadow-md transition-shadow group">
              <div>
                <p className="text-sm text-muted-foreground">Pages Crawled</p>
                <p className="text-4xl font-bold font-display text-accent">{auditResult.pagesCrawled}</p>
              </div>
              <Layers className="w-10 h-10 text-accent/20 group-hover:scale-110 transition-transform" />
            </div>

            <div className="bg-card border border-border p-6 rounded-2xl flex items-center justify-between shadow-sm hover:shadow-md transition-shadow group">
              <div>
                <p className="text-sm text-muted-foreground">Critical Issues</p>
                <p className="text-4xl font-bold font-display text-red-500">{auditResult.criticalIssues}</p>
              </div>
              <ShieldAlert className="w-10 h-10 text-red-500/20 group-hover:scale-110 transition-transform" />
            </div>

            <div className="bg-card border border-border p-6 rounded-2xl flex items-center justify-between shadow-sm hover:shadow-md transition-shadow group">
              <div>
                <p className="text-sm text-muted-foreground">Total Issues</p>
                <p className="text-4xl font-bold font-display text-orange-500">{auditResult.allIssues.length}</p>
              </div>
              <AlertTriangle className="w-10 h-10 text-orange-500/20 group-hover:scale-110 transition-transform" />
            </div>
          </div>
          
          <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-border bg-muted/20 flex justify-between items-center">
              <h3 className="font-semibold text-lg">Top SEO Issues</h3>
            </div>
            <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
              {auditResult.allIssues.length === 0 ? (
                <div className="p-8 text-center text-green-500 flex flex-col items-center gap-3">
                  <CheckCircle2 className="w-10 h-10" />
                  <p className="font-medium text-lg">Amazing! No issues found on crawled pages.</p>
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
                            {issue.severity.toUpperCase()}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded-md bg-muted text-muted-foreground border border-border capitalize">
                            {issue.category}
                          </span>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground">{issue.description}</p>
                      {issue.affectedUrl && (
                        <p className="text-xs mt-2 text-muted-foreground break-all bg-background p-1.5 rounded border border-border inline-block">
                          URL: <a href={issue.affectedUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">{issue.affectedUrl}</a>
                        </p>
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
