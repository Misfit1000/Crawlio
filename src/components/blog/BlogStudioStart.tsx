import { useEffect, useState } from 'react';
import { ArrowRight, Bot, ExternalLink, FileText, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { getBlogAutomationDashboard, queueBlogJob } from '../../lib/blog/client';
import type { BlogGenerationJob, BlogPost } from '../../lib/blog/types';
import { Notice, Panel } from '../ui/page-system';
import { StatusBadge } from '../ui/visual-system';

function simpleJobStatus(job: BlogGenerationJob) {
  if (job.state === 'published') return { label: 'Published', tone: 'success' as const };
  if (job.state === 'failed' || job.state === 'ready_for_review') return { label: 'Needs attention', tone: 'warning' as const };
  if (['validating', 'checking_originality', 'optimising', 'prerendering'].includes(job.state)) return { label: 'Checking', tone: 'accent' as const };
  return { label: 'Writing', tone: 'neutral' as const };
}

export default function BlogStudioStart({ posts, onManual, onOpenArticle, onOpenAutomation }: { posts: BlogPost[]; onManual: () => void; onOpenArticle: (post: BlogPost) => void; onOpenAutomation: () => void }) {
  const [jobs, setJobs] = useState<BlogGenerationJob[]>([]);
  const [providerReady, setProviderReady] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = async () => {
    try {
      const data = await getBlogAutomationDashboard();
      setJobs(data.jobs.slice(0, 6));
      setProviderReady(Boolean(data.provider.enabled && data.provider.configured));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'AI publishing status could not be loaded.');
    }
  };
  useEffect(() => { void refresh(); }, []);

  const start = async (mode: 'one_click' | 'one_click_source') => {
    setBusy(mode); setError(''); setMessage('');
    try {
      await queueBlogJob({ mode, sourceUrls: mode === 'one_click_source' ? [sourceUrl.trim()] : undefined, articleType: 'news_analysis', lengthMode: 'automatic', requestId: crypto.randomUUID() });
      setMessage(mode === 'one_click' ? 'Crawlio is researching the latest useful SEO update.' : 'Crawlio is verifying the source and preparing the article.');
      if (mode === 'one_click_source') setSourceUrl('');
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The AI article could not be started.');
    } finally { setBusy(''); }
  };

  const recentPosts = [...posts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
  return <div className="space-y-6">
    {error && <Notice tone="danger" title="Blog action failed">{error}</Notice>}
    {message && <Notice tone="success">{message}</Notice>}
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel className="border-accent/30 p-5 sm:p-6">
        <Sparkles className="h-6 w-6 text-accent" />
        <h3 className="mt-4 text-lg font-semibold">Publish latest SEO update</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Crawlio chooses a current official source, writes the complete article, checks it, and publishes only when every required gate passes.</p>
        <button type="button" disabled={!providerReady || Boolean(busy)} onClick={() => void start('one_click')} className="trust-button mt-5 w-full justify-center">
          {busy === 'one_click' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Research, write and publish
        </button>
      </Panel>
      <Panel className="p-5 sm:p-6">
        <Bot className="h-6 w-6 text-accent" />
        <h3 className="mt-4 text-lg font-semibold">Create from a source</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Paste one trustworthy article or announcement. Crawlio extracts its details and creates an independently written, cited article.</p>
        <label className="mt-4 block"><span className="sr-only">Public source URL</span><input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://example.com/source" className="suite-input" /></label>
        <button type="button" disabled={!providerReady || Boolean(busy) || !sourceUrl.trim()} onClick={() => void start('one_click_source')} className="quiet-button mt-3 w-full justify-center">
          {busy === 'one_click_source' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} Create and publish
        </button>
      </Panel>
      <Panel className="p-5 sm:p-6">
        <FileText className="h-6 w-6 text-accent" />
        <h3 className="mt-4 text-lg font-semibold">Write manually</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Start with only a title and article body. Crawlio fills search fields, autosaves your work, and shows exactly what remains before publishing.</p>
        <button type="button" onClick={onManual} className="quiet-button mt-5 w-full justify-center"><FileText className="h-4 w-4" /> Open simple editor</button>
      </Panel>
    </div>
    {!providerReady && <Notice tone="warning" title="AI publishing is not ready">Connect and enable Groq in Advanced AI controls. Manual writing remains available.</Notice>}
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h3 className="font-semibold">AI activity</h3><p className="mt-1 text-xs text-muted-foreground">Recent writing and publishing jobs.</p></div><button type="button" onClick={() => void refresh()} className="icon-action" title="Refresh AI activity"><RefreshCw className="h-4 w-4" /></button></div>
        <div className="divide-y divide-border">{jobs.length ? jobs.map((job) => { const status = simpleJobStatus(job); return <div key={job.id} className="flex items-center justify-between gap-4 px-5 py-4"><div className="min-w-0"><p className="truncate text-sm font-semibold">{job.customHeadline || job.topic || job.statusMessage}</p><p className="mt-1 truncate text-xs text-muted-foreground">{job.statusMessage}</p></div><StatusBadge tone={status.tone}>{status.label}</StatusBadge></div>; }) : <p className="p-5 text-sm text-muted-foreground">No AI jobs yet.</p>}</div>
        <button type="button" onClick={onOpenAutomation} className="flex w-full items-center justify-between border-t border-border px-5 py-3 text-sm font-semibold text-accent hover:bg-muted/40">Advanced AI controls <ArrowRight className="h-4 w-4" /></button>
      </Panel>
      <Panel className="overflow-hidden p-0">
        <div className="border-b border-border px-5 py-4"><h3 className="font-semibold">Recent articles</h3><p className="mt-1 text-xs text-muted-foreground">Continue a draft or open a published article.</p></div>
        <div className="divide-y divide-border">{recentPosts.length ? recentPosts.map((post) => <button key={post.id} type="button" onClick={() => onOpenArticle(post)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-muted/40"><div className="min-w-0"><p className="truncate text-sm font-semibold">{post.title}</p><p className="mt-1 text-xs text-muted-foreground">Updated {new Date(post.updatedAt).toLocaleDateString()}</p></div><span className="flex items-center gap-2"><StatusBadge tone={post.status === 'published' ? 'success' : post.status === 'failed' ? 'danger' : 'warning'}>{post.status.replaceAll('_', ' ')}</StatusBadge>{post.status === 'published' && <ExternalLink className="h-4 w-4 text-muted-foreground" />}</span></button>) : <p className="p-5 text-sm text-muted-foreground">No articles yet.</p>}</div>
      </Panel>
    </div>
  </div>;
}
