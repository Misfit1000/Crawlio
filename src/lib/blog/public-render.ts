import { BRAND } from '../brand';
import { getBlogTopicName, getBlogTopicSlug } from './publication';
import type { BlogPost, BlogTopic } from './types';
import { BLOG_LISTING_CSS, BLOG_PUBLIC_HEADER, BLOG_PUBLIC_THEME_CSS } from './public-style';
import { blogArticleUrl } from './seo';

function escapeHtml(value: unknown) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));
}

function safeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function dateLabel(value: string | null) {
  if (!value) return 'Recently published';
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value));
}

function articleCard(post: BlogPost, featured = false) {
  const topic = getBlogTopicName(post);
  const image = post.ogImageUrl
    ? `<a class="card-image" href="/blog/${encodeURIComponent(post.slug)}" aria-label="${escapeHtml(post.title)}"><img src="${escapeHtml(post.ogImageUrl)}" alt="${escapeHtml(post.ogImageAlt || post.title)}" width="1200" height="675" loading="${featured ? 'eager' : 'lazy'}" decoding="async"></a>`
    : '';
  return `<article class="article-card${featured ? ' featured' : ''}">
    ${image}
    <div class="card-body">
      <a class="topic-link" href="/blog/topic/${encodeURIComponent(getBlogTopicSlug(topic))}">${escapeHtml(topic)}</a>
      <h2><a href="/blog/${encodeURIComponent(post.slug)}">${escapeHtml(post.title)}</a></h2>
      <p>${escapeHtml(post.excerpt)}</p>
      <div class="article-meta"><time datetime="${escapeHtml(post.publishedAt || '')}">${escapeHtml(dateLabel(post.publishedAt))}</time><span>${post.readingTimeMinutes} min read</span></div>
    </div>
  </article>`;
}

export function renderBlogListingHtml(input: {
  origin: string;
  posts: BlogPost[];
  topics: BlogTopic[];
  total: number;
  page: number;
  pageSize: number;
  query?: string;
  selectedTopic?: BlogTopic | null;
}) {
  const { origin, posts, topics, total, page, pageSize } = input;
  const query = String(input.query || '').trim();
  const selectedTopic = input.selectedTopic || null;
  const basePath = selectedTopic ? `/blog/topic/${encodeURIComponent(selectedTopic.slug)}` : '/blog';
  const canonical = `${origin}${basePath}${page > 1 ? `?page=${page}` : ''}`;
  const title = selectedTopic
    ? `${selectedTopic.name} Articles and Guides | ${BRAND.name}`
    : query
      ? `Search the ${BRAND.name} Blog`
      : `${BRAND.name} Blog | Practical SEO and Website Audit Guides`;
  const description = selectedTopic
    ? `Practical ${selectedTopic.name} guides with clear examples, source-aware explanations, and steps you can apply to real websites.`
    : 'Practical, source-aware guides for SEO audits, crawlability, technical website health, reporting, and passive browser security.';
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const shouldNoindex = Boolean(query) || page > totalPages;
  const pageQuery = (targetPage: number) => {
    const params = new URLSearchParams();
    if (targetPage > 1) params.set('page', String(targetPage));
    if (query) params.set('q', query);
    const suffix = params.toString();
    return `${basePath}${suffix ? `?${suffix}` : ''}`;
  };
  const collectionSchema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description,
    url: canonical,
    isPartOf: { '@type': 'WebSite', name: BRAND.name, url: origin },
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: posts.map((post, index) => ({
        '@type': 'ListItem',
        position: ((page - 1) * pageSize) + index + 1,
        url: blogArticleUrl(origin, post.slug),
        name: post.title,
      })),
    },
  };
  const first = posts[0];
  const remaining = posts.slice(1);
  const heading = selectedTopic ? selectedTopic.name : query ? `Search results for "${query}"` : 'The Crawlio Journal';
  const intro = selectedTopic
    ? `${total} published ${total === 1 ? 'article' : 'articles'} covering ${selectedTopic.name.toLowerCase()}.`
    : query
      ? `${total} published ${total === 1 ? 'article matches' : 'articles match'} your search.`
      : 'Practical guides for a better website.';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="${shouldNoindex ? 'noindex,follow' : 'index,follow,max-image-preview:large'}">
<link rel="canonical" href="${escapeHtml(canonical)}"><link rel="alternate" type="application/rss+xml" title="${escapeHtml(BRAND.name)} Blog RSS" href="${escapeHtml(`${origin}/rss.xml`)}">
${page > 1 ? `<link rel="prev" href="${escapeHtml(`${origin}${pageQuery(page - 1)}`)}">` : ''}${page < totalPages ? `<link rel="next" href="${escapeHtml(`${origin}${pageQuery(page + 1)}`)}">` : ''}
<meta property="og:type" content="website"><meta property="og:site_name" content="${escapeHtml(BRAND.name)}"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(canonical)}">
${first?.ogImageUrl ? `<meta property="og:image" content="${escapeHtml(first.ogImageUrl)}"><meta property="og:image:alt" content="${escapeHtml(first.ogImageAlt || first.title)}"><meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
<script type="application/ld+json">${safeJson(collectionSchema)}</script>
<script src="/blog-theme.js"></script>
<style>${BLOG_PUBLIC_THEME_CSS}${BLOG_LISTING_CSS}</style>
</head>
<body>
${BLOG_PUBLIC_HEADER}
<main>
  <section class="shell intro"><div><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(intro)}</p></div><form class="search" action="${basePath}" method="get"><label for="blog-search" style="position:absolute;left:-9999px">Search articles</label><input id="blog-search" name="q" value="${escapeHtml(query)}" placeholder="Search SEO and audit guides"><button type="submit">Search</button></form></section>
  <nav class="shell topics" aria-label="Article topics"><a href="/blog"${selectedTopic ? '' : ' class="active"'}>All articles</a>${topics.map((topic) => `<a href="/blog/topic/${encodeURIComponent(topic.slug)}"${selectedTopic?.slug === topic.slug ? ' class="active"' : ''}>${escapeHtml(topic.name)} <span aria-label="${topic.articleCount} articles">(${topic.articleCount})</span></a>`).join('')}</nav>
  <section class="shell content" aria-label="Published articles">${first ? `${articleCard(first, true)}${remaining.length ? `<div class="article-grid">${remaining.map((post) => articleCard(post)).join('')}</div>` : ''}` : `<div class="empty"><h2>No articles found</h2><p>${query ? 'Try a broader search phrase.' : 'Published guidance will appear here.'}</p></div>`}${totalPages > 1 ? `<nav class="pagination" aria-label="Blog pagination">${page > 1 ? `<a href="${escapeHtml(pageQuery(page - 1))}">Previous</a>` : ''}<span>Page ${page} of ${totalPages}</span>${page < totalPages ? `<a href="${escapeHtml(pageQuery(page + 1))}">Next</a>` : ''}</nav>` : ''}</section>
</main>
<footer class="site-footer"><div class="shell footer"><span>${escapeHtml(BRAND.name)} practical website guidance</span><span><a href="/">Product</a> &middot; <a href="/sitemap.xml">Sitemap</a> &middot; <a href="/rss.xml">RSS</a></span></div></footer>
</body></html>`;
}
