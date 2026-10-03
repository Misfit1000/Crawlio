import * as cheerio from 'cheerio';

export interface SitemapDocument {
  urls: string[];
  sitemaps: string[];
  errors: string[];
}

export function parseSitemapXml(xml: string): SitemapDocument {
  const errors: string[] = [];
  try {
    const $ = cheerio.load(xml, { xmlMode: true });
    const rootName = String($.root().children().first().get(0)?.tagName || '').toLowerCase();
    if (!rootName.endsWith('urlset') && !rootName.endsWith('sitemapindex')) {
      return { urls: [], sitemaps: [], errors: ['Unsupported sitemap root element'] };
    }

    const locations = $('loc')
      .map((_index, element) => $(element).text().trim())
      .get()
      .filter((location) => {
        try {
          const parsed = new URL(location);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          return false;
        }
      });
    const uniqueLocations = [...new Set(locations)];
    return rootName.endsWith('sitemapindex')
      ? { urls: [], sitemaps: uniqueLocations, errors }
      : { urls: uniqueLocations, sitemaps: [], errors };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Invalid sitemap XML');
    return { urls: [], sitemaps: [], errors };
  }
}
