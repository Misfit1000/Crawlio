import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { load } from 'cheerio';

const html = await readFile('dist/index.html', 'utf8');
const $ = load(html);
const configured = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : $('link[rel="canonical"]').attr('href'));
const url = new URL('/tools', configured);
if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Tools canonical requires a configured public HTTP origin.');
const title = 'Free SEO tools | Crawlio';
const description = 'Preview search and social metadata, test robots rules, build structured data, and prepare observed header fixes with local browser tools.';
$('title').text(title);
$('meta[name="description"],meta[property="og:description"]').attr('content', description);
$('meta[property="og:title"],meta[name="twitter:title"]').attr('content', title);
$('link[rel="canonical"]').attr('href', url.href);
$('head').append($('<meta>').attr({ property: 'og:url', content: url.href }));
$('script[type="application/ld+json"]').remove();
$('head').append($('<script>').attr('type', 'application/ld+json').text(JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', name: title, description, url: url.href }).replaceAll('<', '\\u003c')));
// React replaces this crawlable starting content when the local tools are ready.
$('#root').html('<main style="max-width:960px;margin:48px auto;padding:24px;font-family:system-ui;line-height:1.6"><a href="/">Crawlio</a><h1>Free SEO tools</h1><p>Local, evidence-first tools. Editing does not save content, fetch websites, or change audit scores.</p><h2>Search and social metadata preview</h2><p>Inspect titles, descriptions and Open Graph fields in illustrative mobile and desktop layouts.</p><h2>Robots sandbox</h2><p>Test a path against supplied robots rules for search crawlers and usage controls. Permission does not guarantee indexing or citations.</p><h2>Structured-data builder</h2><p>Build Article, Organization and FAQ markup from real facts. Structural validation does not establish rich-result eligibility.</p><h2>Observed header remediation</h2><p>Prepare staged configuration fragments only for headers observed absent. Existing policies are not overwritten.</p><p>Enable JavaScript to use the interactive tools. <a href="/#start-audit">Start an audit</a> for page-specific evidence, or <a href="/blog">read practical SEO guidance</a>.</p></main>');
await mkdir('dist/tools', { recursive: true });
await writeFile('dist/tools/index.html', $.html());
console.log('Built crawlable /tools shell with no additional script dependencies.');
