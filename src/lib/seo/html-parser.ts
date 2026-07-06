import * as cheerio from 'cheerio';
import { removeStopwords } from '../keywords/stopwords';

export interface ParsedPageData {
  title: string;
  metaDescription: string;
  h1: string[];
  h2: string[];
  h3: string[];
  wordCount: number;
  internalLinks: string[];
  externalLinks: string[];
  imagesWithoutAlt: number;
  canonical: string;
  topKeywords: string[];
}

function getTopKeywords(text: string): string[] {
  const clean = removeStopwords(text.toLowerCase().replace(/[^\w\s]/g, ' '));
  const words = clean.split(/\s+/).filter(w => w.length > 2);
  
  const freq: Record<string, number> = {};
  for (const w of words) {
    freq[w] = (freq[w] || 0) + 1;
  }
  
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(entry => entry[0]);
}

export function parseHtml(html: string, baseUrl: string): ParsedPageData {
  const $ = cheerio.load(html);
  
  const title = $('title').text().trim();
  const metaDescription = $('meta[name="description"]').attr('content') || '';
  
  const h1 = $('h1').map((_, el) => $(el).text().trim()).get();
  const h2 = $('h2').map((_, el) => $(el).text().trim()).get();
  const h3 = $('h3').map((_, el) => $(el).text().trim()).get();
  
  const bodyText = $('body').text();
  const wordCount = bodyText.split(/\s+/).filter(w => w.length > 0).length;
  
  const internalLinks: string[] = [];
  const externalLinks: string[] = [];
  
  let baseHostname = '';
  try {
    baseHostname = new URL(baseUrl).hostname;
  } catch (e) {}

  $('a').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('javascript:') || href.startsWith('mailto:')) return;
    
    if (href.startsWith('http')) {
      try {
        const urlObj = new URL(href);
        if (urlObj.hostname === baseHostname) {
          internalLinks.push(href);
        } else {
          externalLinks.push(href);
        }
      } catch (e) {}
    } else {
      internalLinks.push(href); // relative is usually internal
    }
  });

  let imagesWithoutAlt = 0;
  $('img').each((_, el) => {
    const alt = $(el).attr('alt');
    if (!alt || alt.trim() === '') {
      imagesWithoutAlt++;
    }
  });

  const canonical = $('link[rel="canonical"]').attr('href') || '';
  
  const allText = `${title} ${metaDescription} ${h1.join(' ')} ${h2.join(' ')} ${$('p').text()}`;
  const topKeywords = getTopKeywords(allText);

  return {
    title,
    metaDescription,
    h1,
    h2,
    h3,
    wordCount,
    internalLinks,
    externalLinks,
    imagesWithoutAlt,
    canonical,
    topKeywords
  };
}
