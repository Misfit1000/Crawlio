import * as cheerio from 'cheerio';
import { removeStopwords } from '../keywords/stopwords';

export interface ParsedPageData {
  title: string;
  metaDescription: string;
  h1: string[];
  h2: string[];
  h3: string[];
  wordCount: number;
  internalLinks: { href: string; text: string }[];
  externalLinks: { href: string; text: string; rel: string }[];
  imageCount: number;
  imagesWithoutAlt: number;
  canonical: string;
  metaRobots: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  siteName: string;
  faviconUrl: string;
  themeColor: string;
  twitterCard: string;
  jsonLd: string[];
  viewport: string;
  lang: string;
  topKeywords: string[];
  topPhrases: string[];
  accessibility: {
    unnamedLinks: number;
    unnamedButtons: number;
    unlabeledFields: number;
    mainLandmarks: number;
    duplicateIds: number;
    brokenAriaReferences: number;
    positiveTabindex: number;
    hiddenFocusableElements: number;
    zoomRestricted: boolean;
  };
  likelyJavascriptShell: boolean;
}

function getNGrams(words: string[], n: number): string[] {
  const ngrams = [];
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.push(words.slice(i, i + n).join(' '));
  }
  return ngrams;
}

function getTopPhrases(text: string): { topKeywords: string[], topPhrases: string[] } {
  const clean = removeStopwords(text.toLowerCase().replace(/[^\w\s]/g, ' '));
  const words = clean.split(/\s+/).filter(w => w.length > 2);
  
  const freq1: Record<string, number> = {};
  for (const w of words) freq1[w] = (freq1[w] || 0) + 1;
  
  const freq2: Record<string, number> = {};
  const bigrams = getNGrams(words, 2);
  for (const w of bigrams) freq2[w] = (freq2[w] || 0) + 1;

  const freq3: Record<string, number> = {};
  const trigrams = getNGrams(words, 3);
  for (const w of trigrams) freq3[w] = (freq3[w] || 0) + 1;

  const topKeywords = Object.entries(freq1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(entry => entry[0]);

  const topPhrases = [...Object.entries(freq2), ...Object.entries(freq3)]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(entry => entry[0]);

  return { topKeywords, topPhrases };
}

export function parseHtml(html: string, baseUrl: string): ParsedPageData {
  const $ = cheerio.load(html);
  
  const lang = $('html').attr('lang') || '';
  const title = $('title').text().trim();
  const metaDescription = $('meta[name="description"]').attr('content') || '';
  const metaRobots = $('meta[name="robots"]').attr('content') || '';
  const viewport = $('meta[name="viewport"]').attr('content') || '';
  
  const ogTitle = $('meta[property="og:title"]').attr('content') || '';
  const ogDescription = $('meta[property="og:description"]').attr('content') || '';
  const resolvePublicAssetUrl = (value: string) => {
    if (!value) return '';
    try {
      const resolved = new URL(value, baseUrl);
      return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.toString() : '';
    } catch {
      return '';
    }
  };
  const ogImage = resolvePublicAssetUrl($('meta[property="og:image"]').attr('content') || '');
  const siteName = $('meta[property="og:site_name"]').attr('content')?.trim() || '';
  const faviconUrl = resolvePublicAssetUrl(
    $('link[rel~="icon"]').first().attr('href') || $('link[rel="apple-touch-icon"]').first().attr('href') || '',
  );
  const themeColor = $('meta[name="theme-color"]').attr('content')?.trim() || '';
  const twitterCard = $('meta[name="twitter:card"]').attr('content') || '';

  const jsonLd: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    jsonLd.push($(el).html() || '');
  });

  const h1 = $('h1').map((_, el) => $(el).text().trim()).get();
  const h2 = $('h2').map((_, el) => $(el).text().trim()).get();
  const h3 = $('h3').map((_, el) => $(el).text().trim()).get();
  
  const bodyText = $('body').text();
  const wordCount = bodyText.split(/\s+/).filter(w => w.length > 0).length;
  
  const internalLinks: { href: string; text: string }[] = [];
  const externalLinks: { href: string; text: string; rel: string }[] = [];
  
  let baseHostname = '';
  try {
    baseHostname = new URL(baseUrl).hostname;
  } catch (e) {}
  
  $('a').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    const rel = $(el).attr('rel') || '';
    if (!href || href.startsWith('javascript:') || href.startsWith('mailto:')) return;
    
    if (href.startsWith('http')) {
      try {
        const urlObj = new URL(href);
        if (urlObj.hostname === baseHostname || urlObj.hostname.endsWith('.' + baseHostname)) {
          internalLinks.push({ href, text });
        } else {
          externalLinks.push({ href, text, rel });
        }
      } catch (e) {}
    } else {
      internalLinks.push({ href, text }); // relative is usually internal
    }
  });

  const imageCount = $('img').length;
  let imagesWithoutAlt = 0;
  $('img').each((_, el) => {
    const alt = $(el).attr('alt');
    if (!alt || alt.trim() === '') {
      imagesWithoutAlt++;
    }
  });

  const canonical = resolvePublicAssetUrl($('link[rel="canonical"]').attr('href') || '');

  const ids = new Map<string, number>();
  const idText = new Map<string, string>();
  $('[id]').each((_, element) => {
    const id = $(element).attr('id')?.trim();
    if (id) {
      ids.set(id, (ids.get(id) || 0) + 1);
      if (!idText.has(id)) idText.set(id, $(element).text().trim());
    }
  });
  const labelFors = new Set($('label[for]').map((_, element) => $(element).attr('for')?.trim() || '').get().filter(Boolean));
  const elementName = (element: any) => {
    const node = $(element);
    const labelledBy = (node.attr('aria-labelledby') || '').split(/\s+/).filter(Boolean).map((id) => idText.get(id) || '').join(' ');
    return [node.attr('aria-label'), labelledBy, node.attr('title'), node.text(), node.find('img[alt]').map((_, image) => $(image).attr('alt') || '').get().join(' ')]
      .map((value) => String(value || '').trim())
      .find(Boolean) || '';
  };
  let brokenAriaReferences = 0;
  $('[aria-labelledby],[aria-describedby]').each((_, element) => {
    for (const attribute of ['aria-labelledby', 'aria-describedby']) {
      const references = ($(element).attr(attribute) || '').split(/\s+/).filter(Boolean);
      brokenAriaReferences += references.filter((id) => !ids.has(id)).length;
    }
  });
  let unlabeledFields = 0;
  $('input:not([type="hidden"]),select,textarea').each((_, element) => {
    const node = $(element);
    const id = node.attr('id')?.trim();
    const labelled = Boolean(
      node.attr('aria-label')?.trim()
      || node.attr('aria-labelledby')?.trim()
      || node.attr('title')?.trim()
      || node.closest('label').length
      || (id && labelFors.has(id)),
    );
    if (!labelled) unlabeledFields += 1;
  });
  const focusableSelector = 'a[href],button,input:not([type="hidden"]),select,textarea,[tabindex]';
  let hiddenFocusableElements = 0;
  $('[aria-hidden="true"]').each((_, element) => {
    const node = $(element);
    if (node.is(focusableSelector) || node.find(focusableSelector).length) hiddenFocusableElements += 1;
  });
  const mainLandmarks = $('main,[role="main"]').length;
  const viewportLower = viewport.toLowerCase();
  const maximumScale = Number(viewportLower.match(/maximum-scale\s*=\s*([0-9.]+)/)?.[1]);
  const zoomRestricted = /user-scalable\s*=\s*(?:no|0)/.test(viewportLower) || (Number.isFinite(maximumScale) && maximumScale < 2);
  const accessibility = {
    unnamedLinks: $('a[href]').filter((_, element) => !elementName(element)).length,
    unnamedButtons: $('button,[role="button"]').filter((_, element) => !elementName(element)).length,
    unlabeledFields,
    mainLandmarks,
    duplicateIds: Array.from(ids.values()).filter((count) => count > 1).reduce((total, count) => total + count - 1, 0),
    brokenAriaReferences,
    positiveTabindex: $('[tabindex]').filter((_, element) => Number($(element).attr('tabindex')) > 0).length,
    hiddenFocusableElements,
    zoomRestricted,
  };
  const likelyJavascriptShell = wordCount < 40
    && $('script[src],script[type="module"]').length >= 2
    && $('#root,#app,#__next,[data-reactroot],[ng-version]').length > 0;
  
  const allText = `${title} ${metaDescription} ${h1.join(' ')} ${h2.join(' ')} ${$('p').text()}`;
  const { topKeywords, topPhrases } = getTopPhrases(allText);

  return {
    title,
    metaDescription,
    h1,
    h2,
    h3,
    wordCount,
    internalLinks,
    externalLinks,
    imageCount,
    imagesWithoutAlt,
    canonical,
    metaRobots,
    ogTitle,
    ogDescription,
    ogImage,
    siteName,
    faviconUrl,
    themeColor,
    twitterCard,
    jsonLd,
    viewport,
    lang,
    topKeywords,
    topPhrases,
    accessibility,
    likelyJavascriptShell,
  };
}
