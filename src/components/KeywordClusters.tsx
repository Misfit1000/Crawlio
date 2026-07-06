import React, { useState } from 'react';
import { Layers, Loader2, Search, Download } from 'lucide-react';
import { Cluster } from '../lib/keywords/clustering';

export default function KeywordClusters() {
  const [keywordList, setKeywordList] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Cluster[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCluster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keywordList.trim()) return;

    // Convert string to array of KeywordResult mock objects since we only need the keyword property for clustering here
    // In a real flow, you'd pass full KeywordResult objects from Keyword Research
    const rawKeywords = keywordList.split('\n').map(k => k.trim()).filter(k => k);
    
    // Using a separate local logic to mock full objects for the API, 
    // but the API expects `KeywordResult[]`. We'll just generate them first.
    
    setLoading(true);
    setError(null);
    try {
      // First generate full keywords
      const genResponse = await fetch('/api/tools/keyword/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed: rawKeywords[0] }) // just use first as seed for demo
      });
      const genData = await genResponse.json();
      
      if (genData.keywords) {
         const response = await fetch('/api/tools/clusters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keywords: genData.keywords })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to cluster keywords');
        setResults(data.clusters);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Keyword Clustering</h1>
        <p className="text-muted-foreground">Group keywords into semantic clusters using local similarity algorithms.</p>
      </div>

      <div className="bg-card border border-border p-6 rounded-2xl shadow-sm">
        <form onSubmit={handleCluster} className="space-y-4">
          <div>
             <label className="block text-sm font-medium mb-2">Enter seed keyword to generate and cluster</label>
             <input
                type="text"
                value={keywordList}
                onChange={e => setKeywordList(e.target.value)}
                placeholder="e.g. bookkeeping"
                className="w-full bg-muted/50 border border-border rounded-xl py-2 px-4 outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                required
              />
          </div>
          
          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={loading || !keywordList.trim()}
              className="px-6 py-2.5 bg-accent text-accent-foreground font-semibold rounded-xl hover:bg-accent/90 disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Layers className="w-5 h-5" />}
              Generate Clusters
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
        <div className="space-y-4">
           <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold">Generated Clusters</h2>
            <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <Download className="w-4 h-4" /> Export CSV
            </button>
           </div>
           
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
             {results.map(cluster => (
               <div key={cluster.id} className="bg-card border border-border rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
                 <div className="flex justify-between items-start mb-3">
                   <h3 className="font-bold text-lg capitalize">{cluster.name}</h3>
                   <span className="bg-muted px-2 py-1 rounded-md text-xs font-medium">{cluster.keywords.length + 1} keywords</span>
                 </div>
                 <div className="mb-4">
                    <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Primary</span>
                    <p className="font-medium text-accent mt-0.5">{cluster.primaryKeyword}</p>
                 </div>
                 
                 <div className="space-y-1 mb-4">
                    <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Secondary</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {cluster.keywords.slice(0, 3).map((kw, i) => (
                        <span key={i} className="text-xs bg-muted px-2 py-1 rounded-md">{kw}</span>
                      ))}
                      {cluster.keywords.length > 3 && <span className="text-xs text-muted-foreground px-1 py-1">+{cluster.keywords.length - 3} more</span>}
                    </div>
                 </div>

                 <div className="flex justify-between items-center pt-4 border-t border-border mt-auto">
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Intent</p>
                      <p className="text-sm font-semibold">{cluster.intent}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground mb-0.5">Opportunity</p>
                      <p className="text-sm font-bold text-green-500">{cluster.opportunityScore}</p>
                    </div>
                 </div>
               </div>
             ))}
           </div>
        </div>
      )}
    </div>
  );
}
