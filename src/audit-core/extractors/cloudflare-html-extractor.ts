import { ParsedPageData } from '../../lib/seo/html-parser';
import { removeStopwords } from '../../lib/keywords/stopwords';
import { isSameDomain } from '../../lib/seo/url-utils';

declare const HTMLRewriter: any;

export interface ExtractedPageEvidence extends ParsedPageData {
  url: string;
  finalUrl: string;
  statusCode: number;
  responseTimeMs: number;
  pageSizeBytes: number;
  contentType: string;
  headers: Record<string, string>;
  depth: number;
  source: string;
}

function getNGrams(words: string[], n: number): string[] {
  const ngrams = [];
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.push(words.slice(i, i + n).join(' '));
  }
  return ngrams;
}

function getTopPhrases(text: string): { topKeywords: string[]; topPhrases: string[] } {
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

export async function extractWithHtmlRewriter(
  response: Response,
  input: {
    url: string;
    finalUrl: string;
    statusCode: number;
    responseTimeMs: number;
    pageSizeBytes: number;
    contentType: string;
    headers: Record<string, string>;
    depth: number;
    source: string;
  }
): Promise<ExtractedPageEvidence> {
  const baseUrl = input.finalUrl;
  let documentBaseUrl = baseUrl;

  let title = '';
  let metaDescription = '';
  let h1: string[] = [];
  let h2: string[] = [];
  let h3: string[] = [];
  const internalLinks: { href: string; text: string; rawHref?: string }[] = [];
  const externalLinks: { href: string; text: string; rel: string; rawHref?: string }[] = [];
  let imageCount = 0;
  let imagesWithoutAlt = 0;
  let imagesWithEmptyAlt = 0;
  let canonical = '';
  let canonicalRaw = '';
  const insecureResourceUrls: string[] = [];
  const insecureFormActionUrls: string[] = [];
  let metaRobots = '';
  let ogTitle = '';
  let ogDescription = '';
  let ogImageRaw = '';
  let siteName = '';
  let faviconUrlRaw = '';
  let themeColor = '';
  let twitterCard = '';
  const jsonLd: string[] = [];
  let viewport = '';
  let lang = '';

  const bodyTextChunks: string[] = [];

  let scriptsCount = 0;
  let reactRootFound = false;

  let unnamedLinks = 0;
  let unnamedButtons = 0;
  let unlabeledFields = 0;
  let mainLandmarks = 0;
  const ids = new Map<string, number>();
  const idText = new Map<string, string>();
  const labelFors = new Set<string>();
  const ariaReferences: string[] = [];
  let positiveTabindex = 0;
  let hiddenFocusableElements = 0;

  let isBody = false;
  let skipTextDepth = 0;
  let ariaHiddenDepth = 0;

  // Text accumulation states
  let currentAccumulator: string[] | null = null;
  let capturingTitle = false;
  let capturingH1 = false;
  let capturingH2 = false;
  let capturingH3 = false;
  let capturingA = false;
  let capturingButton = false;
  let capturingJsonLd = false;

  let currentA: { href: string; rawHref: string; rel: string; label: string } | null = null;
  let currentAriaHidden = false;

  const resolvePublicAssetUrl = (value: string) => {
    if (!value.trim()) return '';
    try {
      const resolved = new URL(value, documentBaseUrl);
      return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.toString() : '';
    } catch {
      return '';
    }
  };

  const checkInsecureResource = (url: string) => {
    try {
      if (!url.startsWith('http')) return;
      const parsed = new URL(url, documentBaseUrl);
      if (documentBaseUrl.startsWith('https:') && parsed.protocol === 'http:') {
        if (insecureResourceUrls.length < 100) {
          insecureResourceUrls.push(url);
        }
      }
    } catch {}
  };

  let activeText = '';

  const rewriter = new HTMLRewriter()
    .on('html', { element(el) { lang = el.getAttribute('lang') || ''; } })
    .on('base[href]', {
      element(el) {
        const href = el.getAttribute('href');
        if (href) {
          try {
            const resolvedBase = new URL(href, baseUrl);
            if (resolvedBase.protocol === 'http:' || resolvedBase.protocol === 'https:') {
              documentBaseUrl = resolvedBase.toString();
            }
          } catch {}
        }
      }
    })
    .on('title', {
      element(el) { capturingTitle = true; activeText = ''; el.onEndTag(() => { title = activeText.trim(); capturingTitle = false; }); },
    })
    .on('h1', {
      element(el) { capturingH1 = true; activeText = ''; el.onEndTag(() => { h1.push(activeText.trim()); capturingH1 = false; }); }
    })
    .on('h2', {
      element(el) { capturingH2 = true; activeText = ''; el.onEndTag(() => { h2.push(activeText.trim()); capturingH2 = false; }); }
    })
    .on('h3', {
      element(el) { capturingH3 = true; activeText = ''; el.onEndTag(() => { h3.push(activeText.trim()); capturingH3 = false; }); }
    })
    .on('script[type="application/ld+json"]', {
      element(el) { capturingJsonLd = true; activeText = ''; el.onEndTag(() => { jsonLd.push(activeText); capturingJsonLd = false; }); }
    })
    .on('a', {
      element(el) {
        capturingA = true;
        activeText = '';
        const rawHref = el.getAttribute('href') || '';
        const rel = el.getAttribute('rel') || '';
        currentA = { href: resolvePublicAssetUrl(rawHref), rawHref, rel, label: el.getAttribute('aria-label') || '' };
        
        el.onEndTag(() => {
          if (currentA && currentA.href) {
            const isInternal = isSameDomain(currentA.href, baseUrl);
            const textContent = activeText.trim();
            if (isInternal) {
              if (internalLinks.length < 2000) internalLinks.push({ href: currentA.href, text: textContent, rawHref: currentA.rawHref });
            } else {
              if (externalLinks.length < 2000) externalLinks.push({ href: currentA.href, text: textContent, rel: currentA.rel, rawHref: currentA.rawHref });
            }
            if (!textContent && !currentA.label) {
              unnamedLinks++; // Simplified unnamed check
            }
          }
          capturingA = false;
          currentA = null;
        });
      }
    })
    .on('button, [role="button"]', {
      element(el) {
        capturingButton = true;
        activeText = '';
        const label = el.getAttribute('aria-label') || '';
        el.onEndTag(() => {
          if (!activeText.trim() && !label) {
            unnamedButtons++;
          }
          capturingButton = false;
        });
      }
    })
    .on('img', {
      element(el) {
        imageCount++;
        const alt = el.getAttribute('alt');
        if (alt === null) {
          imagesWithoutAlt++;
        } else if (alt.trim() === '') {
          imagesWithEmptyAlt++;
        }
        checkInsecureResource(el.getAttribute('src') || '');
      }
    })
    .on('meta', {
      element(el) {
        const name = (el.getAttribute('name') || '').toLowerCase();
        const property = (el.getAttribute('property') || '').toLowerCase();
        const content = el.getAttribute('content') || '';

        if (name === 'description') metaDescription = content;
        if (name === 'robots') metaRobots = content;
        if (name === 'viewport') viewport = content;
        if (name === 'theme-color') themeColor = content;
        if (name === 'twitter:card') twitterCard = content;
        if (property === 'og:title') ogTitle = content;
        if (property === 'og:description') ogDescription = content;
        if (property === 'og:image') ogImageRaw = content;
        if (property === 'og:site_name') siteName = content;
      }
    })
    .on('link', {
      element(el) {
        const rel = (el.getAttribute('rel') || '').toLowerCase();
        const href = el.getAttribute('href') || '';
        if (rel.includes('canonical') && !canonicalRaw) {
          canonicalRaw = href;
        }
        if ((rel.includes('icon') || rel === 'apple-touch-icon') && !faviconUrlRaw) {
          faviconUrlRaw = href;
        }
        if (rel === 'stylesheet') {
          checkInsecureResource(href);
        }
      }
    })
    .on('script[src], script[type="module"]', {
      element(el) {
        scriptsCount++;
        checkInsecureResource(el.getAttribute('src') || '');
      }
    })
    .on('#root, #app, #__next, [data-reactroot], [ng-version]', {
      element() {
        reactRootFound = true;
      }
    })
    .on('main, [role="main"]', {
      element() {
        mainLandmarks++;
      }
    })
    .on('[id]', {
      element(el) {
        const id = (el.getAttribute('id') || '').trim();
        if (id) {
          ids.set(id, (ids.get(id) || 0) + 1);
        }
      }
    })
    .on('label[for]', {
      element(el) {
        const f = (el.getAttribute('for') || '').trim();
        if (f) labelFors.add(f);
      }
    })
    .on('[aria-labelledby], [aria-describedby]', {
      element(el) {
        const l1 = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
        const l2 = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
        ariaReferences.push(...l1, ...l2);
      }
    })
    .on('[tabindex]', {
      element(el) {
        const ti = Number(el.getAttribute('tabindex'));
        if (ti > 0) positiveTabindex++;
      }
    })
    .on('input:not([type="hidden"]), select, textarea', {
      element(el) {
        const id = (el.getAttribute('id') || '').trim();
        const ariaLabel = el.getAttribute('aria-label');
        const ariaLabelledBy = el.getAttribute('aria-labelledby');
        const titleAttr = el.getAttribute('title');
        
        // Approximation: since we can't easily check closest('label') here without a stack, we check attributes and labelFors
        if (!ariaLabel && !ariaLabelledBy && !titleAttr) {
          // Will verify labelFors after stream
          unlabeledFields++; 
        }
      }
    })
    .on('form[action]', {
      element(el) {
        const action = el.getAttribute('action') || '';
        if (action.startsWith('http://') && documentBaseUrl.startsWith('https:')) {
          if (insecureFormActionUrls.length < 10) {
            insecureFormActionUrls.push(action);
          }
        }
      }
    })
    .on('body', {
      element(el) {
        isBody = true;
        el.onEndTag(() => { isBody = false; });
      }
    })
    .on('script, style, template', {
      element(el) {
        skipTextDepth++;
        el.onEndTag(() => { skipTextDepth--; });
      }
    })
    .on('[aria-hidden="true"]', {
      element(el) {
        ariaHiddenDepth++;
        el.onEndTag(() => { ariaHiddenDepth--; });
      }
    })
    .on('a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]', {
      element(el) {
        if (ariaHiddenDepth > 0) {
          hiddenFocusableElements++;
        }
      }
    })
    .on('*', {
      text(t) {
        const text = t.text;
        if (capturingTitle || capturingH1 || capturingH2 || capturingH3 || capturingA || capturingButton || capturingJsonLd) {
          activeText += text;
        }
        if (isBody && skipTextDepth === 0) {
          bodyTextChunks.push(text);
        }
      }
    });

  // Consume the response stream using the rewriter
  await rewriter.transform(response).arrayBuffer();

  const bodyText = bodyTextChunks.join('').replace(/\s+/g, ' ').trim();
  const wordCount = bodyText.split(/\s+/).filter(w => w.length > 0).length;

  const duplicateIdsCount = Array.from(ids.values()).filter(count => count > 1).reduce((total, count) => total + count - 1, 0);
  
  let brokenAriaReferencesCount = 0;
  for (const ref of ariaReferences) {
    if (!ids.has(ref)) brokenAriaReferencesCount++;
  }

  const viewportLower = viewport.toLowerCase();
  const maximumScale = Number(viewportLower.match(/maximum-scale\s*=\s*([0-9.]+)/)?.[1]);
  const zoomRestricted = /user-scalable\s*=\s*(?:no|0)/.test(viewportLower) || (Number.isFinite(maximumScale) && maximumScale < 2);

  const likelyJavascriptShell = wordCount < 40 && scriptsCount >= 2 && reactRootFound;

  const allText = `${title} ${metaDescription} ${h1.join(' ')} ${h2.join(' ')} ${bodyText}`;
  const { topKeywords, topPhrases } = getTopPhrases(allText);

  canonical = resolvePublicAssetUrl(canonicalRaw);
  const ogImage = resolvePublicAssetUrl(ogImageRaw);
  const faviconUrl = resolvePublicAssetUrl(faviconUrlRaw);

  const accessibility = {
    unnamedLinks,
    unnamedButtons,
    unlabeledFields, // approximated
    mainLandmarks,
    duplicateIds: duplicateIdsCount,
    brokenAriaReferences: brokenAriaReferencesCount,
    positiveTabindex,
    hiddenFocusableElements,
    zoomRestricted,
  };

  const parsedPageData: ParsedPageData = {
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
    imagesWithEmptyAlt,
    canonical,
    canonicalRaw,
    insecureResourceUrls,
    insecureFormActionUrls,
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

  return {
    ...parsedPageData,
    url: input.url,
    finalUrl: input.finalUrl,
    statusCode: input.statusCode,
    responseTimeMs: input.responseTimeMs,
    pageSizeBytes: input.pageSizeBytes,
    contentType: input.contentType,
    headers: input.headers,
    depth: input.depth,
    source: input.source,
  };
}
