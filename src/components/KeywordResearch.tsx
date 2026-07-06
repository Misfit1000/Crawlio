import React, { useState } from 'react';
import { Search, Loader2, Download, TrendingUp, BarChart } from 'lucide-react';
import { KeywordResult } from '../lib/keywords/generator';

export default function KeywordResearch({ keyword: initialKeyword }: { keyword?: string }) {
  const [keyword, setKeyword] = useState(initialKeyword || '');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<KeywordResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleResearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyword.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/tools/keyword/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed: keyword })
      });
      if (!response.ok) throw new Error('Failed to fetch keywords');
      
      const data = await response.json();
      setResults(data.keywords || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Keyword Research</h1>
        <p className="text-muted-foreground">Generate deterministic keyword ideas and estimate opportunity scores.</p>
      </div>

      <div className="bg-card border border-border p-6 rounded-2xl shadow-sm">
        <form onSubmit={handleResearch} className="flex gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="Enter a seed keyword..."
              className="w-full bg-muted/50 border border-border rounded-xl py-3 pl-10 pr-4 outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !keyword.trim()}
            className="px-6 py-3 bg-accent text-accent-foreground font-semibold rounded-xl hover:bg-accent/90 disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
            Analyze
          </button>
        </form>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl">
          {error}
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-card border border-border p-4 rounded-xl">
              <p className="text-sm text-muted-foreground">Total Keywords</p>
              <p className="text-2xl font-bold">{results.length}</p>
            </div>
            <div className="bg-card border border-border p-4 rounded-xl">
              <p className="text-sm text-muted-foreground">High Opportunity</p>
              <p className="text-2xl font-bold text-green-500">{results.filter(r => r.opportunityScore > 75).length}</p>
            </div>
            <div className="bg-card border border-border p-4 rounded-xl">
              <p className="text-sm text-muted-foreground">Transactional</p>
              <p className="text-2xl font-bold text-accent">{results.filter(r => r.intent === 'Transactional').length}</p>
            </div>
          </div>

          <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-border flex justify-between items-center bg-muted/20">
              <h3 className="font-semibold">Generated Keywords</h3>
              <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                <Download className="w-4 h-4" /> Export CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="px-6 py-3 font-semibold text-muted-foreground">Keyword</th>
                    <th className="px-6 py-3 font-semibold text-muted-foreground">Intent</th>
                    <th className="px-6 py-3 font-semibold text-muted-foreground">Difficulty (Est.)</th>
                    <th className="px-6 py-3 font-semibold text-muted-foreground">Opportunity Score</th>
                    <th className="px-6 py-3 font-semibold text-muted-foreground">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {results.map(r => (
                    <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-6 py-4 font-medium">{r.keyword}</td>
                      <td className="px-6 py-4">
                        <span className="inline-flex px-2 py-1 rounded-full bg-accent/10 text-accent text-xs font-semibold">
                          {r.intent}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-full bg-muted rounded-full h-2 max-w-[100px]">
                            <div className="bg-orange-500 h-2 rounded-full" style={{ width: `${r.estimatedDifficulty}%` }} />
                          </div>
                          <span>{r.estimatedDifficulty}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className={`font-bold ${r.opportunityScore > 75 ? 'text-green-500' : 'text-yellow-500'}`}>
                            {r.opportunityScore}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground text-xs">{r.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
