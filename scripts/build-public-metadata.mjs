import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { load } from 'cheerio';
import { AUDIT_PRESETS, PUBLIC_NAVIGATION, PUBLIC_PAGES, PUBLIC_TOOLS } from '../src/components/public/public-pages.mjs';

const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

function canonicalOrigin(html, environment) {
  const $ = load(html);
  const configured = environment.APP_URL || (environment.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${environment.VERCEL_PROJECT_PRODUCTION_URL}` : $('link[rel="canonical"]').attr('href'));
  const origin = new URL(configured);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) throw new Error('Public canonical requires a configured HTTP origin without credentials.');
  return origin.origin;
}

function directory(items, prefix) {
  return `<div class="public-directory-grid">${items.map(item => `<a class="public-directory-item" href="${prefix}/${escape(item.slug)}"><h2>${escape(item.title)}</h2><p>${escape(item.description)}</p></a>`).join('')}</div>`;
}

function pageContent(page) {
  const preset = AUDIT_PRESETS.find(item => item.slug === page.slug);
  const tool = PUBLIC_TOOLS.find(item => item.slug === page.slug);
  if (page.kind === 'home') return '<p>Find the problem. See the evidence. Know what to fix.</p><h2>Choose what to check</h2>' + directory(AUDIT_PRESETS, '/audits') + '<p><a href="/reports/example">Explore a sample report</a> or <a href="/tools">open local SEO tools</a>.</p>';
  if (page.kind === 'audits') return directory(AUDIT_PRESETS, '/audits');
  if (page.kind === 'audit') return `<p>${preset.focus === 'full' ? 'All eight check groups. Website coverage by default.' : 'Focused checks. Single-page coverage by default.'} Quick depth by default; available depths and website coverage follow your current allowance.</p><h2>What gets checked</h2><ul class="mt-4 space-y-3 text-sm">${preset.checks.map(check => `<li>${escape(check)}</li>`).join('')}</ul><p class="mt-5 text-sm leading-6 text-muted-foreground">${escape(preset.limitation)}</p><p class="mt-6"><a href="/reports/example">Example report</a> / <a href="/pricing">Plans and limits</a></p>`;
  if (page.kind === 'tools') return directory(PUBLIC_TOOLS, '/tools') + '<p>Content stays in your browser. These tools do not fetch a website or alter an audit score.</p>';
  if (page.kind === 'tool') return `<h2>Local browser tool</h2><p>${escape(tool.limitation)}</p><p>Pasted content stays in this browser tab. No crawler request or audit score change.</p><p><a href="/tools">All tools</a> / <a href="/audits">Audit a public website</a></p>`;
  if (page.kind === 'pricing') return '<p>Plan access is managed by an administrator. Self-service billing is not yet available.</p><div class="public-directory-grid"><section class="public-directory-item"><h2>Free</h2><p>Quick audits for important pages and small websites.</p></section><section class="public-directory-item"><h2>Plus</h2><p>Broader page coverage and plan-enabled report exports.</p></section><section class="public-directory-item"><h2>Pro</h2><p>Deep discovery and larger audit allowances for teams.</p></section></div><p>Current published limits load in the interactive page and are verified again when an audit starts. Single-page audits check one page, without increasing your allowance.</p><p><a href="/audits">Choose an audit</a></p>';
  if (page.kind === 'example') return '<p>Sample data, not a live customer report.</p><article class="public-directory-item"><h2>Broken internal link</h2><p>Visitors and crawlers reach a dead end.</p><h3 class="mt-5">Sample evidence</h3><p><code>/services/old-offer returned HTTP 404</code></p><h3 class="mt-5">Recommended fix</h3><p>Restore the page, link to its replacement, or remove the obsolete link.</p></article><h2>More sample findings</h2><ul><li>Unintended noindex</li><li>Duplicate page titles</li><li>Avoidable redirect</li></ul><p><a href="/audits">Audit your website</a></p>';
  return '<p>Read the full notice in the interactive page.</p><p><a href="/privacy">Privacy</a> / <a href="/terms">Terms</a> / <a href="/acceptable-use">Acceptable use</a> / <a href="/cookies">Storage notice</a> / <a href="/contact">Contact</a></p>';
}

export function buildPublicPageHtml(html, page, origin, publicStyles = []) {
  const $ = load(html);
  const title = `${page.title} | Crawlio`;
  const url = `${origin}${page.path}`;
  $('title').text(title);
  const meta = (attribute, name, content) => {
    let element = $(`meta[${attribute}="${name}"]`);
    if (!element.length) { element = $('<meta>').attr(attribute, name); $('head').append(element); }
    element.attr('content', content);
  };
  meta('name', 'description', page.description);
  meta('name', 'robots', page.noindex ? 'noindex, nofollow' : 'index, follow');
  meta('property', 'og:title', title);
  meta('property', 'og:description', page.description);
  meta('property', 'og:url', url);
  meta('name', 'twitter:title', title);
  meta('name', 'twitter:description', page.description);
  if (!$('link[rel="canonical"]').length) $('head').append($('<link>').attr('rel', 'canonical'));
  if (page.kind === 'not-found') $('link[rel="canonical"]').remove();
  else $('link[rel="canonical"]').attr('href', url);
  $('script[type="application/ld+json"]').remove();
  if (!page.noindex) $('head').append($('<script>').attr('type', 'application/ld+json').text(JSON.stringify({ '@context': 'https://schema.org', '@type': page.kind === 'home' ? 'WebSite' : 'WebPage', name: page.title, description: page.description, url }).replaceAll('<', '\\u003c')));
  if (['audits','audit','tools','tool','pricing','example','legal'].includes(page.kind)) {
    for (const href of publicStyles) $('head').append($('<link>').attr({rel:'stylesheet',href}));
  }
  if (!$('#root').length) $('body').append('<div id="root"></div>');
  const nav = PUBLIC_NAVIGATION.map(link => `<a class="rounded-lg px-3 py-2 text-sm" href="${link.path}">${link.label}</a>`).join('');
  const content = page.kind === 'not-found' ? '<p><a href="/">Return home</a> or <a href="/audits">browse audits</a>.</p>' : page.kind === 'private' ? '<p><a href="/login">Sign in</a> to access your workspace.</p>' : pageContent(page);
  $('#root').html(`<div class="flex min-h-screen flex-col"><header class="border-b border-border bg-card"><div class="section-shell flex flex-wrap items-center justify-between gap-3 py-4"><a class="text-xl font-semibold" href="/">Crawlio</a><nav aria-label="Public navigation" class="flex flex-wrap gap-1">${nav}</nav></div></header><main id="main-content" class="section-shell public-task-page"><header class="public-page-heading"><h1>${escape(page.title)}</h1><p>${escape(page.description)}</p></header>${content}</main><footer class="mt-auto border-t border-border"><div class="section-shell flex flex-wrap gap-4 py-6 text-sm"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/contact">Contact</a></div></footer></div>`);
  return $.html();
}

export function buildPublicMetadata(html, robots, environment = process.env) {
  const origin = canonicalOrigin(html, environment);
  const rules = robots.split(/\r?\n/).filter(line => !/^Sitemap:/i.test(line));
  while (rules.at(-1) === '') rules.pop();
  return { html: buildPublicPageHtml(html, PUBLIC_PAGES[0], origin), robots: `${rules.join('\n')}\n\nSitemap: ${origin}/sitemap.xml\n` };
}

export function buildPublicArtifacts(html, robots, environment = process.env, publicStyles = []) {
  const origin = canonicalOrigin(html, environment);
  return {
    ...buildPublicMetadata(html, robots, environment),
    pages: Object.fromEntries(PUBLIC_PAGES.map(page => [page.path, buildPublicPageHtml(html, page, origin, publicStyles)])),
    privateHtml: buildPublicPageHtml(html, { path: '/app', title: 'Crawlio workspace', description: 'Manage private audits, findings and reports.', kind: 'private', noindex: true }, origin),
    notFoundHtml: buildPublicPageHtml(html, { path: '/404', title: 'Page not found', description: 'This page does not exist. Browse Crawlio audits and tools.', kind: 'not-found', noindex: true }, origin),
  };
}

async function writeArtifacts() {
  const styles=(await readdir('dist/assets')).filter(name=>/^public-pages-.*\.css$/.test(name)).map(name=>`/assets/${name}`);
  const result = buildPublicArtifacts(await readFile('dist/index.html', 'utf8'), await readFile('dist/robots.txt', 'utf8'), process.env,styles);
  for (const [route, html] of Object.entries(result.pages)) {
    const target = route === '/' ? 'dist/index.html' : `dist${route}/index.html`;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, html);
  }
  await writeFile('dist/app-shell.html', result.privateHtml);
  await writeFile('dist/404.html', result.notFoundHtml);
  await writeFile('dist/robots.txt', result.robots);
  console.log(`Built ${PUBLIC_PAGES.length} crawlable public pages, private shell and 404 with canonical metadata.`);
}
if (process.argv[1]?.replaceAll('\\','/').endsWith('/build-public-metadata.mjs')) void writeArtifacts().catch(error=>{console.error(error);process.exitCode=1;});
