import React, { useState } from 'react';
import { Target, Loader2, Search, ArrowRight, Download } from 'lucide-react';

interface GapKeyword {
  keyword: string;
  inMySite: boolean;
  competitorsUsing: string[];
  gapType: 'Missing' | 'Shared' | 'Unique' | 'Competitor Only';
}

export default function CompetitorGap() {
  const [myUrl, setMyUrl] = useState('');
  const [comp1, setComp1] = useState('');
  const [comp2, setComp2] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<GapKeyword[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!myUrl.trim() || !comp1.trim()) return;

    let targetUrl = myUrl.trim().startsWith('http') ? myUrl.trim() : 'https://' + myUrl.trim();
    let c1Url = comp1.trim().startsWith('http') ? comp1.trim() : 'https://' + comp1.trim();
    let c2Url = comp2.trim() ? (comp2.trim().startsWith('http') ? comp2.trim() : 'https://' + comp2.trim()) : undefined;

    const competitorUrls = [c1Url];
    if (c2Url) competitorUrls.push(c2Url);

    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/tools/competitor-gap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ myUrl: targetUrl, competitorUrls })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to analyze competitor gap');
      
      setResults(data.gaps);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Competitor Keyword Gap</h1>
        <p className="text-muted-foreground">Extract and compare content keyword gaps from website copy locally.</p>
      </div>

      <div className="bg-card border border-border p-6 rounded-2xl shadow-sm">
        <form onSubmit={handleAnalyze} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Your Website</label>
              <input
                type="url"
                value={myUrl}
                onChange={e => setMyUrl(e.target.value)}
                placeholder="https://your-site.com"
                className="w-full bg-muted/50 border border-border rounded-xl py-2 px-4 outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                required
              />
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Competitor 1</label>
                <input
                  type="url"
                  value={comp1}
                  onChange={e => setComp1(e.target.value)}
                  placeholder="https://competitor1.com"
                  className="w-full bg-muted/50 border border-border rounded-xl py-2 px-4 outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-muted-foreground">Competitor 2 (Optional)</label>
                <input
                  type="url"
                  value={comp2}
                  onChange={e => setComp2(e.target.value)}
                  placeholder="https://competitor2.com"
                  className="w-full bg-muted/50 border border-border rounded-xl py-2 px-4 outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>
          </div>
          
          <div className="flex justify-end pt-2 border-t border-border mt-4">
            <button
              type="submit"
              disabled={loading || !myUrl.trim() || !comp1.trim()}
              className="px-6 py-2.5 bg-accent text-accent-foreground font-semibold rounded-xl hover:bg-accent/90 disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Target className="w-5 h-5" />}
              Analyze Gap
            </button>
          </div>
        </form>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl">
          {error}
        </div>
      )}

      {results && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-border flex justify-between items-center bg-muted/20">
            <h3 className="font-semibold">Gap Analysis Results</h3>
            <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <Download className="w-4 h-4" /> Export CSV
            </button>
          </div>
          <div className="p-4">
            <p className="text-sm text-muted-foreground mb-4">Content keyword gaps extracted from website copy (estimates only).</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-muted-foreground">Keyword Topic</th>
                    <th className="px-4 py-3 font-semibold text-muted-foreground">Gap Type</th>
                    <th className="px-4 py-3 font-semibold text-muted-foreground">Competitors Using</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {results.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">No significant shared topics found.</td>
                    </tr>
                  ) : (
                    results.map((r, i) => (
                      <tr key={i} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium capitalize">{r.keyword}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-1 rounded-full text-xs font-semibold ${
                            r.gapType === 'Missing' ? 'bg-red-500/10 text-red-500' :
                            r.gapType === 'Unique' ? 'bg-green-500/10 text-green-500' :
                            r.gapType === 'Shared' ? 'bg-blue-500/10 text-blue-500' :
                            'bg-orange-500/10 text-orange-500'
                          }`}>
                            {r.gapType}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {r.competitorsUsing.length > 0 ? r.competitorsUsing.join(', ') : 'None'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
