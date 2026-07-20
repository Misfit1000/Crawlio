import { BRAND } from '../brand';
import { getBlogTopicName, getBlogTopicSlug } from './publication';
import type { BlogPost, BlogTopic } from './types';

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
    : `<a class="card-image fallback" href="/blog/${encodeURIComponent(post.slug)}" aria-label="${escapeHtml(post.title)}"><span>${escapeHtml(topic)}</span></a>`;
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
        url: `${origin}/blog/${post.slug}`,
        name: post.title,
      })),
    },
  };
  const first = posts[0];
  const remaining = posts.slice(1);
  const heading = selectedTopic ? selectedTopic.name : query ? `Search results for "${query}"` : 'Useful guidance for healthier websites';
  const intro = selectedTopic
    ? `${total} published ${total === 1 ? 'article' : 'articles'} covering ${selectedTopic.name.toLowerCase()}.`
    : query
      ? `${total} published ${total === 1 ? 'article matches' : 'articles match'} your search.`
      : 'Evidence-conscious explanations, practical checklists, and technical walkthroughs for people responsible for websites.';

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
<style>:root{color-scheme:light;--ink:#112142;--muted:#5b6981;--line:#dce4ef;--blue:#2864e8;--soft:#f4f7fb;--card:#fff}*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.6}a{color:inherit}.shell{width:min(1180px,calc(100% - 40px));margin:auto}.site-header{position:sticky;top:0;z-index:10;border-bottom:1px solid var(--line);background:rgba(255,255,255,.96)}.nav{min-height:68px;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{font-size:20px;font-weight:700;text-decoration:none}.nav-links{display:flex;align-items:center;gap:24px;font-size:14px;font-weight:600}.nav-links a{text-decoration:none}.audit-link{border-radius:8px;background:var(--blue);color:#fff;padding:10px 15px}.intro{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,.55fr);gap:48px;padding:72px 0 42px;border-bottom:1px solid var(--line)}.intro h1{max-width:760px;margin:0;font-size:clamp(2.35rem,6vw,4.5rem);line-height:1.02;letter-spacing:0}.intro p{max-width:690px;margin:22px 0 0;color:var(--muted);font-size:18px}.search{align-self:end;display:flex;gap:8px}.search input{min-width:0;flex:1;border:1px solid var(--line);border-radius:8px;padding:12px 13px;font:inherit}.search button{border:0;border-radius:8px;background:var(--ink);color:#fff;padding:0 16px;font-weight:700}.topics{display:flex;gap:10px;overflow-x:auto;padding:22px 0;scrollbar-width:thin}.topics a{white-space:nowrap;border:1px solid var(--line);border-radius:999px;padding:7px 12px;text-decoration:none;font-size:14px;font-weight:600}.topics a.active{border-color:var(--ink);background:var(--ink);color:#fff}.content{padding:26px 0 80px}.featured{display:grid;grid-template-columns:minmax(0,1.18fr) minmax(320px,.82fr);margin-bottom:28px}.article-card{overflow:hidden;border:1px solid var(--line);border-radius:10px;background:var(--card)}.card-image{display:block;aspect-ratio:16/9;overflow:hidden;background:var(--soft)}.card-image img{width:100%;height:100%;object-fit:cover}.card-image.fallback{display:flex;align-items:flex-end;padding:24px;background:#eaf0fa;text-decoration:none}.fallback span{font-size:14px;font-weight:700;color:#31517f}.card-body{padding:24px}.featured .card-body{display:flex;flex-direction:column;justify-content:center;padding:36px}.topic-link{color:var(--blue);font-size:13px;font-weight:700;text-decoration:none}.article-card h2{margin:10px 0 10px;font-size:22px;line-height:1.25}.featured h2{font-size:clamp(1.8rem,3vw,2.65rem)}.article-card h2 a{text-decoration:none}.article-card p{margin:0;color:var(--muted)}.article-meta{display:flex;flex-wrap:wrap;gap:16px;margin-top:20px;color:var(--muted);font-size:13px}.article-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px}.pagination{display:flex;justify-content:center;align-items:center;gap:14px;margin-top:36px}.pagination a{border:1px solid var(--line);border-radius:8px;padding:8px 13px;text-decoration:none;font-weight:600}.empty{border:1px solid var(--line);border-radius:10px;background:var(--soft);padding:56px 24px;text-align:center}.site-footer{border-top:1px solid var(--line);background:var(--soft)}.footer{display:flex;justify-content:space-between;gap:20px;padding:28px 0;color:var(--muted);font-size:14px}.footer a{color:var(--ink)}@media(max-width:900px){.intro{grid-template-columns:1fr;padding-top:48px}.search{max-width:620px}.featured{grid-template-columns:1fr}.article-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:620px){.shell{width:min(100% - 28px,1180px)}.nav{min-height:62px}.nav-links a:not(.audit-link){display:none}.intro{gap:28px;padding:40px 0 28px}.intro h1{font-size:2.5rem}.intro p{font-size:16px}.search{flex-direction:column}.search button{min-height:44px}.topics{padding:16px 0}.content{padding-top:16px}.article-grid{grid-template-columns:1fr}.featured .card-body,.card-body{padding:20px}.featured h2{font-size:1.85rem}.footer{flex-direction:column}}</style>
</head>
<body>
<header class="site-header"><nav class="shell nav" aria-label="Primary"><a class="brand" href="/">${escapeHtml(BRAND.name)}</a><div class="nav-links"><a href="/blog">Articles</a><a href="/rss.xml">RSS</a><a class="audit-link" href="/#start-audit">Start free audit</a></div></nav></header>
<main>
  <section class="shell intro"><div><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(intro)}</p></div><form class="search" action="/blog" method="get"><label for="blog-search" style="position:absolute;left:-9999px">Search articles</label><input id="blog-search" name="q" value="${escapeHtml(query)}" placeholder="Search SEO and audit guides"><button type="submit">Search</button></form></section>
  <nav class="shell topics" aria-label="Article topics"><a href="/blog"${selectedTopic ? '' : ' class="active"'}>All articles</a>${topics.map((topic) => `<a href="/blog/topic/${encodeURIComponent(topic.slug)}"${selectedTopic?.slug === topic.slug ? ' class="active"' : ''}>${escapeHtml(topic.name)} <span aria-label="${topic.articleCount} articles">(${topic.articleCount})</span></a>`).join('')}</nav>
  <section class="shell content" aria-label="Published articles">${first ? `${articleCard(first, true)}${remaining.length ? `<div class="article-grid">${remaining.map((post) => articleCard(post)).join('')}</div>` : ''}` : `<div class="empty"><h2>No articles found</h2><p>${query ? 'Try a broader search phrase.' : 'Published guidance will appear here.'}</p></div>`}${totalPages > 1 ? `<nav class="pagination" aria-label="Blog pagination">${page > 1 ? `<a href="${escapeHtml(pageQuery(page - 1))}">Previous</a>` : ''}<span>Page ${page} of ${totalPages}</span>${page < totalPages ? `<a href="${escapeHtml(pageQuery(page + 1))}">Next</a>` : ''}</nav>` : ''}</section>
</main>
<footer class="site-footer"><div class="shell footer"><span>${escapeHtml(BRAND.name)} practical website guidance</span><span><a href="/">Product</a> &middot; <a href="/sitemap.xml">Sitemap</a> &middot; <a href="/rss.xml">RSS</a></span></div></footer>
</body></html>`;
}
