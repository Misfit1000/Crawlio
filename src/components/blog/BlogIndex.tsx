import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BookOpen, CalendarDays, Clock, Search } from 'lucide-react';
import { getPublishedPosts } from '../../lib/blog/client';
import { usePageMetadata } from '../../lib/blog/metadata';
import type { BlogListResult } from '../../lib/blog/types';
import { EmptyState, LoadingSkeleton, StatusBadge } from '../ui/visual-system';
import { Notice, PageHeader, Panel } from '../ui/page-system';
import { BRAND } from '../../lib/brand';

const PAGE_SIZE = 9;

function formatDate(value: string | null) {
  if (!value) return 'Recently published';
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value));
}

export default function BlogIndex() {
  const [result, setResult] = useState<BlogListResult | null>(null);
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const collectionSchema = useMemo(() => ({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${BRAND.name} Blog`,
    description: 'Practical guides for SEO audits, technical SEO, crawlability, website health, and passive security.',
    url: `${window.location.origin}/blog`,
  }), []);

  usePageMetadata({
    title: `${BRAND.name} Blog - Practical SEO and Website Audit Guides`,
    description: 'Practical guides for on-page SEO, technical SEO, crawlability, website health, reporting, and passive browser security checks.',
    canonicalPath: '/blog',
    jsonLd: collectionSchema,
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getPublishedPosts({ query: submittedQuery, limit: PAGE_SIZE, offset })
      .then((data) => active && setResult(data))
      .catch((requestError) => active && setError(requestError instanceof Error ? requestError.message : 'Articles could not be loaded.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [offset, submittedQuery]);

  const totalPages = Math.max(1, Math.ceil((result?.total || 0) / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <main id="main-content" className="bg-background text-foreground">
      <div className="section-shell space-y-10 py-12 sm:py-16 lg:py-20">
        <PageHeader
          eyebrow="Crawlio editorial"
          icon={BookOpen}
          title="Practical SEO engineering guides"
          description="Clear, evidence-conscious guidance for auditing websites, prioritizing fixes, and understanding technical SEO without unsupported ranking promises."
        />

        <Panel className="p-4 sm:p-5">
          <form onSubmit={(event) => { event.preventDefault(); setOffset(0); setSubmittedQuery(query.trim()); }} className="flex flex-col gap-3 sm:flex-row">
            <label className="flex min-h-11 min-w-0 flex-1 items-center rounded-lg border border-border bg-card shadow-sm transition-[border-color,box-shadow] focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
              <span className="sr-only">Search blog articles</span>
              <Search className="ml-3 h-5 w-5 shrink-0 text-muted-foreground" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search audit and SEO guides" className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm font-medium outline-none placeholder:text-[var(--subtle-foreground)]" />
            </label>
            <button type="submit" className="trust-button">Search articles</button>
          </form>
          {result?.topics?.length ? (
            <nav aria-label="Article topics" className="mt-4 flex gap-2 overflow-x-auto border-t border-border pt-4">
              {result.topics.slice(0, 12).map((topic) => (
                <a key={topic.slug} href={`/blog/topic/${topic.slug}`} className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-accent hover:text-accent">
                  {topic.name} <span className="tabular-nums">({topic.articleCount})</span>
                </a>
              ))}
            </nav>
          ) : null}
        </Panel>

        {error && <Notice tone="danger" title="Blog unavailable">{error}</Notice>}
        {loading ? <LoadingSkeleton rows={6} /> : result?.posts.length ? (
          <section aria-labelledby="latest-articles-title" className="space-y-6">
            <div>
              <h2 id="latest-articles-title" className="text-2xl font-semibold">{submittedQuery ? `Results for "${submittedQuery}"` : 'Latest articles'}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{result.total} published article{result.total === 1 ? '' : 's'}</p>
            </div>
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {result.posts.map((post) => (
                <article key={post.id} className="suite-panel flex min-w-0 flex-col overflow-hidden">
                  {post.ogImageUrl ? <img src={post.ogImageUrl} alt={`Featured image for ${post.title}`} className="aspect-[16/9] w-full border-b border-border object-cover" loading="lazy" /> : (
                    <div className="flex aspect-[16/7] items-end border-b border-border bg-muted p-5">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent"><BookOpen className="h-5 w-5" /></div>
                    </div>
                  )}
                  <div className="flex flex-1 flex-col p-5 sm:p-6">
                    <div className="flex flex-wrap gap-2">{post.tags.slice(0, 3).map((tag) => <StatusBadge key={tag} tone="accent">{tag}</StatusBadge>)}</div>
                    <h3 className="mt-4 text-xl font-semibold leading-snug"><a href={`/blog/${post.slug}`} className="hover:text-accent">{post.title}</a></h3>
                    <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">{post.excerpt}</p>
                    <div className="mt-6 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{formatDate(post.publishedAt)}</span>
                      <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4" />{post.readingTimeMinutes} min read</span>
                    </div>
                    <a href={`/blog/${post.slug}`} className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-accent hover:underline">Read article <ArrowRight className="h-4 w-4" /></a>
                  </div>
                </article>
              ))}
            </div>
            {totalPages > 1 && (
              <nav className="flex items-center justify-center gap-3 pt-4" aria-label="Blog pagination">
                <button type="button" disabled={currentPage <= 1} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} className="quiet-button">Previous</button>
                <span className="text-sm text-muted-foreground">Page {currentPage} of {totalPages}</span>
                <button type="button" disabled={currentPage >= totalPages} onClick={() => setOffset(offset + PAGE_SIZE)} className="quiet-button">Next</button>
              </nav>
            )}
          </section>
        ) : (
          <Panel className="p-8"><EmptyState icon={BookOpen} title="No published articles found" description={submittedQuery ? 'Try a broader search phrase.' : 'Published Crawlio guides will appear here.'} /></Panel>
        )}
      </div>
      <footer className="border-t border-border bg-card"><div className="section-shell flex flex-col gap-3 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><span>Crawlio practical audit guidance</span><div className="flex flex-wrap gap-4"><a href="/" className="hover:text-accent">Product</a><a href="/#pricing" className="hover:text-accent">Plans</a><a href="/sitemap.xml" className="hover:text-accent">Sitemap</a><a href="/rss.xml" className="hover:text-accent">RSS</a></div></div></footer>
    </main>
  );
}
