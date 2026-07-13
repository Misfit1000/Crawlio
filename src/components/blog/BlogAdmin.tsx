import { useEffect, useMemo, useState } from 'react';
import { Archive, Bot, CalendarDays, CheckCircle2, FilePlus2, Globe2, Loader2, RefreshCw, Save, Search, Sparkles, WandSparkles, XCircle } from 'lucide-react';
import { archiveAdminBlogPost, generateAdminBlog, getAdminBlogPosts, saveAdminBlogPost } from '../../lib/blog/client';
import { blogSeoChecklist, buildBlogSeoFields } from '../../lib/blog/seo';
import { createBlogSlug } from '../../lib/blog/slug';
import type { BlogPost, BlogPostInput, BlogPostStatus, GeminiBlogDraft } from '../../lib/blog/types';
import { EmptyState, StatusBadge } from '../ui/visual-system';
import { FormField, Notice, Panel } from '../ui/page-system';
import RichTextEditor from './RichTextEditor';

type Draft = Required<Omit<BlogPostInput, 'publishedAt'>> & { publishedAt: string };

const EMPTY_DRAFT: Draft = {
  title: '', slug: '', excerpt: '', contentHtml: '<p></p>', focusKeyword: '', tags: [], seoTitle: '', metaDescription: '', canonicalUrl: '', ogImageUrl: '', status: 'draft', publishedAt: '',
};

function draftFromPost(post: BlogPost): Draft {
  return {
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    contentHtml: post.contentHtml,
    focusKeyword: post.focusKeyword,
    tags: post.tags,
    seoTitle: post.seoTitle,
    metaDescription: post.metaDescription,
    canonicalUrl: post.canonicalUrl,
    ogImageUrl: post.ogImageUrl,
    status: post.status,
    publishedAt: post.publishedAt ? post.publishedAt.slice(0, 16) : '',
  };
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function BlogAdmin() {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [geminiLoading, setGeminiLoading] = useState<'topics' | 'draft' | null>(null);
  const [topic, setTopic] = useState('');
  const [audience, setAudience] = useState('website owners, marketers, developers, and SEO practitioners');
  const [topicIdeas, setTopicIdeas] = useState<Array<{ title: string; angle: string }>>([]);
  const [editorialReviewed, setEditorialReviewed] = useState(false);

  const loadPosts = async () => {
    setLoading(true);
    try {
      const data = await getAdminBlogPosts();
      setPosts(data.posts);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Blog posts could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadPosts(); }, []);

  const filteredPosts = posts.filter((post) => `${post.title} ${post.slug} ${post.status}`.toLowerCase().includes(search.toLowerCase()));
  const checklist = useMemo(() => blogSeoChecklist(draft), [draft]);

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setEditorialReviewed(false);
  };

  const startNew = () => {
    setSelectedId(null);
    setDraft({ ...EMPTY_DRAFT });
    setError(null);
    setMessage('');
    setEditorialReviewed(false);
  };

  const selectPost = (post: BlogPost) => {
    setSelectedId(post.id);
    setDraft(draftFromPost(post));
    setError(null);
    setMessage('');
    setEditorialReviewed(false);
  };

  const autoFillSeo = () => {
    const text = draft.contentHtml.replace(/<[^>]+>/g, ' ');
    const seo = buildBlogSeoFields({ title: draft.title, excerpt: draft.excerpt, contentText: text, focusKeyword: draft.focusKeyword });
    setDraft((current) => ({ ...current, slug: current.slug || seo.slug, excerpt: current.excerpt || seo.excerpt, seoTitle: seo.seoTitle, metaDescription: seo.metaDescription }));
    setEditorialReviewed(false);
    setMessage('SEO fields refreshed from the article.');
  };

  const persist = async (status?: BlogPostStatus, publishNow = false) => {
    const nextStatus = status || draft.status;
    if (nextStatus === 'published' && !editorialReviewed) {
      setError('Confirm the editorial review before scheduling or publishing this article.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const publishedAt = nextStatus === 'published' ? (publishNow ? new Date().toISOString() : draft.publishedAt || new Date().toISOString()) : null;
      const data = await saveAdminBlogPost({ ...draft, status: nextStatus, publishedAt }, selectedId || undefined);
      setSelectedId(data.post.id);
      setDraft(draftFromPost(data.post));
      setMessage(nextStatus === 'published' ? (new Date(data.post.publishedAt || 0).getTime() > Date.now() ? 'Article scheduled.' : 'Article published.') : 'Draft saved.');
      await loadPosts();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Article could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!selectedId || !window.confirm('Archive this article? It will disappear from the public blog.')) return;
    setSaving(true);
    try {
      await archiveAdminBlogPost(selectedId);
      setSelectedId(null);
      setDraft({ ...EMPTY_DRAFT });
      setEditorialReviewed(false);
      setError(null);
      await loadPosts();
      setMessage('Article archived.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Article could not be archived.');
    } finally {
      setSaving(false);
    }
  };

  const suggestTopics = async () => {
    setGeminiLoading('topics');
    setError(null);
    try {
      const data: any = await generateAdminBlog({ action: 'topics', audience, keywords: draft.focusKeyword });
      setTopicIdeas(Array.isArray(data.topics) ? data.topics : []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Gemini topic suggestions failed.');
    } finally {
      setGeminiLoading(null);
    }
  };

  const generateDraft = async () => {
    setGeminiLoading('draft');
    setError(null);
    try {
      const data = await generateAdminBlog({ action: 'draft', topic, audience, keywords: draft.focusKeyword }) as GeminiBlogDraft;
      setDraft((current) => ({
        ...current,
        title: data.title,
        slug: data.suggestedSlug,
        excerpt: data.excerpt,
        contentHtml: data.contentHtml,
        focusKeyword: data.focusKeyword,
        tags: data.tags,
        seoTitle: data.seoTitle,
        metaDescription: data.metaDescription,
        status: 'draft',
      }));
      setEditorialReviewed(false);
      setMessage('Gemini draft loaded. Review facts, links, claims, and wording before publishing.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Gemini draft generation failed.');
    } finally {
      setGeminiLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div><h2 className="text-2xl font-semibold">Blog publishing</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">Write, optimize, schedule, publish, and archive public SEOIntel articles. Gemini creates drafts only; administrators remain responsible for review.</p></div>
        <button type="button" onClick={startNew} className="trust-button"><FilePlus2 className="h-4 w-4" /> New article</button>
      </div>

      {error && <Notice tone="danger" title="Blog action failed">{error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}

      <div className="grid gap-6 2xl:grid-cols-[320px_minmax(0,1fr)]">
        <Panel className="h-fit overflow-hidden p-0 2xl:sticky 2xl:top-24">
          <div className="border-b border-border p-4"><label className="relative block"><span className="sr-only">Search articles</span><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search articles" className="suite-input pl-9" /></label></div>
          <div className="max-h-[680px] overflow-y-auto p-2">
            {loading ? <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-accent" /></div> : filteredPosts.length ? filteredPosts.map((post) => (
              <button key={post.id} type="button" onClick={() => selectPost(post)} className={`mb-1 w-full rounded-xl p-3 text-left ${selectedId === post.id ? 'bg-accent/10 text-accent' : 'hover:bg-muted'}`}>
                <span className="line-clamp-2 text-sm font-semibold">{post.title}</span>
                <span className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground"><StatusBadge tone={post.status === 'published' ? 'success' : post.status === 'archived' ? 'danger' : 'warning'}>{post.status}</StatusBadge><span>{dateLabel(post.updatedAt)}</span></span>
              </button>
            )) : <EmptyState icon={FilePlus2} title="No articles" description="Create the first SEOIntel article." />}
          </div>
        </Panel>

        <div className="min-w-0 space-y-6">
          <Panel className="p-5 sm:p-6">
            <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
              <div><h3 className="text-xl font-semibold">{selectedId ? 'Edit article' : 'New article'}</h3><p className="mt-1 text-sm text-muted-foreground">Drafts are private. Publication requires complete SEO fields and useful article content.</p></div>
              <div className="flex flex-wrap gap-2">
                {selectedId && <button type="button" onClick={archive} disabled={saving} className="quiet-button text-red-600"><Archive className="h-4 w-4" /> Archive</button>}
                <button type="button" onClick={() => persist('draft')} disabled={saving} className="quiet-button"><Save className="h-4 w-4" /> Save draft</button>
                <button type="button" onClick={() => persist('published')} disabled={saving || !draft.publishedAt || !editorialReviewed} className="quiet-button"><CalendarDays className="h-4 w-4" /> Schedule</button>
                <button type="button" onClick={() => persist('published', true)} disabled={saving || !editorialReviewed} className="trust-button">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe2 className="h-4 w-4" />} Publish now</button>
              </div>
            </div>

            <label className="mt-5 flex items-start gap-3 rounded-lg border border-border bg-muted/25 p-3 text-sm leading-6">
              <input type="checkbox" checked={editorialReviewed} onChange={(event) => setEditorialReviewed(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]" />
              <span><span className="font-semibold text-foreground">Editorial review complete.</span> <span className="text-muted-foreground">Facts, links, claims, originality, and source attribution have been checked by an administrator.</span></span>
            </label>

            <div className="mt-6 grid gap-5 lg:grid-cols-2">
              <FormField label="Article title" htmlFor="blog-title"><input id="blog-title" value={draft.title} onChange={(event) => { const title = event.target.value; setDraft((current) => ({ ...current, title, slug: selectedId ? current.slug : createBlogSlug(title) })); setEditorialReviewed(false); }} className="suite-input" maxLength={140} /></FormField>
              <FormField label="URL slug" htmlFor="blog-slug" hint="The server adds a numeric suffix if another article already uses this slug."><div className="flex rounded-lg border border-border bg-card focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15"><span className="flex items-center border-r border-border px-3 text-sm text-muted-foreground">/blog/</span><input id="blog-slug" value={draft.slug} onChange={(event) => update('slug', createBlogSlug(event.target.value))} className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm outline-none" maxLength={120} /></div></FormField>
              <FormField label="Focus phrase" htmlFor="blog-keyword"><input id="blog-keyword" value={draft.focusKeyword} onChange={(event) => update('focusKeyword', event.target.value)} className="suite-input" maxLength={100} /></FormField>
              <FormField label="Tags" htmlFor="blog-tags" hint="Comma-separated; up to 12 tags."><input id="blog-tags" value={draft.tags.join(', ')} onChange={(event) => update('tags', event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean))} className="suite-input" /></FormField>
            </div>
            <div className="mt-5"><FormField label="Excerpt" htmlFor="blog-excerpt" hint={`${draft.excerpt.length}/360 characters`}><textarea id="blog-excerpt" value={draft.excerpt} onChange={(event) => update('excerpt', event.target.value)} className="suite-input min-h-28 resize-y" maxLength={360} /></FormField></div>
            <div className="mt-5"><FormField label="Article content"><RichTextEditor value={draft.contentHtml} onChange={(contentHtml) => update('contentHtml', contentHtml)} /></FormField></div>
          </Panel>

          <Panel className="p-5 sm:p-6">
            <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2 text-accent"><Bot className="h-5 w-5" /><h3 className="text-xl font-semibold">Gemini draft assistant</h3></div><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Optional server-side drafting. Generated content is never published automatically and must be reviewed for factual accuracy, originality, links, and claims.</p></div><button type="button" onClick={suggestTopics} disabled={Boolean(geminiLoading)} className="quiet-button">{geminiLoading === 'topics' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Suggest topics</button></div>
            <div className="mt-5 grid gap-4 lg:grid-cols-2"><FormField label="Topic" htmlFor="gemini-topic"><input id="gemini-topic" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="Example: How to prioritize technical SEO fixes" className="suite-input" /></FormField><FormField label="Audience" htmlFor="gemini-audience"><input id="gemini-audience" value={audience} onChange={(event) => setAudience(event.target.value)} className="suite-input" /></FormField></div>
            {topicIdeas.length > 0 && <div className="mt-5 grid gap-3 md:grid-cols-2">{topicIdeas.map((idea) => <button key={idea.title} type="button" onClick={() => setTopic(idea.title)} className="rounded-xl border border-border p-4 text-left hover:border-accent/30 hover:bg-muted"><span className="text-sm font-semibold">{idea.title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{idea.angle}</span></button>)}</div>}
            <button type="button" onClick={generateDraft} disabled={Boolean(geminiLoading) || topic.trim().length < 5} className="trust-button mt-5">{geminiLoading === 'draft' ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />} Generate review draft</button>
          </Panel>

          <Panel className="p-5 sm:p-6">
            <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="text-xl font-semibold">Search preview and SEO checks</h3><p className="mt-1 text-sm text-muted-foreground">Deterministic checks guide the editor; they do not guarantee Google rankings.</p></div><button type="button" onClick={autoFillSeo} className="quiet-button"><RefreshCw className="h-4 w-4" /> Auto-fill SEO</button></div>
            <div className="mt-5 grid gap-5 lg:grid-cols-2"><FormField label="SEO title" htmlFor="blog-seo-title" hint={`${draft.seoTitle.length}/60 recommended characters`}><input id="blog-seo-title" value={draft.seoTitle} onChange={(event) => update('seoTitle', event.target.value)} className="suite-input" maxLength={70} /></FormField><FormField label="Meta description" htmlFor="blog-meta" hint={`${draft.metaDescription.length}/160 recommended characters`}><textarea id="blog-meta" value={draft.metaDescription} onChange={(event) => update('metaDescription', event.target.value)} className="suite-input min-h-24 resize-y" maxLength={180} /></FormField><FormField label="Canonical URL override" htmlFor="blog-canonical" hint="Leave empty to use the article URL."><input id="blog-canonical" type="url" value={draft.canonicalUrl} onChange={(event) => update('canonicalUrl', event.target.value)} className="suite-input" placeholder="https://keywordsintel.vercel.app/blog/article-slug" /></FormField><FormField label="Social image URL" htmlFor="blog-og-image"><input id="blog-og-image" type="url" value={draft.ogImageUrl} onChange={(event) => update('ogImageUrl', event.target.value)} className="suite-input" placeholder="https://.../article-image.jpg" /></FormField><FormField label="Publish date" htmlFor="blog-publish-date" hint="A future date schedules public visibility."><input id="blog-publish-date" type="datetime-local" value={draft.publishedAt} onChange={(event) => update('publishedAt', event.target.value)} className="suite-input" /></FormField></div>
            <div className="mt-6 rounded-xl border border-border bg-white p-5 text-slate-900"><div className="text-sm text-emerald-700">keywordsintel.vercel.app / blog / {draft.slug || 'article-slug'}</div><div className="mt-1 text-xl text-[#1a0dab]">{draft.seoTitle || draft.title || 'Article SEO title'}</div><p className="mt-1 text-sm leading-6 text-slate-700">{draft.metaDescription || draft.excerpt || 'Article meta description preview.'}</p></div>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">{checklist.map((item) => <div key={item.label} className={`flex gap-2 rounded-lg border p-3 text-sm ${item.pass ? 'border-emerald-500/20 bg-emerald-500/8 text-emerald-800 dark:text-emerald-200' : 'border-border bg-muted/35 text-muted-foreground'}`}>{item.pass ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}{item.label}</div>)}</div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
