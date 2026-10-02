import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';

export function buildPublicMetadata(html, robots, environment = process.env) {
  const $ = load(html);
  const configured = environment.APP_URL || (environment.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${environment.VERCEL_PROJECT_PRODUCTION_URL}` : $('link[rel="canonical"]').attr('href'));
  const origin = new URL(configured);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) {
    throw new Error('Public canonical requires a configured HTTP origin without credentials.');
  }
  const homeUrl = `${origin.origin}/`;
  $('link[rel="canonical"]').attr('href', homeUrl);
  if (!$('meta[property="og:url"]').length) $('head').append($('<meta>').attr('property', 'og:url'));
  $('meta[property="og:url"]').attr('content', homeUrl);
  $('script[type="application/ld+json"]').each((_index, element) => {
    const schema = JSON.parse($(element).text());
    schema.url = homeUrl;
    $(element).text(JSON.stringify(schema).replaceAll('<', '\\u003c'));
  });
  const rules = robots.split(/\r?\n/).filter(line => !/^Sitemap:/i.test(line));
  while (rules.at(-1) === '') rules.pop();
  return { html: $.html(), robots: `${rules.join('\n')}\n\nSitemap: ${origin.origin}/sitemap.xml\n` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = buildPublicMetadata(await readFile('dist/index.html', 'utf8'), await readFile('dist/robots.txt', 'utf8'));
  await writeFile('dist/index.html', result.html);
  await writeFile('dist/robots.txt', result.robots);
  console.log('Aligned homepage, structured data, social URL and robots with the configured canonical origin.');
}
