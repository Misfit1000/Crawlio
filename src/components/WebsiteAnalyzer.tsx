import { API_ROUTES } from '../lib/api/routes';
import { safeJsonFetch } from '../lib/http/safe-json';
import React, { useState } from 'react';
import { LiveAuditProgress } from './audit/LiveAuditProgress';
import { Globe, Loader2, FileText, AlertTriangle, CheckCircle2, Layers } from 'lucide-react';
import { ParsedPageData } from '../lib/seo/html-parser';
import { AuditResult } from '../lib/audit/types';

export default function WebsiteAnalyzer() {
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<'quick' | 'standard' | 'deep'>('standard');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ 
    data: ParsedPageData, 
    audit: AuditResult, 
    crawledPages: number, 
    fullAudit: { overallScore: number, allIssues: any[] } 
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [auditId, setAuditId] = useState<string | null>(null);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError(null);
    setAuditId(null);
    setResult(null);

    try {
      const dataResp = await safeJsonFetch<any>(API_ROUTES.websiteAnalyze, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), mode })
      });
      const data = dataResp.success ? dataResp.data : { success: false, error: (dataResp as any).error };
      if (!data.success) throw new Error(data.error || 'Failed to analyze website');
      
      const nextAuditId = data.data.auditId;
      setAuditId(nextAuditId);
      window.history.pushState(null, '', `/audit/live/${nextAuditId}`);
      window.dispatchEvent(new CustomEvent('navigate-live-audit', { detail: nextAuditId }));
      setLoading(false);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  if (auditId) {
    return (
       <div className="space-y-6 max-w-7xl mx-auto">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Website Analyzer</h1>
          <p className="text-muted-foreground">Extract keywords and run an on-page SEO audit on multiple pages locally.</p>
        </div>
        <LiveAuditProgress 
          auditId={auditId} 
           
          onComplete={async () => {
             try {
                const dataResp = await safeJsonFetch<any>(API_ROUTES.auditResult(auditId));
        const data = dataResp.success ? dataResp.data : { success: false, error: (dataResp as any).error };
                if (data.success) {
                   setResult({
                     data: data.data.data,
                     audit: data.data.audit,
                     crawledPages: data.data.crawledPages,
                     fullAudit: data.data.fullAudit
                   });
                   setAuditId(null);
                }
             } catch(e) {}
          }} 
        />
       </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Website Analyzer & Crawler</h1>
        <p className="text-muted-foreground">Extract keywords and run an on-page SEO audit on multiple pages locally.</p>
      </div>

      <div className="bg-card border border-border p-6 rounded-2xl shadow-sm">
        <form onSubmit={handleAnalyze} className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="Enter a website URL (e.g. https://example.com)"
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
            className="px-6 py-3 bg-accent text-accent-foreground font-semibold rounded-xl hover:bg-accent/90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Globe className="w-5 h-5" />}
            Analyze
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

      {result && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-card border border-border p-6 rounded-2xl flex items-center justify-between shadow-sm">
              <div>
                <p className="text-sm text-muted-foreground">Overall Score</p>
                <p className={`text-3xl font-bold ${result.fullAudit.overallScore >= 80 ? 'text-green-500' : result.fullAudit.overallScore >= 50 ? 'text-yellow-500' : 'text-red-500'}`}>
                  {result.fullAudit.overallScore}
                </p>
              </div>
              <ActivityIcon score={result.fullAudit.overallScore} />
            </div>
            
            <div className="bg-card border border-border p-6 rounded-2xl flex items-center justify-between shadow-sm">
              <div>
                <p className="text-sm text-muted-foreground">Pages Crawled</p>
                <p className="text-3xl font-bold text-accent">{result.crawledPages}</p>
              </div>
              <Layers className="w-8 h-8 text-accent/20" />
            </div>

            <div className="bg-card border border-border p-6 rounded-2xl flex items-center justify-between shadow-sm">
              <div>
                <p className="text-sm text-muted-foreground">Total Issues</p>
                <p className="text-3xl font-bold text-orange-500">{result.fullAudit.allIssues.length}</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-orange-500/20" />
            </div>

            <div className="bg-card border border-border p-6 rounded-2xl flex items-center justify-between shadow-sm">
              <div>
                <p className="text-sm text-muted-foreground">Initial Page Words</p>
                <p className="text-3xl font-bold text-accent">{result.data?.wordCount || 0}</p>
              </div>
              <FileText className="w-8 h-8 text-accent/20" />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
              <h2 className="text-xl font-bold mb-4 border-b border-border pb-2">Top Extracted Keywords (Home)</h2>
              <div className="flex flex-wrap gap-2">
                {result.data?.topKeywords.map((kw, i) => (
                  <span key={i} className="px-3 py-1 bg-accent/10 text-accent rounded-full text-sm font-medium">
                    {kw}
                  </span>
                ))}
              </div>
            </div>
            
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
              <h2 className="text-xl font-bold mb-4 border-b border-border pb-2">Top Extracted Phrases (Home)</h2>
              <div className="flex flex-wrap gap-2">
                {result.data?.topPhrases.map((kw, i) => (
                  <span key={i} className="px-3 py-1 bg-muted rounded-full text-sm font-medium">
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-border bg-muted/20">
              <h3 className="font-semibold">Initial Page Structure</h3>
            </div>
            <div className="p-4 space-y-2 text-sm">
               <div><span className="font-semibold w-24 inline-block">Title:</span> <span className="text-muted-foreground">{result.data?.title || 'Missing'}</span></div>
               <div><span className="font-semibold w-24 inline-block">Meta Desc:</span> <span className="text-muted-foreground">{result.data?.metaDescription || 'Missing'}</span></div>
               <div><span className="font-semibold w-24 inline-block">H1 Tags:</span> <span className="text-muted-foreground">{result.data?.h1.join(', ') || 'Missing'}</span></div>
               <div><span className="font-semibold w-24 inline-block">Canonical:</span> <span className="text-muted-foreground">{result.data?.canonical || 'Missing'}</span></div>
               <div><span className="font-semibold w-24 inline-block">Int. Links:</span> <span className="text-muted-foreground">{result.data?.internalLinks.length}</span></div>
               <div><span className="font-semibold w-24 inline-block">Ext. Links:</span> <span className="text-muted-foreground">{result.data?.externalLinks.length}</span></div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-border bg-muted/20">
              <h3 className="font-semibold">All SEO Audit Issues (Site-Wide)</h3>
            </div>
            <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
              {result.fullAudit.allIssues.length === 0 ? (
                <div className="p-6 text-center text-green-500 flex flex-col items-center gap-2">
                  <CheckCircle2 className="w-8 h-8" />
                  <p className="font-medium">No SEO issues found!</p>
                </div>
              ) : (
                result.fullAudit.allIssues.map((issue, i) => (
                  <div key={i} className="p-4 hover:bg-muted/30 transition-colors flex gap-4 items-start">
                    <div className={`mt-1 flex-shrink-0 ${issue.severity === 'critical' ? 'text-red-500' : issue.severity === 'high' ? 'text-orange-500' : 'text-yellow-500'}`}>
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between items-start">
                        <h4 className="font-semibold">{issue.title}</h4>
                        <span className="text-xs px-2 py-0.5 rounded-md bg-muted text-muted-foreground border border-border">{issue.category}</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{issue.description}</p>
                      <p className="text-xs mt-1 text-accent break-all">{issue.affectedUrl}</p>
                      <div className="mt-2 text-sm bg-muted/50 p-2 rounded-lg border border-border inline-block">
                        <span className="font-semibold">Recommendation:</span> {issue.recommendation}
                      </div>
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

function ActivityIcon({ score }: { score: number }) {
  if (score >= 80) return <CheckCircle2 className="w-8 h-8 text-green-500/20" />;
  if (score >= 50) return <AlertTriangle className="w-8 h-8 text-yellow-500/20" />;
  return <AlertTriangle className="w-8 h-8 text-red-500/20" />;
}
