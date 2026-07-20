import type { BlogPost } from './types';
import { BRAND } from '../brand';
import { getArticleSchemaType, getBlogTopicName, getBlogTopicSlug } from './publication';

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
  const canonical = post.canonicalUrl || `${origin}/blog/${encodeURIComponent(post.slug)}`;
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
<style>:root{color-scheme:light;--ink:#112142;--muted:#5b6981;--line:#dce4ef;--blue:#2864e8;--soft:#f4f7fb}*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.72}a{color:#185bd8;text-underline-offset:3px}header{position:sticky;top:0;z-index:10;border-bottom:1px solid var(--line);background:rgba(255,255,255,.96)}.nav{max-width:1120px;margin:auto;padding:16px 24px;display:flex;justify-content:space-between;align-items:center;gap:20px}.brand{font-size:19px;font-weight:750;text-decoration:none;color:var(--ink)}.nav-links{display:flex;align-items:center;gap:20px;font-size:14px;font-weight:650}.audit-link{border-radius:8px;background:var(--blue);color:#fff;padding:9px 13px;text-decoration:none}main{max-width:820px;margin:auto;padding:56px 24px 84px}.meta{display:flex;flex-wrap:wrap;gap:8px;font-size:14px;color:var(--muted)}.meta a{font-weight:700;text-decoration:none}.tagline{font-size:20px;line-height:1.5;color:#455571}.hero-image{width:100%;height:auto;margin:28px 0 8px;border-radius:8px}figure{margin:0 0 36px}figure figcaption{color:var(--muted);font-size:12px}.editorial-note{margin:24px 0;padding:14px 16px;border-left:3px solid var(--blue);background:var(--soft);color:var(--muted);font-size:14px}.article-body{overflow-wrap:anywhere}.article-body img{max-width:100%;height:auto}.article-body a{overflow-wrap:anywhere}h1{font-size:clamp(2.2rem,6vw,4rem);line-height:1.08;letter-spacing:0;margin:14px 0 18px}h2{font-size:1.65rem;line-height:1.25;margin:48px 0 14px}h3{font-size:1.25rem;line-height:1.35;margin:32px 0 10px}p,li{font-size:17px}pre{overflow:auto;padding:18px;border:1px solid var(--line);border-radius:8px;background:var(--soft)}.references,.related,.article-cta{margin-top:52px;padding-top:28px;border-top:1px solid var(--line)}.references li,.related li{margin:10px 0}.references span{display:block;font-size:13px;color:#6b7890}.article-cta{display:flex;align-items:center;justify-content:space-between;gap:24px}.article-cta h2{margin:0;font-size:1.4rem}.article-cta p{margin:6px 0 0;color:var(--muted);font-size:15px}.article-cta a{flex:none;border-radius:8px;background:var(--blue);color:#fff;padding:11px 15px;text-decoration:none;font-weight:700}@media(max-width:640px){main{padding:36px 18px 64px}h1{font-size:2.35rem}.nav{padding:13px 18px}.nav-links a:not(.audit-link){display:none}p,li{font-size:16px}.article-cta{align-items:flex-start;flex-direction:column}}</style>
</head>
<body><header><nav class="nav" aria-label="Primary"><a class="brand" href="/">${escapeHtml(BRAND.name)}</a><div class="nav-links"><a href="/blog">Articles</a><a href="/rss.xml">RSS</a><a class="audit-link" href="/#start-audit">Start free audit</a></div></nav></header><main><article><div class="meta"><a href="${topicUrl}">${escapeHtml(topic)}</a><span>&middot;</span><span>${post.readingTimeMinutes} min read</span>${post.publishedAt ? `<span>&middot;</span><span>Published <time datetime="${escapeHtml(post.publishedAt)}">${escapeHtml(formatDate(post.publishedAt, 'long'))}</time></span>` : ''}${updated}</div><h1>${escapeHtml(post.title)}</h1>${post.tagline ? `<p class="tagline">${escapeHtml(post.tagline)}</p>` : ''}<p class="editorial-note">Checked for source links, structure, originality signals, and practical value by ${escapeHtml(BRAND.name)}'s guarded publishing workflow. Automated checks support, but do not replace, reader judgment.</p>${heroImage}<div class="article-body">${post.contentHtml}</div>${sources}${related}<section class="article-cta" aria-label="Audit your website"><div><h2>Apply the guidance to your own website</h2><p>Run a public-page audit and see which fixes deserve attention first.</p></div><a href="/#start-audit">Start free audit</a></section></article></main></body></html>`;
}
