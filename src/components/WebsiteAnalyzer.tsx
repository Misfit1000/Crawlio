import React, { useState } from 'react';
import { Globe, Loader2, FileText, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { ParsedPageData } from '../lib/seo/html-parser';
import { AuditResult } from '../lib/seo/page-audit';

export default function WebsiteAnalyzer() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ data: ParsedPageData, audit: AuditResult } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    let targetUrl = url.trim();
    if (!targetUrl.startsWith('http')) {
      targetUrl = 'https://' + targetUrl;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/tools/website/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl })
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to analyze website');
      
      setResult({ data: data.data, audit: data.audit });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Website Analyzer</h1>
        <p className="text-muted-foreground">Extract keywords and run an on-page SEO audit on any URL locally.</p>
      </div>

      <div className="bg-card border border-border p-6 rounded-2xl shadow-sm">
        <form onSubmit={handleAnalyze} className="flex gap-4">
          <div className="flex-1 relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="Enter a website URL (e.g. https://example.com)"
              className="w-full bg-muted/50 border border-border rounded-xl py-3 pl-10 pr-4 outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !url.trim()}
            className="px-6 py-3 bg-accent text-accent-foreground font-semibold rounded-xl hover:bg-accent/90 disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Globe className="w-5 h-5" />}
            Analyze
          </button>
        </form>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl flex items-center gap-2">
          <AlertTriangle className="w-5 h-5" /> {error}
        </div>
      )}

      {result && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-card border border-border p-6 rounded-2xl flex items-center justify-between shadow-sm">
              <div>
                <p className="text-sm text-muted-foreground">SEO Score</p>
                <p className={`text-4xl font-bold ${result.audit.score >= 80 ? 'text-green-500' : result.audit.score >= 50 ? 'text-yellow-500' : 'text-red-500'}`}>
                  {result.audit.score}
                </p>
              </div>
              <ActivityIcon score={result.audit.score} />
            </div>
            <div className="bg-card border border-border p-6 rounded-2xl flex items-center justify-between shadow-sm">
              <div>
                <p className="text-sm text-muted-foreground">Word Count</p>
                <p className="text-4xl font-bold text-blue-500">{result.data.wordCount}</p>
              </div>
              <FileText className="w-10 h-10 text-blue-500/20" />
            </div>
            <div className="bg-card border border-border p-6 rounded-2xl flex items-center justify-between shadow-sm">
              <div>
                <p className="text-sm text-muted-foreground">Issues Found</p>
                <p className="text-4xl font-bold text-orange-500">{result.audit.issues.length}</p>
              </div>
              <AlertTriangle className="w-10 h-10 text-orange-500/20" />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
              <h2 className="text-xl font-bold mb-4 border-b border-border pb-2">Top Extracted Keywords</h2>
              <div className="flex flex-wrap gap-2">
                {result.data.topKeywords.map((kw, i) => (
                  <span key={i} className="px-3 py-1 bg-accent/10 text-accent rounded-full text-sm font-medium">
                    {kw}
                  </span>
                ))}
              </div>
              {result.data.topKeywords.length === 0 && (
                <p className="text-muted-foreground text-sm">No significant keywords extracted.</p>
              )}
            </div>
            
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
              <h2 className="text-xl font-bold mb-4 border-b border-border pb-2">Page Structure</h2>
              <div className="space-y-2">
                <div><span className="font-semibold">Title:</span> <span className="text-muted-foreground">{result.data.title || 'Missing'}</span></div>
                <div><span className="font-semibold">Meta Desc:</span> <span className="text-muted-foreground">{result.data.metaDescription || 'Missing'}</span></div>
                <div><span className="font-semibold">H1 Tags:</span> <span className="text-muted-foreground">{result.data.h1.join(', ') || 'Missing'}</span></div>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-border bg-muted/20">
              <h3 className="font-semibold">SEO Audit Issues</h3>
            </div>
            <div className="divide-y divide-border">
              {result.audit.issues.length === 0 ? (
                <div className="p-6 text-center text-green-500 flex flex-col items-center gap-2">
                  <CheckCircle2 className="w-8 h-8" />
                  <p className="font-medium">No SEO issues found!</p>
                </div>
              ) : (
                result.audit.issues.map((issue, i) => (
                  <div key={i} className="p-4 hover:bg-muted/30 transition-colors flex gap-4 items-start">
                    <div className={`mt-1 flex-shrink-0 ${issue.severity === 'critical' ? 'text-red-500' : issue.severity === 'high' ? 'text-orange-500' : 'text-yellow-500'}`}>
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-semibold">{issue.title}</h4>
                      <p className="text-sm text-muted-foreground mt-1">{issue.description}</p>
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
  if (score >= 80) return <CheckCircle2 className="w-10 h-10 text-green-500/20" />;
  if (score >= 50) return <AlertTriangle className="w-10 h-10 text-yellow-500/20" />;
  return <AlertTriangle className="w-10 h-10 text-red-500/20" />;
}
