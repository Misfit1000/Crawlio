import { useEffect, useMemo, useState } from 'react';
import './blog-list.css';
import { ArrowRight, BookOpen, CalendarDays, Clock, Search } from 'lucide-react';
import { getPublishedPosts } from '../../lib/blog/client';
import { usePageMetadata } from '../../lib/blog/metadata';
import type { BlogListResult } from '../../lib/blog/types';
import { EmptyState, LoadingSkeleton, StatusBadge } from '../ui/visual-system';
import { Notice, PageHeader } from '../ui/page-system';
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
      <div className="section-shell blog-index-shell space-y-6 py-8 sm:py-12">
        <PageHeader
          icon={BookOpen}
          title="Crawlio blog"
          description="Field notes on technical SEO, crawlability, and website health."
        />

        <div className="border-b border-border pb-5">
          <form onSubmit={(event) => { event.preventDefault(); setOffset(0); setSubmittedQuery(query.trim()); }} className="flex flex-col gap-3 sm:flex-row">
            <label className="flex min-h-11 min-w-0 flex-1 items-center rounded-lg border border-border bg-card focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
              <span className="sr-only">Search blog articles</span>
              <Search className="ml-3 h-5 w-5 shrink-0 text-muted-foreground" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search audit and SEO guides" className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm font-medium outline-none placeholder:text-[var(--subtle-foreground)]" />
            </label>
            <button type="submit" className="trust-button">Search articles</button>
          </form>
          {result?.topics?.length ? (
            <nav aria-label="Article topics" className="mt-4 flex gap-2 overflow-x-auto border-t border-border pt-4">
              {result.topics.slice(0, 12).map((topic) => (
                <a key={topic.slug} href={`/blog/topic/${topic.slug}`} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md border border-border px-3 text-xs font-semibold text-muted-foreground hover:border-accent hover:text-accent">
                  {topic.name} <span className="tabular-nums">({topic.articleCount})</span>
                </a>
              ))}
            </nav>
          ) : null}
        </div>

        {error && <Notice tone="danger" title="Blog unavailable">{error}</Notice>}
        {loading ? <LoadingSkeleton rows={6} /> : result?.posts.length ? (
          <section aria-labelledby="latest-articles-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="latest-articles-title" className="break-words text-base font-semibold">{submittedQuery ? `Results for "${submittedQuery}"` : 'Latest articles'}</h2>
              <p className="text-xs text-muted-foreground">{result.total} published article{result.total === 1 ? '' : 's'}</p>
            </div>
            <div>
              {result.posts.map((post, index) => (
                <article key={post.id} className={`blog-article-card ${index === 0 && !submittedQuery ? 'blog-featured' : ''}`}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-2">{post.tags.slice(0, 3).map((tag) => <StatusBadge key={tag} tone="neutral">{tag}</StatusBadge>)}</div>
                    <h3 className="mt-3 break-words text-xl font-semibold leading-snug"><a href={`/blog/${post.slug}`} className="hover:text-accent">{post.title}</a></h3>
                    <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">{post.excerpt}</p>
                    <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{formatDate(post.publishedAt)}</span>
                      <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4" />{post.readingTimeMinutes} min read</span>
                    </div>
                    <a href={`/blog/${post.slug}`} aria-label={`Read ${post.title}`} className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent hover:underline">Read article <ArrowRight className="h-4 w-4" /></a>
                  </div>
                  {post.ogImageUrl && <img src={post.ogImageUrl} alt={post.ogImageAlt || `Featured image for ${post.title}`} loading={index === 0 ? 'eager' : 'lazy'} decoding="async" />}
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
          <EmptyState icon={BookOpen} title="No published articles found" description={submittedQuery ? 'Try a broader search phrase.' : 'Published Crawlio guides will appear here.'} />
        )}
        <nav aria-label="Article feeds" className="flex flex-wrap items-center gap-x-5 border-t border-border pt-3 text-sm text-muted-foreground"><span className="font-semibold">Article feeds</span><a href="/sitemap.xml" className="inline-flex min-h-11 items-center hover:text-accent">Sitemap</a><a href="/rss.xml" className="inline-flex min-h-11 items-center hover:text-accent">RSS</a></nav>
      </div>
    </main>
  );
}
