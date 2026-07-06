import React, { useState } from 'react';
import { FileText, Loader2, Download, Search } from 'lucide-react';
import { ContentBrief } from '../lib/keywords/content-brief';

export default function ContentBriefs() {
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState<ContentBrief | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;

    setLoading(true);
    setError(null);
    try {
      // Mock passing a cluster object
      const mockCluster = {
        id: '1',
        name: topic,
        primaryKeyword: topic,
        keywords: [`${topic} tips`, `${topic} guide`, `best ${topic}`],
        intent: 'Informational',
        opportunityScore: 80,
        difficulty: 40,
        suggestedContentType: 'Blog Post'
      };

      const response = await fetch('/api/tools/content-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cluster: mockCluster })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to generate brief');
      
      setBrief(data.data.brief);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Content Brief Builder</h1>
        <p className="text-muted-foreground">Generate rule-based SEO content outlines without AI.</p>
      </div>

      <div className="bg-card border border-border p-6 rounded-2xl shadow-sm">
        <form onSubmit={handleGenerate} className="flex gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="Enter a primary keyword or topic..."
              className="w-full bg-muted/50 border border-border rounded-xl py-3 pl-10 pr-4 outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !topic.trim()}
            className="px-6 py-3 bg-accent text-accent-foreground font-semibold rounded-xl hover:bg-accent/90 disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5" />}
            Build Brief
          </button>
        </form>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl">
          {error}
        </div>
      )}

      {brief && (
        <div className="bg-card border border-border rounded-2xl p-8 shadow-sm space-y-8">
          <div className="flex justify-between items-start border-b border-border pb-6">
            <div>
              <h2 className="text-2xl font-bold capitalize mb-2">{topic} - Content Brief</h2>
              <div className="flex gap-4 text-sm text-muted-foreground">
                <span className="bg-muted px-2 py-1 rounded-md">Intent: {brief.targetIntent}</span>
                <span className="bg-muted px-2 py-1 rounded-md">Format: {brief.suggestedFormat}</span>
                <span className="bg-muted px-2 py-1 rounded-md">Length: {brief.wordCount}</span>
              </div>
            </div>
            <button className="flex items-center gap-2 text-sm font-medium bg-muted hover:bg-muted/80 px-4 py-2 rounded-lg transition-colors">
              <Download className="w-4 h-4" /> Export
            </button>
          </div>

          <div>
            <h3 className="text-lg font-bold mb-3 flex items-center gap-2 text-accent">1. Page Titles</h3>
            <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
              {brief.titleTemplates.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-bold mb-3 flex items-center gap-2 text-accent">2. Meta Description</h3>
            <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
              {brief.metaDescriptionTemplates.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-bold mb-3 flex items-center gap-2 text-accent">3. H1 Heading</h3>
            <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
              {brief.h1Suggestions.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-bold mb-3 flex items-center gap-2 text-accent">4. H2 Outline Structure</h3>
            <ul className="list-decimal pl-5 space-y-2 text-muted-foreground">
              {brief.h2Outline.map((t, i) => <li key={i} className="font-medium text-foreground">{t}</li>)}
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-bold mb-3 flex items-center gap-2 text-accent">5. Target Secondary Keywords</h3>
            <div className="flex flex-wrap gap-2">
              {brief.relatedKeywords.map((k, i) => (
                <span key={i} className="px-3 py-1.5 bg-muted/50 rounded-lg text-sm border border-border">
                  {k}
                </span>
              ))}
            </div>
          </div>

          {brief.faqs.length > 0 && (
            <div>
              <h3 className="text-lg font-bold mb-3 flex items-center gap-2 text-accent">6. Frequently Asked Questions (FAQ Schema)</h3>
              <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
                {brief.faqs.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
