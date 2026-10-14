import type { BlogPost } from './types';
import { BRAND } from '../brand';
import { getArticleSchemaType, getBlogTopicName, getBlogTopicSlug } from './publication';
import { BLOG_ARTICLE_CSS, BLOG_PUBLIC_HEADER, BLOG_PUBLIC_THEME_CSS } from './public-style';
import { blogArticleUrl } from './seo';

function escapeHtml(value: unknown) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));
}

function safeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function formatDate(value: string, style: 'medium' | 'long' = 'medium') {
  return new Intl.DateTimeFormat('en', { dateStyle: style, timeZone: 'UTC' }).format(new Date(value));
}

export function renderBlogArticleHtml(post: BlogPost, origin: string) {
  const canonical = blogArticleUrl(origin, post.slug);
  const published = !post.fixtureTest && post.status === 'published' && Boolean(post.publishedAt) && new Date(post.publishedAt || 0).getTime() <= Date.now();
  const robots = published ? post.robotsDirective || 'index,follow,max-image-preview:large' : 'noindex,nofollow';
  const description = post.metaDescription || post.excerpt;
  const topic = getBlogTopicName(post);
  const topicUrl = `/blog/topic/${encodeURIComponent(getBlogTopicSlug(topic))}`;
  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': getArticleSchemaType(post.articleType),
    headline: post.title,
    description,
    image: post.ogImageUrl || undefined,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    mainEntityOfPage: canonical,
    author: { '@type': 'Organization', name: BRAND.editorialTeam, url: origin },
    publisher: { '@type': 'Organization', name: BRAND.name, url: origin },
    keywords: post.tags.join(', '),
    articleSection: topic,
    wordCount: post.contentText.split(/\s+/).filter(Boolean).length,
    inLanguage: post.language || 'en',
    isAccessibleForFree: true,
  };
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: origin },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${origin}/blog` },
      { '@type': 'ListItem', position: 3, name: topic, item: `${origin}${topicUrl}` },
      { '@type': 'ListItem', position: 4, name: post.title, item: canonical },
    ],
  };
  const sources = post.sources.length
    ? `<section class="references" aria-labelledby="sources-title"><h2 id="sources-title">Sources and references</h2><ul>${post.sources.map((source) => `<li><a href="${escapeHtml(source.url)}" rel="noopener noreferrer">${escapeHtml(source.title)}</a><span>${escapeHtml(source.publisher)}</span></li>`).join('')}</ul></section>`
    : '';
  const related = post.relatedArticles.length
    ? `<section class="related" aria-labelledby="related-title"><h2 id="related-title">Continue reading</h2><ul>${post.relatedArticles.map((article) => `<li><a href="/blog/${encodeURIComponent(article.slug)}">${escapeHtml(article.title)}</a>${article.reason ? `<p>${escapeHtml(article.reason)}</p>` : ''}</li>`).join('')}</ul></section>`
    : '';
  const readyVariants = post.imageVariants.filter((variant) => variant.status === 'ready');
  const webpSrcset = readyVariants.filter((variant) => variant.format === 'webp').sort((left, right) => left.width - right.width).map((variant) => `${variant.storageUrl} ${variant.width}w`).join(', ');
  const avifSrcset = readyVariants.filter((variant) => variant.format === 'avif').sort((left, right) => left.width - right.width).map((variant) => `${variant.storageUrl} ${variant.width}w`).join(', ');
  const dimensions = readyVariants[0];
  const heroImage = post.ogImageUrl ? `<figure><picture>${avifSrcset ? `<source type="image/avif" srcset="${escapeHtml(avifSrcset)}" sizes="(max-width: 820px) 100vw, 820px">` : ''}${webpSrcset ? `<source type="image/webp" srcset="${escapeHtml(webpSrcset)}" sizes="(max-width: 820px) 100vw, 820px">` : ''}<img class="hero-image" src="${escapeHtml(post.ogImageUrl)}" alt="${escapeHtml(post.ogImageAlt || post.title)}" sizes="(max-width: 820px) 100vw, 820px"${dimensions ? ` width="${dimensions.width}" height="${dimensions.height}"` : ''} loading="eager" decoding="async"></picture>${post.ogImageAttribution ? `<figcaption>${escapeHtml(post.ogImageAttribution)}</figcaption>` : ''}</figure>` : '';
  const updated = post.updatedAt && post.updatedAt !== post.publishedAt
    ? `<span>&middot;</span><span>Updated <time datetime="${escapeHtml(post.updatedAt)}">${escapeHtml(formatDate(post.updatedAt))}</time></span>`
    : '';

  return `<!doctype html>
<html lang="${escapeHtml(post.language || 'en')}">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(post.seoTitle || post.title)}</title>
<meta name="description" content="${escapeHtml(description)}"><meta name="robots" content="${escapeHtml(robots)}">
<link rel="canonical" href="${escapeHtml(canonical)}"><link rel="alternate" type="application/rss+xml" title="${escapeHtml(BRAND.name)} Blog RSS" href="${escapeHtml(`${origin}/rss.xml`)}">
<meta property="og:type" content="article"><meta property="og:site_name" content="${escapeHtml(BRAND.name)}"><meta property="og:title" content="${escapeHtml(post.ogTitle || post.seoTitle || post.title)}"><meta property="og:description" content="${escapeHtml(post.ogDescription || description)}"><meta property="og:url" content="${escapeHtml(canonical)}">
${post.publishedAt ? `<meta property="article:published_time" content="${escapeHtml(post.publishedAt)}">` : ''}<meta property="article:modified_time" content="${escapeHtml(post.updatedAt)}"><meta property="article:section" content="${escapeHtml(topic)}">${post.tags.map((tag) => `<meta property="article:tag" content="${escapeHtml(tag)}">`).join('')}
<meta name="twitter:title" content="${escapeHtml(post.ogTitle || post.seoTitle || post.title)}"><meta name="twitter:description" content="${escapeHtml(post.ogDescription || description)}">
${post.ogImageUrl ? `<meta property="og:image" content="${escapeHtml(post.ogImageUrl)}"><meta property="og:image:alt" content="${escapeHtml(post.ogImageAlt || post.title)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${escapeHtml(post.ogImageUrl)}"><meta name="twitter:image:alt" content="${escapeHtml(post.ogImageAlt || post.title)}">` : '<meta name="twitter:card" content="summary">'}
<script type="application/ld+json">${safeJson(articleSchema)}</script><script type="application/ld+json">${safeJson(breadcrumbSchema)}</script>
<script src="/blog-theme.js"></script>
<style>${BLOG_PUBLIC_THEME_CSS}${BLOG_ARTICLE_CSS}</style>
</head>
<body>${BLOG_PUBLIC_HEADER}<main><article><div class="meta"><a href="${topicUrl}">${escapeHtml(topic)}</a><span>&middot;</span><span>${post.readingTimeMinutes} min read</span>${post.publishedAt ? `<span>&middot;</span><span>Published <time datetime="${escapeHtml(post.publishedAt)}">${escapeHtml(formatDate(post.publishedAt, 'long'))}</time></span>` : ''}${updated}</div><h1>${escapeHtml(post.title)}</h1>${post.tagline ? `<p class="tagline">${escapeHtml(post.tagline)}</p>` : ''}<p class="editorial-note">Checked for source links, structure, originality signals, and practical value by ${escapeHtml(BRAND.name)}'s guarded publishing workflow. Automated checks support, but do not replace, reader judgment.</p>${heroImage}<div class="article-body">${post.contentHtml}</div>${sources}${related}<section class="article-cta" aria-label="Audit your website"><div><h2>Apply the guidance to your own website</h2><p>Run a public-page audit and see which fixes deserve attention first.</p></div><a href="/#start-audit">Start free audit</a></section></article></main></body></html>`;
}
