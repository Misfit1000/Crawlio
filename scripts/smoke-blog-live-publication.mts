import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

if (process.env.ALLOW_LIVE_BLOG_PUBLICATION_TEST !== 'true' || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.APP_URL) {
  console.log('Skipped: credentials, APP_URL, or ALLOW_LIVE_BLOG_PUBLICATION_TEST=true not configured.');
  process.exit(0);
}
const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const marker = randomUUID();
const slug = `verification-noindex-${marker}`;
let postId = '';
try {
  const content = '<p>This controlled verification article checks the publication path.</p><h2>Internal link</h2><p>Return to the <a href="/blog">SEOIntel blog</a>.</p><h2>External reference</h2><p>Read the <a href="https://www.w3.org/TR/html52/document-metadata.html#the-title-element">W3C title guidance</a>.</p><h2>Cleanup</h2><p>The article is archived immediately after verification.</p>';
  const { data, error } = await client.from('blog_posts').insert({ slug, title: `[TEST] Publication verification ${marker}`, excerpt: 'A controlled noindex article used to verify public rendering and cleanup without affecting normal editorial content.', tagline: 'Controlled publication-path verification.', summary: 'Temporary publication verification.', content_html: content, content_text: content.replace(/<[^>]+>/g, ' '), seo_title: 'Controlled SEOIntel publication verification', meta_description: 'Controlled noindex verification of SEOIntel article HTML, structured data, links, feeds and cleanup behavior.', status: 'published', origin: 'admin_manual', article_type: 'checklist', robots_directive: 'noindex,nofollow', published_at: new Date().toISOString(), quality_status: 'passed', originality_status: 'passed', source_status: 'passed', prerender_status: 'passed', image_status: 'not_required', sources: [{ url: 'https://www.w3.org/TR/html52/document-metadata.html#the-title-element', title: 'The title element', publisher: 'W3C', citationStatus: 'verified' }] }).select('id').single();
  if (error) throw error;
  postId = data.id;
  const publicResponse = await fetch(`${process.env.APP_URL.replace(/\/$/, '')}/blog/${slug}`);
  const html = await publicResponse.text();
  for (const required of ['rel="canonical"', 'noindex', 'BlogPosting', 'BreadcrumbList', '<h1>']) if (!html.includes(required)) throw new Error(`Public HTML is missing ${required}.`);
  const [sitemap, rss, news] = await Promise.all([fetch(`${process.env.APP_URL}/sitemap.xml`).then((item) => item.text()), fetch(`${process.env.APP_URL}/rss.xml`).then((item) => item.text()), fetch(`${process.env.APP_URL}/news-sitemap.xml`).then((item) => item.text())]);
  if (sitemap.includes(slug) || rss.includes(slug) || news.includes(slug)) throw new Error('The noindex test article entered a public discovery feed.');
  console.log('success=true noindex=true initialHtml=true structuredData=true sitemapExcluded=true rssExcluded=true newsExcluded=true');
} finally {
  if (postId) await client.from('blog_posts').update({ status: 'archived', robots_directive: 'noindex,nofollow', published_at: null }).eq('id', postId);
}
