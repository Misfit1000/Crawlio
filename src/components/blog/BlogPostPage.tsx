import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, CalendarDays, Clock, Share2 } from 'lucide-react';
import { getPublishedPost } from '../../lib/blog/client';
import { usePageMetadata } from '../../lib/blog/metadata';
import type { BlogPost } from '../../lib/blog/types';
import { LoadingSkeleton, StatusBadge } from '../ui/visual-system';
import { Notice, Panel } from '../ui/page-system';

function formatDate(value: string | null) {
  if (!value) return 'Recently published';
  return new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(new Date(value));
}

export default function BlogPostPage({ slug }: { slug: string }) {
  const [post, setPost] = useState<BlogPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    getPublishedPost(slug)
      .then((data) => active && setPost(data.post))
      .catch((requestError) => active && setError(requestError instanceof Error ? requestError.message : 'Article could not be loaded.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [slug]);

  const articleSchema = useMemo(() => post ? {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.metaDescription || post.excerpt,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    mainEntityOfPage: post.canonicalUrl || `${window.location.origin}/blog/${post.slug}`,
    image: post.ogImageUrl || undefined,
    author: { '@type': 'Organization', name: 'SEOIntel Editorial Team' },
    publisher: { '@type': 'Organization', name: 'SEOIntel', url: window.location.origin },
  } : undefined, [post]);

  usePageMetadata({
    title: post?.seoTitle || post?.title || 'SEOIntel Blog Article',
    description: post?.metaDescription || post?.excerpt || 'Practical SEOIntel audit guidance.',
    canonicalPath: post?.canonicalUrl || `/blog/${slug}`,
    image: post?.ogImageUrl || undefined,
    type: 'article',
    jsonLd: articleSchema,
  });

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareMessage('Link copied');
    } catch {
      setShareMessage('Copy the URL from your browser');
    }
    window.setTimeout(() => setShareMessage(''), 2500);
  };

  return (
    <main id="main-content" className="bg-background text-foreground">
      <div className="section-shell py-10 sm:py-14 lg:py-20">
        <a href="/blog" className="inline-flex items-center gap-2 text-sm font-semibold text-accent hover:underline"><ArrowLeft className="h-4 w-4" /> All articles</a>
        {loading ? <div className="mt-8"><LoadingSkeleton rows={8} /></div> : error || !post ? (
          <div className="mt-8"><Notice tone="danger" title="Article unavailable">{error || 'This article is not published.'}</Notice></div>
        ) : (
          <article className="mx-auto mt-8 max-w-4xl">
            <header className="border-b border-border pb-8">
              <div className="flex flex-wrap gap-2">{post.tags.map((tag) => <StatusBadge key={tag} tone="accent">{tag}</StatusBadge>)}</div>
              <h1 className="mt-5 text-4xl font-semibold leading-tight sm:text-5xl">{post.title}</h1>
              <p className="mt-5 text-lg leading-8 text-muted-foreground">{post.tagline || post.excerpt}</p>
              {post.summary && post.summary !== post.tagline && <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">{post.summary}</p>}
              <div className="mt-6 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4" />{formatDate(post.publishedAt)}</span>
                <span className="inline-flex items-center gap-2"><Clock className="h-4 w-4" />{post.readingTimeMinutes} min read</span>
                <button type="button" onClick={copyLink} className="inline-flex items-center gap-2 font-semibold text-accent hover:underline"><Share2 className="h-4 w-4" />{shareMessage || 'Share'}</button>
              </div>
            </header>
            {post.ogImageUrl && <figure className="mt-8"><picture>{post.imageVariants.some((variant) => variant.status === 'ready' && variant.format === 'avif') && <source type="image/avif" srcSet={post.imageVariants.filter((variant) => variant.status === 'ready' && variant.format === 'avif').sort((left, right) => left.width - right.width).map((variant) => `${variant.storageUrl} ${variant.width}w`).join(', ')} sizes="(max-width: 1024px) 100vw, 896px" />}{post.imageVariants.some((variant) => variant.status === 'ready' && variant.format === 'webp') && <source type="image/webp" srcSet={post.imageVariants.filter((variant) => variant.status === 'ready' && variant.format === 'webp').sort((left, right) => left.width - right.width).map((variant) => `${variant.storageUrl} ${variant.width}w`).join(', ')} sizes="(max-width: 1024px) 100vw, 896px" />}<img src={post.ogImageUrl} alt={post.ogImageAlt || `Featured image for ${post.title}`} sizes="(max-width: 1024px) 100vw, 896px" width={post.imageVariants[0]?.width} height={post.imageVariants[0]?.height} decoding="async" className="aspect-[16/9] w-full rounded-xl border border-border object-cover" /></picture>{post.ogImageAttribution && <figcaption className="mt-2 text-xs text-muted-foreground">{post.ogImageAttribution}</figcaption>}</figure>}
            <div className="blog-prose mt-10" dangerouslySetInnerHTML={{ __html: post.contentHtml }} />
            {post.sources.length > 0 && <section className="mt-12 border-t border-border pt-8" aria-labelledby="article-sources"><h2 id="article-sources" className="text-2xl font-semibold">Sources and references</h2><ul className="mt-4 space-y-3">{post.sources.map((source) => <li key={source.url} className="rounded-lg border border-border bg-muted/20 p-4"><a href={source.url} target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">{source.title}</a><p className="mt-1 text-sm text-muted-foreground">{source.publisher}{source.author ? ` · ${source.author}` : ''}</p></li>)}</ul></section>}
            {post.relatedArticles.length > 0 && <section className="mt-12 border-t border-border pt-8" aria-labelledby="related-articles"><h2 id="related-articles" className="text-2xl font-semibold">Related articles</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{post.relatedArticles.map((article) => <a key={article.postId} href={`/blog/${article.slug}`} className="rounded-lg border border-border p-4 transition hover:border-accent/40 hover:bg-muted/30"><span className="font-semibold text-foreground">{article.title}</span>{article.reason && <span className="mt-1 block text-sm leading-6 text-muted-foreground">{article.reason}</span>}</a>)}</div></section>}
            <Panel className="mt-12 p-6 sm:p-8">
              <div className="flex items-start gap-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><BookOpen className="h-5 w-5" /></div><div><h2 className="text-xl font-semibold">Apply the guidance with measured evidence</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Run an SEOIntel audit to connect these recommendations to real page findings, crawl evidence, and fix priorities.</p><a href="/#start-audit" className="trust-button mt-4">Start a free audit</a></div></div>
            </Panel>
          </article>
        )}
      </div>
    </main>
  );
}
