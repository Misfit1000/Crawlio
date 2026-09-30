import type { CheerioAPI } from 'cheerio';

export function collectInsecureResourceUrls($: CheerioAPI, pageUrl: string, baseUrl = pageUrl): string[] {
  try {
    if (new URL(pageUrl).protocol !== 'https:') return [];
  } catch {
    return [];
  }

  const urls = new Set<string>();
  const add = (value: string | undefined) => {
    if (!value?.trim()) return;
    try {
      const resolved = new URL(value, baseUrl);
      if (resolved.protocol === 'http:') urls.add(resolved.toString());
    } catch {}
  };

  // Resource-bearing attributes only; navigation and canonical hrefs are not mixed content.
  $('script[src],img[src],iframe[src],frame[src],audio[src],video[src],source[src],track[src],embed[src],input[type="image"][src]')
    .each((_, element) => add($(element).attr('src')));
  $('video[poster]').each((_, element) => add($(element).attr('poster')));
  $('object[data]').each((_, element) => add($(element).attr('data')));
  $('link[href]').each((_, element) => {
    const rel = ($(element).attr('rel') || '').toLowerCase().split(/\s+/);
    if (rel.some((token) => ['stylesheet', 'icon', 'preload', 'modulepreload'].includes(token))) {
      add($(element).attr('href'));
    }
  });

  return [...urls];
}

export function collectInsecureFormActionUrls($: CheerioAPI, pageUrl: string, baseUrl = pageUrl): string[] {
  const urls = new Set<string>();
  $('form').each((_, element) => {
    const form = $(element);
    if (form.attr('method')?.trim().toLowerCase() === 'dialog') return;
    const action = form.attr('action')?.trim() || '';
    try {
      // Empty or absent actions submit to the document URL, not the base element.
      const resolved = action ? new URL(action, baseUrl) : new URL(pageUrl);
      if (resolved.protocol === 'http:') urls.add(resolved.toString());
    } catch {}
  });
  return [...urls];
}
