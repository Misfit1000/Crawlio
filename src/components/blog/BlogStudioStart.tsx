import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Bot, ExternalLink, FileText, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { getBlogAutomationDashboard, queueBlogJob } from '../../lib/blog/client';
import type { BlogAutomationDashboard } from '../../lib/blog/client';
import type { BlogGenerationJob, BlogPost } from '../../lib/blog/types';
import { Notice } from '../ui/page-system';
import { StatusBadge } from '../ui/visual-system';
import BlogReadinessStatus from './BlogReadinessStatus';
import { blogJobStatus, blogReadiness, validBlogSourceUrl } from './blog-readiness';

export default function BlogStudioStart({ posts, onManual, onOpenArticle, onOpenAutomation }: { posts: BlogPost[]; onManual: () => void; onOpenArticle: (post: BlogPost) => void; onOpenAutomation: () => void }) {
  const [jobs, setJobs] = useState<BlogGenerationJob[]>([]);
  const [dashboard, setDashboard] = useState<BlogAutomationDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusError, setStatusError] = useState('');
  const requestVersion = useRef(0);
  const [sourceUrl, setSourceUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setStatusError('');
    try {
      const data = await getBlogAutomationDashboard();
      if (version !== requestVersion.current) return;
      setJobs(data.jobs.slice(0, 6));
      setDashboard(data);
    } catch (requestError) {
      if (version !== requestVersion.current) return;
      setDashboard(null);
      setStatusError(requestError instanceof Error ? requestError.message : 'AI publishing status could not be loaded.');
    } finally { if (version === requestVersion.current) setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); return () => { requestVersion.current += 1; }; }, [refresh]);
  const readiness = blogReadiness(dashboard);
  const providerReady = readiness.oneClickReady && !loading;
  const sourceValid = validBlogSourceUrl(sourceUrl);

  const start = async (mode: 'one_click' | 'one_click_source') => {
    if (!providerReady || busy || (mode === 'one_click_source' && !sourceValid)) return;
    setBusy(mode); setError(''); setMessage('');
    try {
      const { job } = await queueBlogJob({ mode, sourceUrls: mode === 'one_click_source' ? [sourceUrl.trim()] : undefined, articleType: 'news_analysis', lengthMode: 'automatic', requestId: crypto.randomUUID() });
      setJobs(current => [job, ...current.filter(item => item.id !== job.id)].slice(0, 6));
      setMessage('Article queued. Refresh status to follow progress; publication checks still apply.');
      if (mode === 'one_click_source') setSourceUrl('');
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The AI article could not be started.');
    } finally { setBusy(''); }
  };

  const recentPosts = [...posts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
  return <div className="blog-studio-start flex min-w-0 flex-col gap-8 text-base">
    {error && <Notice tone="danger" title="Blog action failed">{error}</Notice>}
    {message && <Notice tone="success">{message}</Notice>}
    <BlogReadinessStatus dashboard={dashboard} loading={loading} error={statusError} actions={<button type="button" disabled={loading || Boolean(busy)} onClick={() => void refresh()} className="quiet-button"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh status</button>} />
    <section aria-labelledby="blog-create-title">
      <h2 id="blog-create-title" className="text-xl font-semibold">Create an article</h2>
      <div aria-label="Article creation workflows" className="blog-creation-grid mt-8 grid md:grid-cols-3">
      <article className="blog-creation-workflow flex min-w-0 flex-col">
        <Sparkles className="blog-workflow-icon mb-5 h-7 w-7 text-accent" aria-hidden="true" />
        <h3 className="text-lg font-semibold leading-normal">Latest SEO update</h3>
        <p className="mt-3 text-base leading-7 text-muted-foreground">Research an official source, write with citations, and publish after checks pass. Otherwise, save for review.</p>
        <div className="mt-auto pt-6"><button type="button" disabled={!providerReady || Boolean(busy)} title={!providerReady ? 'Review AI generation readiness above before starting.' : undefined} onClick={() => void start('one_click')} className="trust-button w-full justify-center">
          {busy === 'one_click' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Write and publish
        </button></div>
      </article>
      <article className="blog-creation-workflow flex min-w-0 flex-col">
        <Bot className="blog-workflow-icon mb-5 h-7 w-7" style={{ color: 'var(--category-cyan, var(--accent))' }} aria-hidden="true" />
        <h3 className="text-lg font-semibold leading-normal">Create from a source</h3>
        <p className="mt-3 text-base leading-7 text-muted-foreground">Turn a trusted announcement into an independently written article with source citations.</p>
        <label className="mt-4 block"><span className="mb-2 block text-xs font-semibold">Public source URL</span><input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} aria-invalid={Boolean(sourceUrl.trim()) && !sourceValid} aria-describedby="blog-source-url-hint" placeholder="https://example.com/source" className="suite-input" /></label>
        <p id="blog-source-url-hint" className="mt-2 text-xs text-muted-foreground">{sourceUrl.trim() && !sourceValid ? 'Enter a public HTTPS URL without credentials.' : 'Source verification and publication checks apply.'}</p>
        <div className="mt-auto pt-5"><button type="button" disabled={!providerReady || Boolean(busy) || !sourceValid} title={!providerReady ? 'Review AI generation readiness above before starting.' : undefined} onClick={() => void start('one_click_source')} className="quiet-button w-full justify-center">
          {busy === 'one_click_source' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} Create and publish
        </button></div>
      </article>
      <article className="blog-creation-workflow flex min-w-0 flex-col">
        <FileText className="blog-workflow-icon mb-5 h-7 w-7" style={{ color: 'var(--category-teal, var(--accent))' }} aria-hidden="true" />
        <h3 className="text-lg font-semibold leading-normal">Write manually</h3>
        <p className="mt-3 text-base leading-7 text-muted-foreground">Write, review, then publish. Your draft and search fields are saved as you work.</p>
        <div className="mt-auto pt-5"><button type="button" onClick={onManual} className="quiet-button w-full justify-center"><FileText className="h-4 w-4" /> Open editor</button></div>
      </article>
      </div>
    </section>
    <div className="grid gap-8 xl:grid-cols-2">
      <section className="min-w-0 border-t border-border pt-8">
        <div className="pb-4"><h2 className="text-xl font-semibold">AI activity</h2></div>
        <div className="divide-y divide-border">{jobs.length ? jobs.map((job) => {
          const status = blogJobStatus(job);
          const article = posts.find(post => post.id === job.articleId);
          return <button key={job.id} type="button" onClick={() => article ? onOpenArticle(article) : onOpenAutomation()} className="blog-library-row flex w-full min-w-0 flex-wrap items-start justify-between gap-4 py-6 text-left md:flex-nowrap md:gap-6"><div className="min-w-0"><p className="break-words text-sm font-semibold">{job.customHeadline || job.topic || job.statusMessage || 'AI article'}</p><p className="mt-2 text-xs text-muted-foreground">{job.state === 'queued' ? 'Waiting for the dispatcher. Refresh for progress.' : job.statusMessage}</p>{(job.error || job.lastSafeErrorCode) && <p className="mt-2 break-words text-xs text-red-600 dark:text-red-300">{job.lastSafeErrorCode && `${job.lastSafeErrorCode}: `}{job.error || 'Review the failed stage in Advanced AI controls.'}</p>}</div><StatusBadge tone={status.tone}>{status.label}</StatusBadge></button>;
        }) : <p className="p-5 text-sm text-muted-foreground">{loading ? 'Loading AI jobs...' : statusError ? 'AI activity could not be loaded. Refresh status to retry.' : 'No AI jobs yet.'}</p>}</div>
        <button type="button" onClick={onOpenAutomation} className="flex w-full items-center justify-between border-t border-border px-5 py-3 text-sm font-semibold text-accent hover:bg-muted/40">Advanced AI controls <ArrowRight className="h-4 w-4" /></button>
      </section>
      <section className="min-w-0 border-t border-border pt-8">
        <div className="pb-4"><h2 className="text-xl font-semibold">Recent articles</h2></div>
        <div className="divide-y divide-border">{recentPosts.length ? recentPosts.map((post) => <button key={post.id} type="button" onClick={() => onOpenArticle(post)} className="blog-library-row flex w-full min-w-0 flex-wrap items-start justify-between gap-4 py-6 text-left md:flex-nowrap md:gap-6"><div className="min-w-0"><p className="break-words text-sm font-semibold">{post.title}</p><p className="mt-2 text-xs text-muted-foreground">Updated {new Date(post.updatedAt).toLocaleDateString()}</p></div><span className="flex shrink-0 items-center gap-2"><StatusBadge tone={post.status === 'published' ? 'success' : post.status === 'failed' ? 'danger' : 'warning'}>{post.status.replaceAll('_', ' ')}</StatusBadge>{post.status === 'published' && <ExternalLink className="h-4 w-4 text-muted-foreground" />}</span></button>) : <p className="p-5 text-sm text-muted-foreground">No articles yet.</p>}</div>
      </section>
    </div>
  </div>;
}
