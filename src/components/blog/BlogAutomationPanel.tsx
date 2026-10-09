import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, CheckCircle2, Clock3, FileStack, Loader2, Newspaper, Play, RefreshCw, Save, Settings2, Sparkles } from 'lucide-react';
import { getBlogAutomationDashboard, getBlogAutomationSettings, queueBlogBatch, queueBlogJob, runAdminBlogWorkflow, saveBlogAutomationSettings, testAdminBlogProvider } from '../../lib/blog/client';
import type { BlogAutomationDashboard, BlogProviderTestResult } from '../../lib/blog/client';
import type { BlogAdminOverview, BlogGenerationJob, BlogPost } from '../../lib/blog/types';
import { FormField, Notice } from '../ui/page-system';
import { StatusBadge } from '../ui/visual-system';
import BlogContentCalendar from './BlogContentCalendar';
import { getSupabaseBrowserClient } from '../../lib/supabase/client';
import BlogReadinessStatus from './BlogReadinessStatus';
import { blogReadiness, providerErrorAction, providerTestPassed } from './blog-readiness';

const EMPTY_OVERVIEW: BlogAdminOverview = {
  automaticGeneratedToday: 0, automaticGeneratedWeek: 0, automaticPublishedToday: 0, automaticPublishedWeek: 0,
  manuallyTriggered: 0, manualBatchArticles: 0, customHeadlineArticles: 0, updates: 0,
  skippedAutomaticOpportunities: 0, automaticHeldForReview: 0, highPriorityStories: 0, expiringStories: 0,
  draftsNeedingReview: 0, activeJobs: 0,
  unresolvedClaims: 0, sourceFailures: 0, linkFailures: 0, imageFailures: 0, qualityFailures: 0,
  originalityWarnings: 0, duplicateTopicWarnings: 0, prerenderFailures: 0, updatesDue: 0,
  sitemapReady: 0, rssReady: 0, providerInputTokens: 0, providerOutputTokens: 0,
  automaticReviewed: 0, automaticApproved: 0, automaticRejected: 0, strictAutopilotUnlocked: false,
  vercelJobs: 0, stalledVercelJobs: 0, lastSuccessfulStageAt: null,
};

function jobTone(state: string) {
  if (state === 'published') return 'success' as const;
  if (state === 'failed' || state === 'cancelled') return 'danger' as const;
  if (state === 'ready_for_review' || state === 'scheduled') return 'warning' as const;
  return 'accent' as const;
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not scheduled';
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function BlogAutomationPanel({ posts, onChanged }: { posts: BlogPost[]; onChanged: () => void }) {
  const [overview, setOverview] = useState(EMPTY_OVERVIEW);
  const [jobs, setJobs] = useState<BlogGenerationJob[]>([]);
  const [discoveries, setDiscoveries] = useState<Array<Record<string, any>>>([]);
  const [settings, setSettings] = useState<Record<string, any>>({ enabled: false, timezone: 'UTC', daily_automatic_limit: 2, weekly_automatic_limit: 10, preferred_start_hour: 9, preferred_end_hour: 17, minimum_spacing_minutes: 180, approved_feed_urls: [], require_review_for_urgent: true });
  const [dashboard, setDashboard] = useState<BlogAutomationDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const settingsLoadedRef = useRef(false);
  const [statusError, setStatusError] = useState('');
  const [providerTest, setProviderTest] = useState<BlogProviderTestResult | null>(null);
  const requestVersion = useRef(0);
  const provider = dashboard?.provider;
  const [articleType, setArticleType] = useState('evergreen_guide');
  const [lengthMode, setLengthMode] = useState('automatic');
  const [topic, setTopic] = useState('');
  const [headline, setHeadline] = useState('');
  const [batchHeadlines, setBatchHeadlines] = useState('');
  const [sourceUrlsText, setSourceUrlsText] = useState('');
  const [competitorUrlsText, setCompetitorUrlsText] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (includeSettings = false) => {
    const version = ++requestVersion.current;
    const fetchSettings = includeSettings || !settingsLoadedRef.current;
    setLoading(true);
    const [status, configuration] = await Promise.allSettled([getBlogAutomationDashboard(), fetchSettings ? getBlogAutomationSettings() : Promise.resolve(null)]);
    if (version !== requestVersion.current) return;
    const failures: string[] = [];
    if (status.status === 'fulfilled') {
      setDashboard(status.value);
      setOverview(status.value.overview);
      setJobs(status.value.jobs);
      setDiscoveries(status.value.discoveries);
    } else {
      setDashboard(null);
      failures.push(status.reason instanceof Error ? status.reason.message : 'Generation status could not be loaded.');
    }
    if (fetchSettings) {
      if (configuration.status === 'fulfilled' && configuration.value) {
        setSettings(configuration.value.settings);
        setSettingsLoaded(true);
        settingsLoadedRef.current = true;
      } else {
        setSettingsLoaded(false);
        settingsLoadedRef.current = false;
        failures.push('Automation settings could not be loaded. Refresh to retry; settings cannot be saved until they are loaded.');
      }
    }
    setStatusError(failures.join(' '));
    setLoading(false);
  }, []);

  useEffect(() => { void load(true); return () => { requestVersion.current += 1; }; }, [load]);
  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const channel = client.channel('admin-blog-generation-jobs').on('postgres_changes', { event: '*', schema: 'public', table: 'blog_generation_jobs' }, () => { void load(); }).subscribe();
    return () => { void client.removeChannel(channel); };
  }, [load]);
  const scheduled = useMemo(() => posts.filter((post) => post.status === 'scheduled').sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt))), [posts]);
  const counters = [
    ['Automatic today', overview.automaticGeneratedToday, `${overview.automaticPublishedToday} published`],
    ['Manual articles', overview.manuallyTriggered, 'Does not use automatic quota'],
    ['Custom headlines', overview.customHeadlineArticles, 'Administrator supplied'],
    ['Batch articles', overview.manualBatchArticles, 'Independent jobs'],
    ['Fresh stories', overview.highPriorityStories, `${overview.expiringStories} expiring soon`],
    ['Needs review', overview.draftsNeedingReview, `${overview.activeJobs} active jobs`],
    ['Quality holds', overview.qualityFailures, `${overview.unresolvedClaims} unresolved claims`],
    ['Source and link holds', overview.sourceFailures + overview.linkFailures, `${overview.sourceFailures} source · ${overview.linkFailures} link`],
    ['Media and HTML holds', overview.imageFailures + overview.prerenderFailures, `${overview.imageFailures} image · ${overview.prerenderFailures} HTML`],
    ['Originality warnings', overview.originalityWarnings, `${overview.duplicateTopicWarnings} duplicate topics`],
    ['Discovery files', overview.sitemapReady, `${overview.rssReady} RSS-ready`],
    ['Provider usage', overview.providerInputTokens + overview.providerOutputTokens, `${overview.providerInputTokens} input · ${overview.providerOutputTokens} output`],
  ];

  const run = async (action: () => Promise<unknown>, success: string, key: string) => {
    setBusy(key); setError(''); setMessage('');
    try { await action(); setMessage(success); await load(key === 'settings' || key === 'rollout-settings'); onChanged(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'The action could not be completed.'); await load(); }
    finally { setBusy(''); }
  };

  const batch = batchHeadlines.split('\n').map((item) => item.trim()).filter(Boolean);
  const sourceUrls = sourceUrlsText.split('\n').map((item) => item.trim()).filter(Boolean).slice(0, 12);
  const competitorUrls = competitorUrlsText.split('\n').map((item) => item.trim()).filter(Boolean).slice(0, 5);
  const readiness = blogReadiness(dashboard);
  const liveGenerationAvailable = readiness.generationReady && !loading;
  const oneClickAvailable = readiness.oneClickReady && !loading;
  const generationDisabledReason = loading ? 'Checking AI generation readiness.' : 'Review AI generation readiness above for the blocking configuration or policy.';
  const oneClickJob = jobs.find((job) => job.origin === 'trend_autopilot');
  const workflow = (post: BlogPost, action: 'hold' | 'cancel' | 'publish_now' | 'convert_manual') => run(
    () => runAdminBlogWorkflow(post.id, { action, reason: action === 'hold' ? 'Held for administrator review.' : action === 'cancel' ? 'Administrator cancelled scheduled publication.' : action === 'publish_now' ? 'Administrator approved immediate publication.' : 'Converted to the manual publication workflow.' }),
    action === 'hold' ? 'Article held for review.' : action === 'cancel' ? 'Scheduled publication cancelled.' : action === 'publish_now' ? 'Article published.' : 'Article converted to manual scheduling.',
    `workflow-${post.id}`,
  );

  return (
    <section className="min-w-0">
      <div className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div><div className="flex items-center gap-2 text-accent"><Sparkles className="h-5 w-5" /><h2 className="text-lg font-semibold text-foreground">Advanced AI</h2></div><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Research, drafting, and publication controls. Automatic and manual quotas stay separate.</p></div>
        <button type="button" onClick={() => void load(!settingsLoaded)} disabled={loading || Boolean(busy)} className="quiet-button">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh</button>
      </div>
      {error && <div className="mt-5"><Notice tone="danger" title="Content operation failed">{error}</Notice></div>}
      {message && <div className="mt-5"><Notice tone="success">{message}</Notice></div>}
      <div className="mt-5"><BlogReadinessStatus dashboard={dashboard} loading={loading} error={statusError} /></div>

      <section className="mt-5 rounded-lg border border-accent/30 bg-accent/5 p-5 sm:p-6" aria-labelledby="one-click-blog-title">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <div className="flex items-center gap-2">
              <Newspaper className="h-5 w-5 text-accent" />
              <h4 id="one-click-blog-title" className="text-lg font-semibold text-foreground">Publish a useful SEO update</h4>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Crawlio checks approved and built-in official feeds, selects one recent relevant update, writes a sourced article, and fills the SEO fields. Publication requires the quality checks and current policy; blocked drafts are held for review.</p>
          </div>
          <button
            type="button"
            disabled={Boolean(busy) || !oneClickAvailable}
            title={oneClickAvailable ? undefined : generationDisabledReason}
            onClick={() => void run(
              () => queueBlogJob({ mode: 'one_click', articleType: 'news_analysis', lengthMode: 'automatic', requestId: crypto.randomUUID() }),
              'One-click job queued. Refresh to see dispatch and stage progress. Publication still follows the existing checks and policy.',
              'one-click',
            )}
            className="trust-button min-h-12 justify-center px-5"
          >
            {busy === 'one-click' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Research, write and publish
          </button>
        </div>
        <div className="mt-5 grid gap-3 border-t border-accent/15 pt-4 sm:grid-cols-3">
          {[
            ['Current evidence', 'Uses recent official or administrator-approved sources.'],
            ['Complete article', 'Creates the title, slug, sections, citations, links, tags, and search metadata.'],
            ['Guarded publishing', 'Publishes only after substance, originality, source, link, and rendering checks pass.'],
          ].map(([label, detail]) => <div key={label} className="flex gap-2 text-xs leading-5 text-muted-foreground"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /><span><strong className="font-semibold text-foreground">{label}.</strong> {detail}</span></div>)}
        </div>
        {oneClickJob && <div className="mt-4 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="text-sm font-semibold text-foreground">Latest one-click article</p><p className="mt-1 text-xs text-muted-foreground">{oneClickJob.statusMessage}</p></div>
            <StatusBadge tone={jobTone(oneClickJob.state)}>{oneClickJob.workflowStage.replaceAll('_', ' ')}</StatusBadge>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded bg-muted"><div className="h-full rounded bg-accent transition-[width] duration-500" style={{ width: `${oneClickJob.stageProgress}%` }} /></div>
          {oneClickJob.error && <p className="mt-2 text-xs text-red-600 dark:text-red-300">{oneClickJob.error}</p>}
        </div>}
      </section>

      <details className="mt-5 border-t border-border">
        <summary className="cursor-pointer px-4 py-4 text-sm font-semibold text-foreground">Advanced content controls <span className="ml-2 font-normal text-muted-foreground">Manual topics, batches, sources, schedules, and automation settings</span></summary>
        <div className="border-t border-border p-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{counters.map(([label, value, detail]) => <div key={String(label)} className="rounded-lg border border-border bg-muted/25 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold text-foreground">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>)}</div>

      <div className="mt-6 border-t border-border pt-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h4 className="font-semibold text-foreground">Groq on Vercel</h4><p className="mt-1 break-words text-xs text-muted-foreground">Structured: {provider?.structuredModel || 'Not reported'} · Writer: {provider?.writerModel || 'Not reported'} · {provider?.baseUrlHost || 'Host not reported'}. The key stays in Vercel server configuration.</p></div><button type="button" disabled={Boolean(busy) || loading} onClick={() => void run(async () => {
          const { result } = await testAdminBlogProvider();
          setProviderTest(result);
          if (!providerTestPassed(result)) throw new Error(`Provider test: ${result.status}${result.errorCode ? ` (${result.errorCode})` : ''}. ${providerErrorAction(result.errorCode || '')}`);
        }, 'Groq connectivity verified for the tested model. This does not enable jobs, verify dispatch, or change publication policy.', 'provider-test')} className="quiet-button">{busy === 'provider-test' && <Loader2 className="h-4 w-4 animate-spin" />} Test provider</button></div>
        {providerTest && <p className={`mt-3 break-words text-xs ${providerTestPassed(providerTest) ? 'text-muted-foreground' : 'text-red-600 dark:text-red-300'}`}><strong>Provider test: {providerTest.status}.</strong> {providerTest.errorCode ? `${providerTest.errorCode}. ${providerErrorAction(providerTest.errorCode)}` : `${providerTest.model} on ${providerTest.host}${providerTest.durationMs === null ? '' : ` (${providerTest.durationMs} ms)`}. Only the tested model is verified.`}</p>}
        <div className="mt-3 grid gap-3 text-xs text-muted-foreground sm:grid-cols-2"><p><span className="font-semibold text-foreground">Execution:</span> {provider?.execution || 'Not reported'}.</p><p><span className="font-semibold text-foreground">Available without Groq:</span> manual writing, sources, calendar, images, review, and static publishing, subject to publication policy.</p><p><span className="font-semibold text-foreground">Last provider success:</span> {provider?.lastSuccessAt ? formatDate(provider.lastSuccessAt) : 'Not recorded'}.</p><p><span className="font-semibold text-foreground">Job stages:</span> {overview.stalledVercelJobs ? `${overview.stalledVercelJobs} stalled job(s)` : dashboard ? 'No stalled jobs reported; this does not prove dispatch is configured' : 'Status unavailable'}.</p></div>
        <p className="mt-3 text-xs text-muted-foreground">Review rollout: {overview.automaticApproved} approved of {settings.required_reviewed_articles_before_autopublish || 30} required. Strict Autopilot is {overview.strictAutopilotUnlocked ? 'available' : 'locked'}.</p>
      </div>
      <label className="mt-3 flex items-start gap-3 text-sm"><input type="checkbox" checked={Boolean(settings.provider_enabled)} disabled={!settingsLoaded || Boolean(busy) || loading || (!provider?.configured && !settings.provider_enabled)} onChange={(event) => setSettings((value) => ({ ...value, provider_enabled: event.target.checked }))} className="mt-1 h-4 w-4" /><span><span className="font-semibold text-foreground">Enable Groq jobs after Vercel configuration</span><span className="block text-xs text-muted-foreground">Save settings to apply this choice. Requires the Groq API credential and enabled generation in the deployed environment; this switch does not change Vercel variables or enable Autopilot.</span></span></label>
      {!settingsLoaded && !loading && <p className="mt-2 text-xs text-muted-foreground">Settings are unavailable. Use Refresh to load them before changing policy.</p>}

      <div className="mt-6 border-t border-border pt-4"><h4 className="font-semibold text-foreground">Research inputs</h4><p className="mt-1 text-xs leading-5 text-muted-foreground">Optional public HTTPS references are fetched by bounded Vercel stages with SSRF controls. Competitor pages create a topic-gap brief only; wording, examples, tables, and structure are not copied.</p><div className="mt-4 grid gap-4 lg:grid-cols-2"><FormField label={`Source URLs (${sourceUrls.length}/12)`} htmlFor="automation-source-urls" hint="One authoritative source per line."><textarea id="automation-source-urls" value={sourceUrlsText} onChange={(event) => setSourceUrlsText(event.target.value)} className="suite-input min-h-20 resize-y" /></FormField><FormField label={`Competitor reference URLs (${competitorUrls.length}/5)`} htmlFor="automation-competitor-urls" hint="Used only for content-gap observations."><textarea id="automation-competitor-urls" value={competitorUrlsText} onChange={(event) => setCompetitorUrlsText(event.target.value)} className="suite-input min-h-20 resize-y" /></FormField></div></div>

      <div className="mt-4 grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2"><FormField label="Article type" htmlFor="automation-article-type"><select id="automation-article-type" value={articleType} onChange={(event) => setArticleType(event.target.value)} className="suite-input"><option value="urgent_news">Brief urgent news</option><option value="news_analysis">Detailed news analysis</option><option value="glossary">Glossary or explainer</option><option value="checklist">Checklist</option><option value="evergreen_guide">Evergreen SEO guide</option><option value="troubleshooting_guide">Troubleshooting guide</option><option value="technical_guide">Deep technical guide</option><option value="comparison">Comparison</option></select></FormField><FormField label="Article length" htmlFor="automation-length-mode" hint="Automatic follows article type; ranges never justify filler."><select id="automation-length-mode" value={lengthMode} onChange={(event) => setLengthMode(event.target.value)} className="suite-input"><option value="automatic">Automatic</option><option value="brief">Brief</option><option value="standard">Standard</option><option value="detailed">Detailed</option><option value="custom">Custom range</option></select></FormField></div>

      <div className="mt-6 grid gap-5 xl:grid-cols-3">
        <div className="min-w-0 border-t border-border pt-4"><h4 className="font-semibold text-foreground">Manual article</h4><p className="mt-1 text-xs leading-5 text-muted-foreground">Live drafting uses Groq through Vercel. Protected fixture mode exercises the review flow without an external request.</p><div className="mt-4"><FormField label="Article topic" htmlFor="automation-topic"><textarea id="automation-topic" value={topic} onChange={(event) => setTopic(event.target.value)} className="suite-input min-h-24 resize-y" maxLength={240} /></FormField></div><div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={topic.trim().length < 5 || Boolean(busy) || !liveGenerationAvailable} title={liveGenerationAvailable ? undefined : generationDisabledReason} onClick={() => void run(() => queueBlogJob({ mode: 'manual', topic, sourceUrls, competitorUrls, articleType, lengthMode, requestId: crypto.randomUUID() }), 'Manual article queued.', 'manual')} className="trust-button">{busy === 'manual' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Live draft</button>{provider?.fixtureAvailable && <button type="button" disabled={topic.trim().length < 5 || Boolean(busy)} onClick={() => void run(() => queueBlogJob({ mode: 'fixture', topic, articleType, lengthMode, fixtureScenario: articleType === 'urgent_news' ? 'news' : 'evergreen', requestId: crypto.randomUUID() }), 'Fixture test content queued as a private noindex draft.', 'fixture')} className="quiet-button">Fixture test content</button>}</div></div>
        <div className="min-w-0 border-t border-border pt-4"><h4 className="font-semibold text-foreground">Custom headline</h4><p className="mt-1 text-xs leading-5 text-muted-foreground">Preserves the exact headline. Duplicate or misleading promises are held for review.</p><div className="mt-4"><FormField label="Exact headline" htmlFor="automation-headline"><textarea id="automation-headline" value={headline} onChange={(event) => setHeadline(event.target.value)} className="suite-input min-h-24 resize-y" maxLength={140} /></FormField></div><button type="button" disabled={headline.trim().length < 8 || Boolean(busy) || !liveGenerationAvailable} title={liveGenerationAvailable ? undefined : generationDisabledReason} onClick={() => void run(() => queueBlogJob({ mode: 'custom_headline', headline, sourceUrls, competitorUrls, articleType, lengthMode, requestId: crypto.randomUUID() }), 'Custom-headline article queued.', 'headline')} className="trust-button mt-4">{busy === 'headline' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Queue headline</button></div>
        <div className="min-w-0 border-t border-border pt-4"><h4 className="font-semibold text-foreground">Manual batch</h4><p className="mt-1 text-xs leading-5 text-muted-foreground">One headline per line. Maximum five; each runs independently after provider configuration.</p><div className="mt-4"><FormField label={`Headlines (${batch.length}/5)`} htmlFor="automation-batch"><textarea id="automation-batch" value={batchHeadlines} onChange={(event) => setBatchHeadlines(event.target.value)} className="suite-input min-h-24 resize-y" /></FormField></div><button type="button" disabled={!batch.length || batch.length > 5 || Boolean(busy) || !liveGenerationAvailable} title={liveGenerationAvailable ? undefined : generationDisabledReason} onClick={() => void run(() => queueBlogBatch({ headlines: batch, sourceUrls, competitorUrls, articleType, lengthMode }), `${batch.length} batch jobs queued.`, 'batch')} className="trust-button mt-4">{busy === 'batch' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileStack className="h-4 w-4" />} Queue batch</button></div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,.85fr)]">
        <div className="min-w-0 border-t border-border pt-4"><div className="flex items-start justify-between gap-4"><div><h4 className="flex items-center gap-2 font-semibold text-foreground"><Newspaper className="h-4 w-4 text-accent" /> Freshness queue</h4><p className="mt-1 text-xs leading-5 text-muted-foreground">Only relevant, authoritative stories inside the freshness window can be selected. Zero suitable stories means zero forced articles.</p></div><button type="button" disabled={Boolean(busy) || loading || !dashboard} onClick={() => void run(() => queueBlogJob({ mode: 'discover', feedUrls: (settings.approved_feed_urls || []).length ? settings.approved_feed_urls : undefined, requestId: crypto.randomUUID() }), 'Freshness discovery queued.', 'discover')} className="quiet-button">{busy === 'discover' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Discover</button></div><div className="mt-4 space-y-2">{discoveries.length ? discoveries.slice(0, 8).map((item) => <div key={item.id || item.source_url} className="rounded-lg bg-muted/35 p-3"><div className="flex flex-wrap items-center gap-2"><StatusBadge tone={item.freshness_status === 'high' ? 'success' : item.freshness_status === 'medium' ? 'warning' : 'neutral'}>{item.freshness_status || 'unverified'}</StatusBadge><span className="text-xs text-muted-foreground">{item.publisher}</span></div><a href={item.source_url} target="_blank" rel="noreferrer" className="mt-2 block text-sm font-semibold text-foreground hover:text-accent">{item.source_title}</a><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.priority_reason || 'Awaiting freshness classification.'}</p></div>) : <p className="rounded-lg bg-muted/25 p-4 text-sm text-muted-foreground">No discoveries yet. Discover uses built-in official feeds plus any saved approved feeds.</p>}</div></div>

        <div className="min-w-0 border-t border-border pt-4"><h4 className="flex items-center gap-2 font-semibold text-foreground"><Settings2 className="h-4 w-4 text-accent" /> Autopilot settings</h4><div className="mt-4 space-y-4"><label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={Boolean(settings.enabled)} onChange={(event) => setSettings((value) => ({ ...value, enabled: event.target.checked }))} className="mt-1 h-4 w-4 accent-[var(--accent)]" /><span><span className="font-semibold text-foreground">Enable automatic discovery</span><span className="block text-xs leading-5 text-muted-foreground">Generation still follows quotas and publication gates.</span></span></label><label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={Boolean(settings.require_review_for_urgent)} onChange={(event) => setSettings((value) => ({ ...value, require_review_for_urgent: event.target.checked }))} className="mt-1 h-4 w-4 accent-[var(--accent)]" /><span><span className="font-semibold text-foreground">Require editorial review</span><span className="block text-xs leading-5 text-muted-foreground">Recommended for fresh or time-sensitive content.</span></span></label><FormField label="Timezone" htmlFor="automation-timezone"><input id="automation-timezone" value={settings.timezone || 'UTC'} onChange={(event) => setSettings((value) => ({ ...value, timezone: event.target.value }))} className="suite-input" /></FormField><div className="grid grid-cols-2 gap-3"><FormField label="Start hour" htmlFor="automation-start"><input id="automation-start" type="number" min="0" max="23" value={settings.preferred_start_hour ?? 9} onChange={(event) => setSettings((value) => ({ ...value, preferred_start_hour: Number(event.target.value) }))} className="suite-input" /></FormField><FormField label="End hour" htmlFor="automation-end"><input id="automation-end" type="number" min="1" max="24" value={settings.preferred_end_hour ?? 17} onChange={(event) => setSettings((value) => ({ ...value, preferred_end_hour: Number(event.target.value) }))} className="suite-input" /></FormField></div><FormField label="Approved HTTPS feeds" htmlFor="automation-feeds" hint="One RSS or Atom URL per line; maximum 20."><textarea id="automation-feeds" value={(settings.approved_feed_urls || []).join('\n')} onChange={(event) => setSettings((value) => ({ ...value, approved_feed_urls: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean).slice(0, 20) }))} className="suite-input min-h-24 resize-y" /></FormField><button type="button" disabled={Boolean(busy) || loading || !settingsLoaded} onClick={() => void run(() => saveBlogAutomationSettings(settings), 'Autopilot settings saved.', 'settings')} className="quiet-button">{busy === 'settings' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save settings</button></div></div>
      </div>

      <div className="mt-6 border-t border-border pt-4">
        <h4 className="flex items-center gap-2 font-semibold text-foreground"><Clock3 className="h-4 w-4 text-accent" /> Generation jobs</h4>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground"><tr><th className="pb-3 pr-4 font-medium">Origin</th><th className="pb-3 pr-4 font-medium">Topic</th><th className="pb-3 pr-4 font-medium">Stage</th><th className="pb-3 pr-4 font-medium">Progress</th><th className="pb-3 font-medium">Updated</th></tr></thead>
            <tbody>{jobs.slice(0, 12).map((job) => <tr key={job.id} className="border-t border-border"><td className="py-3 pr-4 text-xs">{job.origin.replaceAll('_', ' ')}</td><td className="max-w-72 py-3 pr-4"><span className="line-clamp-2">{job.customHeadline || job.topic || 'Trend discovery'}</span><span className="mt-1 block text-xs text-muted-foreground">{job.statusMessage}</span>{job.error && <span className="mt-1 block text-xs text-red-600 dark:text-red-300">{job.error}</span>}</td><td className="py-3 pr-4"><StatusBadge tone={jobTone(job.state)}>{job.workflowStage.replaceAll('_', ' ')}</StatusBadge><span className="mt-1 block text-xs text-muted-foreground">Attempt {job.stageAttemptCount}</span></td><td className="min-w-32 py-3 pr-4"><div className="h-2 overflow-hidden rounded bg-muted"><div className="h-full rounded bg-accent transition-[width] duration-500" style={{ width: `${job.stageProgress}%` }} /></div><span className="mt-1 block text-xs text-muted-foreground">{job.stageProgress}%</span></td><td className="whitespace-nowrap py-3 text-xs text-muted-foreground">{formatDate(job.updatedAt)}</td></tr>)}</tbody>
          </table>
          {!jobs.length && <p className="py-5 text-sm text-muted-foreground">No generation jobs have been queued.</p>}
        </div>
      </div>
      {scheduled.length > 0 && <div className="mt-6 border-t border-border pt-4"><h4 className="flex items-center gap-2 font-semibold text-foreground"><CalendarClock className="h-4 w-4 text-accent" /> Scheduled article controls</h4><div className="mt-4 space-y-3">{scheduled.map((post) => <div key={post.id} className="flex flex-col gap-3 rounded-lg bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-foreground">{post.title}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(post.scheduledAt)} · {post.origin.replaceAll('_', ' ')}</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={Boolean(busy) || loading} onClick={() => void workflow(post, 'hold')} className="quiet-button">Hold for review</button><button type="button" disabled={Boolean(busy) || loading} onClick={() => void workflow(post, 'cancel')} className="quiet-button">Cancel schedule</button><button type="button" disabled={Boolean(busy) || loading} onClick={() => void workflow(post, 'convert_manual')} className="quiet-button">Make manual</button><button type="button" disabled={Boolean(busy) || loading} onClick={() => void workflow(post, 'publish_now')} className="trust-button">Publish now</button></div></div>)}</div></div>}
      <div className="mt-6 border-t border-border pt-4"><h4 className="font-semibold text-foreground">Review-first publishing controls</h4><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={Boolean(settings.strict_autopilot_enabled)} disabled={!settingsLoaded || loading || Boolean(busy) || (!overview.strictAutopilotUnlocked && !settings.strict_autopilot_enabled)} onChange={(event) => setSettings((value) => ({ ...value, strict_autopilot_enabled: event.target.checked }))} className="mt-1 h-4 w-4" /><span><span className="font-semibold text-foreground">Strict Autopilot</span><span className="block text-xs text-muted-foreground">Locked until the review threshold.</span></span></label><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={Boolean(settings.emergency_pause)} onChange={(event) => setSettings((value) => ({ ...value, emergency_pause: event.target.checked }))} className="mt-1 h-4 w-4" /><span className="font-semibold text-foreground">Emergency pause</span></label><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={Boolean(settings.pause_all_publication)} onChange={(event) => setSettings((value) => ({ ...value, pause_all_publication: event.target.checked }))} className="mt-1 h-4 w-4" /><span className="font-semibold text-foreground">Pause publication</span></label><FormField label="Review threshold" htmlFor="review-threshold"><input id="review-threshold" type="number" min="30" max="50" value={settings.required_reviewed_articles_before_autopublish ?? 30} onChange={(event) => setSettings((value) => ({ ...value, required_reviewed_articles_before_autopublish: Number(event.target.value) }))} className="suite-input" /></FormField></div><button type="button" disabled={Boolean(busy) || loading || !settingsLoaded} onClick={() => void run(() => saveBlogAutomationSettings(settings), 'Publishing controls saved.', 'rollout-settings')} className="quiet-button mt-4"><Save className="h-4 w-4" /> Save publishing controls</button></div>
      <div className="mt-6">{settingsLoaded && <BlogContentCalendar posts={posts} settings={settings} onChanged={() => { void load(); onChanged(); }} />}</div>
        </div>
      </details>
    </section>
  );
}
