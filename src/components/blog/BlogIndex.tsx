import { useEffect, useMemo, useState } from 'react';
import './blog-list.css';
import { ArrowRight, BookOpen, CalendarDays, Clock, Search } from 'lucide-react';
import { getPublishedPosts } from '../../lib/blog/client';
import { usePageMetadata } from '../../lib/blog/metadata';
import type { BlogListResult } from '../../lib/blog/types';
import { EmptyState, LoadingSkeleton } from '../ui/visual-system';
import { Notice } from '../ui/page-system';
import { BRAND } from '../../lib/brand';
import { categoryColor } from '../ui/category-presentation';

const PAGE_SIZE = 9;

function topicColor(topic: string) {
  const value = topic.toLowerCase();
  return categoryColor(value.includes('accessib') ? 'accessibility' : value.includes('technical') ? 'technical' : value.includes('crawl') ? 'crawlability' : value.includes('performance') ? 'performance' : value.includes('security') ? 'security' : value.includes('structured') ? 'structured-data' : value.includes('link') ? 'links' : 'seo');
}

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
  const featured = !submittedQuery && offset === 0 ? result?.posts[0] : undefined;
  const articles = featured ? result?.posts.slice(1) : result?.posts;
  const featuredSections = useMemo(() => {
    if (!featured?.contentHtml) return [];
    const document = new DOMParser().parseFromString(featured.contentHtml, 'text/html');
    return [...document.querySelectorAll('h2')].map(heading => heading.textContent?.trim() || '').filter(Boolean).slice(0, 3);
  }, [featured?.contentHtml]);

  return (
    <main id="main-content" className="bg-background text-foreground">
      <div className="section-shell blog-index-shell py-8 md:pt-14">
        <header className="journal-header mb-8 flex flex-col items-stretch justify-between gap-6 md:mb-10 md:flex-row md:items-center md:gap-10">
          <div><h1 data-route-focus-target className="break-words font-semibold">The Crawlio Journal</h1><p className="mt-4 text-lg text-muted-foreground">Practical guides for a better website.</p></div>
          <form onSubmit={(event) => { event.preventDefault(); setOffset(0); setSubmittedQuery(query.trim()); }} className="journal-search min-w-0">
            <div className="flex min-h-12 min-w-0 flex-1 items-center rounded-md border border-border bg-background focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
              <label htmlFor="journal-search-input" className="sr-only">Search blog articles</label>
              <Search className="ml-3 h-5 w-5 shrink-0 text-muted-foreground" />
              <input id="journal-search-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search articles" className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm outline-none placeholder:text-[var(--muted-foreground)]" />
              <button type="submit" className="journal-search-submit m-0.5 grid h-11 w-11 shrink-0 place-items-center rounded text-accent hover:bg-muted" aria-label="Search articles" title="Search articles"><ArrowRight className="h-4 w-4" /></button>
            </div>
          </form>
        </header>
        <nav aria-label="Article topics" className="journal-topics flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border md:gap-x-8">
          <a href="/blog" className="inline-flex min-h-12 items-center gap-2 border-b-2 border-transparent py-2 text-sm text-muted-foreground hover:text-accent" aria-current={!submittedQuery ? 'page' : undefined}>All articles</a>
          {result?.topics?.length ? (
            <>
              {result.topics.slice(0, 12).map((topic) => (
                <a key={topic.slug} href={`/blog/topic/${topic.slug}`} className="inline-flex min-h-12 items-center gap-2 border-b-2 border-transparent py-2 text-sm text-muted-foreground hover:text-accent">
                  {topic.name} <span className="text-xs tabular-nums">{topic.articleCount}</span>
                </a>
              ))}
            </>
          ) : null}
        </nav>

        {error && <Notice tone="danger" title="Blog unavailable">{error}</Notice>}
        {loading ? <LoadingSkeleton rows={6} /> : result?.posts.length ? (
          <>
          {featured && <article className={`journal-feature grid items-center gap-8 border-b border-border py-8 md:gap-12 md:py-12 ${featured.ogImageUrl ? 'journal-feature-with-image' : ''}`}>
            <div className="min-w-0">
              <div className="journal-topic break-words text-sm font-semibold leading-relaxed text-accent" style={{ color: topicColor(featured.topicCluster || featured.tags[0] || '') }}>{featured.topicCluster || featured.tags[0] || 'Website audits'}</div>
              <h2 className="mt-4 break-words text-3xl font-semibold leading-tight md:text-4xl"><a href={`/blog/${featured.slug}`} className="hover:text-accent">{featured.title}</a></h2>
              <p className="journal-feature-excerpt mt-5 text-lg leading-8 text-muted-foreground">{featured.tagline || featured.excerpt}</p>
              <div className="journal-article-meta mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs leading-relaxed text-muted-foreground"><span>{formatDate(featured.publishedAt)}</span><span>{featured.readingTimeMinutes} min read</span></div>
              <a href={`/blog/${featured.slug}`} className="journal-read-link mt-5 inline-flex min-h-11 items-center gap-3 text-base font-semibold text-accent hover:underline underline-offset-4" aria-label={`Read ${featured.title}`}>Read guide <ArrowRight className="h-4 w-4" /></a>
            </div>
            {featured.ogImageUrl ? <a href={`/blog/${featured.slug}`} className="journal-feature-image" tabIndex={-1} aria-hidden="true"><img src={featured.ogImageUrl} alt={featured.ogImageAlt || ''} decoding="async" className="block aspect-video h-auto w-full rounded-md border border-border object-cover" width={featured.imageVariants[0]?.width || 960} height={featured.imageVariants[0]?.height || 540} /></a> : featuredSections.length > 0 ? <aside className="journal-guide-outline min-w-0 md:border-l md:border-border md:pl-8" aria-label={`In ${featured.title}`}><h3 className="text-base font-semibold">In this guide</h3><ol className="mt-6 flex flex-col gap-6">{featuredSections.map((heading, index) => <li key={`${heading}-${index}`} className="flex items-start gap-4"><span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-semibold text-accent">{index + 1}</span><p className="break-words pt-1 text-base leading-relaxed">{heading}</p></li>)}</ol></aside> : null}
          </article>}
          {Boolean(articles?.length) && <section aria-labelledby="latest-articles-title" className="journal-latest pt-10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="latest-articles-title" className="break-words text-2xl font-semibold">{submittedQuery ? `Results for "${submittedQuery}"` : 'Latest guides'}</h2>
              <p className="text-xs text-muted-foreground">{result.total} published article{result.total === 1 ? '' : 's'}</p>
            </div>
            <div className="journal-article-grid mt-8 grid gap-8 md:grid-cols-2 md:gap-x-12 md:gap-y-10">
              {articles?.map((post) => (
                <article key={post.id} className="blog-article-card flex min-w-0 flex-col gap-5 border-b border-border pb-8 last:border-b-0 last:pb-0 md:border-b-0 md:pb-0">
                  {post.ogImageUrl && <a href={`/blog/${post.slug}`} tabIndex={-1} aria-hidden="true"><img src={post.ogImageUrl} alt={post.ogImageAlt || ''} loading="lazy" decoding="async" className="block aspect-video h-auto w-full rounded-md border border-border object-cover" width={post.imageVariants[0]?.width || 960} height={post.imageVariants[0]?.height || 540} /></a>}
                  <div className="min-w-0">
                    <div className="journal-topic break-words text-sm font-semibold leading-relaxed text-accent" style={{ color: topicColor(post.topicCluster || post.tags[0] || '') }}>{post.topicCluster || post.tags[0] || 'Website audits'}</div>
                    <h3 className="mt-3 break-words text-xl font-semibold leading-snug"><a href={`/blog/${post.slug}`} className="hover:text-accent">{post.title}</a></h3>
                    <p className="mt-3 line-clamp-3 text-base leading-7 text-muted-foreground">{post.excerpt}</p>
                    <div className="journal-article-meta mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs leading-relaxed text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{formatDate(post.publishedAt)}</span>
                      <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4" />{post.readingTimeMinutes} min read</span>
                    </div>
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
          </section>}
          </>
        ) : (
          <EmptyState icon={BookOpen} title="No published articles found" description={submittedQuery ? 'Try a broader search phrase.' : 'Published Crawlio guides will appear here.'} />
        )}
        <div className="journal-footer mt-12 flex flex-wrap items-center justify-between gap-6 border-t border-border pt-8"><div className="flex flex-wrap items-center gap-5"><h2 className="text-lg font-semibold">Put the guide into practice.</h2><a href="/#start-audit" className="trust-button">Start an audit <ArrowRight className="h-4 w-4" /></a></div><nav aria-label="Article feeds" className="flex flex-wrap items-center gap-5 text-sm text-muted-foreground"><a href="/sitemap.xml" className="inline-flex min-h-11 items-center hover:text-accent">Sitemap</a><a href="/rss.xml" className="inline-flex min-h-11 items-center hover:text-accent">RSS</a></nav></div>
      </div>
    </main>
  );
}
