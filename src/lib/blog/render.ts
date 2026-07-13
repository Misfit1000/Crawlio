import type { BlogPost } from './types';

function escapeHtml(value: string) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));
}

function safeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function renderBlogArticleHtml(post: BlogPost, origin: string) {
  const canonical = post.canonicalUrl || `${origin}/blog/${encodeURIComponent(post.slug)}`;
  const published = post.status === 'published' && Boolean(post.publishedAt) && new Date(post.publishedAt || 0).getTime() <= Date.now();
  const robots = published ? post.robotsDirective || 'index,follow,max-image-preview:large' : 'noindex,nofollow';
  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.metaDescription,
    image: post.ogImageUrl || undefined,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    mainEntityOfPage: canonical,
    author: { '@type': 'Organization', name: 'SEOIntel Editorial Team', url: origin },
    publisher: { '@type': 'Organization', name: 'SEOIntel', url: origin },
    keywords: post.tags.join(', '),
    articleSection: post.topicCluster || undefined,
    wordCount: post.contentText.split(/\s+/).filter(Boolean).length,
  };
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: origin },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${origin}/blog` },
      { '@type': 'ListItem', position: 3, name: post.title, item: canonical },
    ],
  };
  const sources = post.sources.length
    ? `<section class="references" aria-labelledby="sources-title"><h2 id="sources-title">Sources and references</h2><ul>${post.sources.map((source) => `<li><a href="${escapeHtml(source.url)}" rel="noopener noreferrer">${escapeHtml(source.title)}</a><span>${escapeHtml(source.publisher)}</span></li>`).join('')}</ul></section>`
    : '';
  const related = post.relatedArticles.length
    ? `<section class="related" aria-labelledby="related-title"><h2 id="related-title">Related articles</h2><ul>${post.relatedArticles.map((article) => `<li><a href="/blog/${encodeURIComponent(article.slug)}">${escapeHtml(article.title)}</a>${article.reason ? `<p>${escapeHtml(article.reason)}</p>` : ''}</li>`).join('')}</ul></section>`
    : '';
  const readyVariants = post.imageVariants.filter((variant) => variant.status === 'ready');
  const webpSrcset = readyVariants.filter((variant) => variant.format === 'webp').sort((left, right) => left.width - right.width).map((variant) => `${variant.storageUrl} ${variant.width}w`).join(', ');
  const avifSrcset = readyVariants.filter((variant) => variant.format === 'avif').sort((left, right) => left.width - right.width).map((variant) => `${variant.storageUrl} ${variant.width}w`).join(', ');
  const dimensions = readyVariants[0];
  const heroImage = post.ogImageUrl ? `<figure><picture>${avifSrcset ? `<source type="image/avif" srcset="${escapeHtml(avifSrcset)}" sizes="(max-width: 820px) 100vw, 820px">` : ''}${webpSrcset ? `<source type="image/webp" srcset="${escapeHtml(webpSrcset)}" sizes="(max-width: 820px) 100vw, 820px">` : ''}<img class="hero-image" src="${escapeHtml(post.ogImageUrl)}" alt="${escapeHtml(post.ogImageAlt || post.title)}" sizes="(max-width: 820px) 100vw, 820px"${dimensions ? ` width="${dimensions.width}" height="${dimensions.height}"` : ''} loading="eager" decoding="async"></picture>${post.ogImageAttribution ? `<figcaption>${escapeHtml(post.ogImageAttribution)}</figcaption>` : ''}</figure>` : '';

  return `<!doctype html>
<html lang="${escapeHtml(post.language || 'en')}">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(post.seoTitle || post.title)}</title>
<meta name="description" content="${escapeHtml(post.metaDescription)}"><meta name="robots" content="${escapeHtml(robots)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:type" content="article"><meta property="og:title" content="${escapeHtml(post.ogTitle || post.seoTitle || post.title)}"><meta property="og:description" content="${escapeHtml(post.ogDescription || post.metaDescription)}"><meta property="og:url" content="${escapeHtml(canonical)}">
${post.ogImageUrl ? `<meta property="og:image" content="${escapeHtml(post.ogImageUrl)}"><meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
<script type="application/ld+json">${safeJson(articleSchema)}</script><script type="application/ld+json">${safeJson(breadcrumbSchema)}</script>
<style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f7f9fc;color:#12203d;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.72}a{color:#185bd8;text-underline-offset:3px}header{border-bottom:1px solid #dce4f0;background:#fff}.nav{max-width:1120px;margin:auto;padding:18px 24px;display:flex;justify-content:space-between;align-items:center}.brand{font-weight:700;text-decoration:none;color:#102149}.nav a:last-child{font-size:14px}main{max-width:820px;margin:auto;padding:56px 24px 80px}.meta{font-size:14px;color:#5b6b86}.tagline{font-size:20px;line-height:1.5;color:#455571}.hero-image{width:100%;height:auto;margin:28px 0;border-radius:10px}h1{font-size:clamp(2.2rem,6vw,4rem);line-height:1.08;letter-spacing:0;margin:14px 0 18px}h2{font-size:1.65rem;line-height:1.25;margin:48px 0 14px}h3{font-size:1.25rem;line-height:1.35;margin:32px 0 10px}p,li{font-size:17px}pre{overflow:auto;padding:18px;border:1px solid #dce4f0;border-radius:8px;background:#eef3fa}.references,.related{margin-top:52px;padding-top:28px;border-top:1px solid #dce4f0}.references li,.related li{margin:10px 0}.references span{display:block;font-size:13px;color:#6b7890}@media(max-width:640px){main{padding-top:36px}h1{font-size:2.35rem}.nav{padding:14px 18px}p,li{font-size:16px}}</style>
</head>
<body><header><nav class="nav" aria-label="Primary"><a class="brand" href="/">SEOIntel</a><a href="/blog">All articles</a></nav></header><main><article><p class="meta">${escapeHtml(post.topicCluster || 'SEO guidance')} · ${post.readingTimeMinutes} min read${post.publishedAt ? ` · <time datetime="${escapeHtml(post.publishedAt)}">${escapeHtml(new Date(post.publishedAt).toLocaleDateString('en', { dateStyle: 'long' }))}</time>` : ''}</p><h1>${escapeHtml(post.title)}</h1>${post.tagline ? `<p class="tagline">${escapeHtml(post.tagline)}</p>` : ''}${heroImage}<div class="article-body">${post.contentHtml}</div>${sources}${related}</article></main></body></html>`;
}
