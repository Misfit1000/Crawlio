import { sanitizeBlogHtml } from './sanitize';
import { deriveAutomaticBlogFields } from './editor-experience';
import type { BlogPostInput, BlogSource } from './types';

function escaped(value: unknown) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] || character);
}

export function completeManualArticleLinks(contentHtml: string, sources: BlogSource[]) {
  let html = sanitizeBlogHtml(contentHtml);
  const hrefs = () => [...html.matchAll(/href=["']([^"']+)/gi)].map((match) => match[1]);
  const missingSources = sources.filter((source) => source.url && !hrefs().includes(source.url));
  const internal = hrefs().filter((href) => /^\/(?!\/)/.test(href));
  const additions: string[] = [];
  if (missingSources.length) {
    additions.push(`<p>Review the original evidence from ${missingSources.map((source) => `<a href="${escaped(source.url)}">${escaped(source.title || source.publisher || 'the original source')}</a>`).join(' and ')}.</p>`);
  }
  if (!internal.includes('/blog')) additions.push('<p>Continue learning in the <a href="/blog">Crawlio SEO article library</a>.</p>');
  if (internal.length + Number(!internal.includes('/blog')) < 2 && !internal.includes('/#start-audit')) additions.push('<p>Check a public website with the <a href="/#start-audit">Crawlio website audit</a>.</p>');
  if (additions.length) html = `${html}<h2>Sources and next steps</h2>${additions.join('')}`;
  return sanitizeBlogHtml(html);
}

export function applySafeBlogFixes(input: BlogPostInput, overrides: string[] = []) {
  const automatic = deriveAutomaticBlogFields(input);
  const patch = Object.fromEntries(Object.entries(automatic).filter(([key]) => !overrides.includes(key)));
  return {
    ...input,
    ...patch,
    contentHtml: completeManualArticleLinks(String(input.contentHtml || ''), input.sources || []),
  } as BlogPostInput;
}
