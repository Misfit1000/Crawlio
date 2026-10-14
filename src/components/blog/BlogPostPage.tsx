import { useEffect, useMemo, useState } from 'react';
import './blog-content.css';
import { ArrowLeft, CalendarDays, Clock, Share2 } from 'lucide-react';
import { getPublishedPost } from '../../lib/blog/client';
import { usePageMetadata } from '../../lib/blog/metadata';
import type { BlogPost } from '../../lib/blog/types';
import { LoadingSkeleton } from '../ui/visual-system';
import { Notice } from '../ui/page-system';
import { BRAND } from '../../lib/brand';

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
    author: { '@type': 'Organization', name: BRAND.editorialTeam },
    publisher: { '@type': 'Organization', name: BRAND.name, url: window.location.origin },
  } : undefined, [post]);

  const article = useMemo(() => {
    if (!post) return { html: '', headings: [] as Array<{ id: string; title: string }> };
    const document = new DOMParser().parseFromString(post.contentHtml, 'text/html');
    const seen = new Set<string>();
    const headings = [...document.querySelectorAll('h2')].map((heading, index) => {
      let id = heading.id || `crawlio-section-${index + 1}`;
      while (seen.has(id) || (document.getElementById(id) && document.getElementById(id) !== heading)) id += '-section';
      seen.add(id);
      heading.id = id;
      return { id, title: heading.textContent?.trim() || '' };
    }).filter(heading => heading.title);
    return { html: document.body.innerHTML, headings };
  }, [post]);

  usePageMetadata({
    title: post?.seoTitle || post?.title || `${BRAND.name} Blog Article`,
    description: post?.metaDescription || post?.excerpt || `Practical ${BRAND.name} audit guidance.`,
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
      <div className="section-shell py-8 sm:py-12">
        <a href="/blog" className="inline-flex items-center gap-2 text-sm font-semibold text-accent hover:underline"><ArrowLeft className="h-4 w-4" /> All articles</a>
        {loading ? <div className="mt-8"><LoadingSkeleton rows={8} /></div> : error || !post ? (
          <div className="mt-8"><Notice tone="danger" title="Article unavailable">{error || 'This article is not published.'}</Notice></div>
        ) : (
          <article className="blog-reading mx-auto mt-10 max-w-6xl">
            <header className="blog-article-header mx-auto max-w-4xl border-b border-border pb-10">
              <div className="blog-article-tags flex flex-wrap gap-x-5 gap-y-2 text-sm text-accent">{post.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
              <h1 data-route-focus-target className="mt-5 break-words font-semibold leading-tight">{post.title}</h1>
              <p className="mt-5 text-lg leading-8 text-muted-foreground">{post.tagline || post.excerpt}</p>
              {post.summary && post.summary !== (post.tagline || post.excerpt) && <p className="blog-article-summary mt-6 pl-4 text-base leading-7 text-muted-foreground">{post.summary}</p>}
              <p className="mt-5 text-xs font-semibold">{BRAND.editorialTeam}</p>
              <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4" />{formatDate(post.publishedAt)}</span>
                <span className="inline-flex items-center gap-2"><Clock className="h-4 w-4" />{post.readingTimeMinutes} min read</span>
                <button type="button" onClick={copyLink} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent hover:underline"><Share2 className="h-4 w-4" /><span aria-live="polite">{shareMessage || 'Share'}</span></button>
              </div>
            </header>
            <div className={`blog-article-layout mt-10 grid items-start gap-12 ${article.headings.length ? '' : 'blog-article-layout-single'}`}>
            <div className="blog-article-main min-w-0">
            {post.ogImageUrl && <figure className="mb-10"><picture>{post.imageVariants.some((variant) => variant.status === 'ready' && variant.format === 'avif') && <source type="image/avif" srcSet={post.imageVariants.filter((variant) => variant.status === 'ready' && variant.format === 'avif').sort((left, right) => left.width - right.width).map((variant) => `${variant.storageUrl} ${variant.width}w`).join(', ')} sizes="(max-width: 1024px) 100vw, 720px" />}{post.imageVariants.some((variant) => variant.status === 'ready' && variant.format === 'webp') && <source type="image/webp" srcSet={post.imageVariants.filter((variant) => variant.status === 'ready' && variant.format === 'webp').sort((left, right) => left.width - right.width).map((variant) => `${variant.storageUrl} ${variant.width}w`).join(', ')} sizes="(max-width: 1024px) 100vw, 720px" />}<img src={post.ogImageUrl} alt={post.ogImageAlt || `Featured image for ${post.title}`} sizes="(max-width: 1024px) 100vw, 720px" width={post.imageVariants[0]?.width || 960} height={post.imageVariants[0]?.height || 540} decoding="async" className="h-auto w-full rounded-lg border border-border" /></picture>{post.ogImageAttribution && <figcaption className="mt-2 text-xs text-muted-foreground">{post.ogImageAttribution}</figcaption>}</figure>}
            <div className="blog-prose" dangerouslySetInnerHTML={{ __html: article.html }} />
            {post.sources.length > 0 && <section className="mt-12 border-t border-border pt-8" aria-labelledby="article-sources"><h2 id="article-sources" className="text-2xl font-semibold">Sources and references</h2><ul className="mt-4 divide-y divide-border">{post.sources.map((source) => <li key={source.url} className="py-4"><a href={source.url} target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">{source.title}</a><p className="mt-1 text-sm text-muted-foreground">{source.publisher}{source.author ? ` · ${source.author}` : ''}</p></li>)}</ul></section>}
            {post.relatedArticles.length > 0 && <section className="mt-12 border-t border-border pt-8" aria-labelledby="related-articles"><h2 id="related-articles" className="text-2xl font-semibold">Related articles</h2><div className="mt-6 grid gap-6 sm:grid-cols-2">{post.relatedArticles.map((related) => <a key={related.postId} href={`/blog/${related.slug}`} className="inline-flex min-h-11 flex-col hover:text-accent"><span className="font-semibold">{related.title}</span>{related.reason && <span className="mt-2 block text-sm leading-6 text-muted-foreground">{related.reason}</span>}</a>)}</div></section>}
            <section className="mt-12 border-t border-border pt-6">
              <div><h2 className="text-xl font-semibold">Put the guidance to work</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Run a Crawlio audit for page findings, crawl evidence, and fix priorities.</p><a href="/#start-audit" className="trust-button mt-4">Start a free audit</a></div>
            </section>
            </div>
            {article.headings.length > 0 && <aside className="blog-article-outline row-start-1 border-b border-border pb-6 lg:sticky lg:top-24 lg:row-auto lg:border-b-0 lg:border-l lg:pb-0 lg:pl-6"><h2 id="article-outline-title" className="text-sm font-semibold">On this page</h2><nav aria-labelledby="article-outline-title" className="grid gap-x-6 md:grid-cols-2 lg:block">{article.headings.slice(0, 10).map(heading => <a key={heading.id} href={`#${encodeURIComponent(heading.id)}`} className="block break-words py-3 text-sm leading-relaxed text-muted-foreground hover:text-accent">{heading.title}</a>)}</nav></aside>}
            </div>
          </article>
        )}
      </div>
    </main>
  );
}
