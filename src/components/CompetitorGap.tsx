import React, { useState } from 'react';
import { AlertTriangle, Target } from 'lucide-react';

export default function CompetitorGap() {
  const [myUrl, setMyUrl] = useState('');
  const [comp1, setComp1] = useState('');
  const [comp2, setComp2] = useState('');

  const handleAnalyze = (e: React.FormEvent) => {
    e.preventDefault();
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Competitor Keyword Gap</h1>
        <p className="text-muted-foreground">
          Competitor Gap is being rebuilt as a worker-backed feature.
        </p>
      </div>

      <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 text-yellow-700 rounded-xl flex gap-3">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold">Temporarily disabled</p>
          <p className="text-sm">
            Competitor Gap is temporarily disabled while worker-backed analysis is being enabled. This prevents long competitor crawls from running inside Vercel API routes.
          </p>
        </div>
      </div>

      <div className="bg-card border border-border p-6 rounded-2xl shadow-sm opacity-75">
        <form onSubmit={handleAnalyze} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Your Website</label>
              <input
                type="text"
                value={myUrl}
                onChange={e => setMyUrl(e.target.value)}
                placeholder="https://your-site.com"
                className="w-full bg-muted/50 border border-border rounded-xl py-2 px-4 outline-none"
              />
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Competitor 1</label>
                <input
                  type="text"
                  value={comp1}
                  onChange={e => setComp1(e.target.value)}
                  placeholder="https://competitor1.com"
                  className="w-full bg-muted/50 border border-border rounded-xl py-2 px-4 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-muted-foreground">Competitor 2 (Optional)</label>
                <input
                  type="text"
                  value={comp2}
                  onChange={e => setComp2(e.target.value)}
                  placeholder="https://competitor2.com"
                  className="w-full bg-muted/50 border border-border rounded-xl py-2 px-4 outline-none"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2 border-t border-border mt-4">
            <button
              type="submit"
              disabled
              className="px-6 py-2.5 bg-muted text-muted-foreground font-semibold rounded-xl cursor-not-allowed flex items-center gap-2"
            >
              <Target className="w-5 h-5" />
              Worker-backed analysis coming soon
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
